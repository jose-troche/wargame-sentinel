// View building: ground truth for WHITE, own forces + own COP for each faction. This is the
// fog-of-war boundary: faction views never include truth ids, enemy entities or enemy messages.
import type {
  AirView, CopForAgents, EntityView, EventView, Faction, KillChainView, LogisticsView, MessageEnvelope, PoliticsView, SatelliteView, TrackView, UnitSummary, View, ViewDelta,
} from "@sentinel/protocol";
import { getClass } from "@sentinel/catalog";
import type { Ctx } from "./ctx";
import { c2View } from "./c2";
import { footprintKm } from "./orbit";
import { q } from "./dmath";
import type { Entity, KillChain, Track } from "./types";

export function entityView(e: Entity, white: boolean): EntityView {
  const v: EntityView = {
    id: e.id, faction: e.faction, cls: e.cls, domain: e.domain, callsign: e.callsign, lat: q(e.lat), lon: q(e.lon), alt: Math.round(e.alt), heading: e.heading,
    health: q(e.health, 1000), readiness: q(e.readiness, 100), supplyDays: q(e.supplyDays, 10), fuel: q(e.fuel, 100), task: e.task.kind,
    emcon: e.emcon, comms: e.comms, destroyed: e.destroyed, h3: e.h3,
  };
  if (e.parent) v.parent = e.parent;
  if (e.domain === "LAND") {
    v.morale = q(e.morale, 100);
    v.strength = q(e.strength, 1000);
  }
  if (e.task.point) v.taskPoint = [q(e.task.point[0]), q(e.task.point[1])];
  if (e.task.target) v.taskTarget = e.task.target;
  if (e.members > 1) v.count = e.members;
  if (white && e.decoy) v.decoy = true;
  return v;
}

export function trackView(t: Track, white: boolean): TrackView {
  const v: TrackView = {
    id: t.id, owner: t.owner, believedDomain: t.believedDomain, affiliation: t.affiliation, quality: t.quality, lat: q(t.lat), lon: q(t.lon), alt: Math.round(t.alt),
    ellipse: [q(t.errKm, 10), q(t.errKm * 0.6, 10), 0], lastSeenMs: t.lastSeenMs, sources: t.sources,
  };
  if (t.believedClass) v.believedClass = t.believedClass;
  if (white) v.truth = t.false ? "FALSE" : t.truthId;
  return v;
}

function chainView(ch: KillChain, white: boolean): KillChainView {
  const v: KillChainView = {
    id: ch.id, faction: ch.faction, shooter: ch.shooter, track: ch.track, weapon: ch.weapon, status: ch.status, stages: ch.stages, c2LatencyMs: ch.c2LatencyMs,
  };
  if (ch.brokenAt) v.brokenAt = ch.brokenAt;
  if (ch.believedKill !== undefined) v.believedKill = ch.believedKill;
  if (white && ch.actualKill !== undefined) v.actualKill = ch.actualKill;
  return v;
}

function visibleTo(view: View, faction: Faction) {
  return view === "WHITE" || view === faction;
}

export function politicsView(ctx: Ctx, view: View): PoliticsView {
  return {
    factions: (["BLUE", "RED"] as const).map((f) => {
      const fs = ctx.s.factions[f];
      const own = visibleTo(view, f);
      // Enemy will is estimated (rounded); escalation is public signaling.
      return {
        faction: f, name: fs.name, will: own ? fs.will : Math.round(fs.will / 10) * 10, escalation: fs.escalation, losses: fs.losses, lossPoints: fs.lossPoints,
        kills: fs.kills, civilianHarm: fs.civilianHarm, seekingTerms: fs.seekingTerms,
      };
    }),
    objectives: ctx.s.objectives.map((o) => ({ ...o })),
    history: view === "WHITE" ? ctx.s.history : ctx.s.history.map(([h, b, r, eb, er]) => [h, view === "BLUE" ? b : Math.round(b / 10) * 10, view === "RED" ? r : Math.round(r / 10) * 10, eb, er]),
    outcome: ctx.s.outcome,
  };
}

function airView(ctx: Ctx, view: View): AirView {
  const missions = ctx.s.missions.filter((m) => visibleTo(view, m.faction)).slice(-150);
  const bases = new Map<string, { base: string; faction: Faction; n: number; airborne: number; ready: number }>();
  for (const e of ctx.s.entities) {
    if (!e.home || e.destroyed || !visibleTo(view, e.faction)) continue;
    const key = e.home.carrier ?? `${e.faction}@${e.home.lat.toFixed(1)},${e.home.lon.toFixed(1)}`;
    const b = bases.get(key) ?? { base: e.home.carrier ? ctx.byId.get(e.home.carrier)?.callsign ?? key : key, faction: e.faction, n: 0, airborne: 0, ready: 0 };
    b.n++;
    if (e.sortie === "AIRBORNE") b.airborne++;
    if (e.sortie === "READY") b.ready++;
    bases.set(key, b);
  }
  return {
    missions,
    sortieRate: [...bases.values()].map((b) => ({ base: b.base, faction: b.faction, rate: q(b.airborne / Math.max(1, b.n), 100), readiness: q(b.ready / Math.max(1, b.n), 100) })),
  };
}

export function satellites(ctx: Ctx): SatelliteView[] {
  return ctx.s.entities
    .filter((e) => e.orbit)
    .map((e) => ({ id: e.id, faction: e.faction, cls: e.cls, elements: e.orbit!, alive: !e.destroyed, footprintKm: Math.round(footprintKm(e.orbit!.a - 6371, getClass(e.cls).tags.includes("ISR") ? 20 : 10)) }));
}

function messagesFor(ctx: Ctx, view: View, ids: Set<string> | null): MessageEnvelope[] {
  const out: MessageEnvelope[] = [];
  for (const m of ctx.s.messages) {
    if (!visibleTo(view, m.env.faction)) continue;
    if (ids && !ids.has(m.env.id)) continue;
    out.push({ ...m.env, delivery: { ...m.env.delivery } });
  }
  return out.slice(-200);
}

export interface DrainOptions {
  full?: boolean;
  c2?: boolean;
  logistics?: boolean;
  satellites?: boolean;
}

export function buildDelta(ctx: Ctx, view: View, events: EventView[], opt: DrainOptions): ViewDelta {
  const white = view === "WHITE";
  const d: ViewDelta = { view, tick: ctx.s.tick, simMs: ctx.s.simMs };
  const ents: EntityView[] = [];
  if (opt.full) {
    for (const e of ctx.s.entities) if (white || e.faction === view) ents.push(entityView(e, white));
    d.full = true;
  } else {
    for (const id of ctx.dirty) {
      const e = ctx.byId.get(id);
      if (e && (white || e.faction === view)) ents.push(entityView(e, white));
    }
  }
  if (ents.length) d.entities = ents;
  const facs: ("BLUE" | "RED")[] = white ? ["BLUE", "RED"] : [view as "BLUE" | "RED"];
  d.tracks = facs.flatMap((f) => ctx.s.factions[f].tracks.map((t) => trackView(t, white)));
  const chains = ctx.s.chains.filter((c) => (white || c.faction === view) && (opt.full || ctx.dirtyChains.has(c.id)));
  if (chains.length || opt.full) d.chains = (opt.full ? chains.slice(-200) : chains).map((c) => chainView(c, white));
  if (opt.full || opt.c2) d.c2 = facs.map((f) => c2View(ctx, f));
  if (opt.full || opt.logistics) {
    d.logistics = facs.map((f): LogisticsView => ({ faction: f, flows: ctx.s.factions[f].flows, shortfallHours: ctx.s.factions[f].shortfallHours }));
  }
  d.politics = politicsView(ctx, view);
  d.air = airView(ctx, view);
  if (opt.full || opt.satellites) d.satellites = satellites(ctx);
  d.debris = ctx.s.debris.map((x) => ({ ...x }));
  d.ew = ctx.s.ew.filter((x) => white || x.faction === view || x.kind !== "GNSS").map((x) => ({ id: x.id, faction: x.faction, lat: q(x.lat), lon: q(x.lon), radiusKm: x.radiusKm, strength: x.strength, kind: x.kind === "SATCOM" ? "JAM" : x.kind }));
  const evs = events.filter((e) => e.vis.includes(view));
  if (evs.length) d.events = evs;
  const msgs = messagesFor(ctx, view, opt.full ? null : new Set(ctx.newMessages));
  if (msgs.length) d.messages = msgs;
  return d;
}

/** The faction COP handed to FactionAgents and rule policies — never ground truth. */
export function buildCop(ctx: Ctx, f: "BLUE" | "RED", consumeTriggers = true): CopForAgents {
  const fs = ctx.s.factions[f];
  const enemy = f === "BLUE" ? "RED" : "BLUE";
  const units: UnitSummary[] = ctx.s.entities
    .filter((e) => e.faction === f && !e.destroyed)
    .map((e) => ({ id: e.id, cls: e.cls, domain: e.domain, callsign: e.callsign, h3: e.h3, lat: q(e.lat, 100), lon: q(e.lon, 100), health: q(e.domain === "LAND" ? e.strength : e.health, 100), supplyDays: q(e.supplyDays, 10), fuel: q(e.fuel, 100), task: e.task.kind, taskPoint: e.task.point ? [q(e.task.point[0], 100), q(e.task.point[1], 100)] as [number, number] : undefined, taskTarget: e.task.target, comms: e.comms }));
  const triggers = fs.triggers.slice(-10);
  if (consumeTriggers) fs.triggers = [];
  return {
    faction: f, simMs: ctx.s.simMs, tick: ctx.s.tick, escalation: fs.escalation, enemyEscalation: ctx.s.factions[enemy].escalation, will: fs.will,
    tracks: fs.tracks.filter((t) => !t.believedDead).map((t) => trackView(t, false)),
    units, objectives: ctx.s.objectives.map((o) => ({ ...o })),
    shortfallUnits: units.filter((u) => u.supplyDays <= 0.5).length,
    unreachable: fs.unreachable, meanLatencyMs: fs.meanLatencyMs, losses: fs.lossPoints, kills: fs.killPoints, triggers,
    enemySpace: ctx.s.entities.filter((e) => e.orbit && !e.destroyed && e.faction === enemy).map((e) => ({ id: e.id, cls: e.cls })),
    hq: (() => { const h = ctx.s.entities.find((e) => e.faction === f && e.cls === "hq" && !e.destroyed); return h ? [q(h.lat, 100), q(h.lon, 100)] as [number, number] : undefined; })(),
  };
}
