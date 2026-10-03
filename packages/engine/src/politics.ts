// Strategic layer: objectives, national will, escalation ladder, injects and victory conditions.
import { ESCALATION_LADDER, type Faction } from "@sentinel/protocol";
import { getClass } from "@sentinel/catalog";
import type { Ctx } from "./ctx";
import { distKm } from "./geo";
import { destroy } from "./tactical";
import { h3Of } from "./init";
import { injectFalseTrack } from "./sensing";
import { propagate } from "./orbit";
import type { Entity } from "./types";

function presence(ctx: Ctx, f: Faction, lat: number, lon: number, r: number): number {
  let p = 0;
  for (const e of ctx.s.entities) {
    if (e.faction !== f || e.destroyed || e.decoy) continue;
    if (e.domain !== "LAND" && e.domain !== "SEA" && e.cls !== "usv" && e.cls !== "ugv") continue;
    if (Math.abs(e.lat - lat) > r / 100 + 1) continue;
    if (distKm(e.lat, e.lon, lat, lon) > r) continue;
    const c = getClass(e.cls);
    p += Math.max(5, c.combatPower || c.cost.points / 2) * Math.max(0.1, e.health);
  }
  return p;
}

export function updateObjectives(ctx: Ctx) {
  for (const o of ctx.s.objectives) {
    const enemy: Faction = o.owner === "BLUE" ? "RED" : "BLUE";
    const own = presence(ctx, o.owner, o.center[0], o.center[1], o.radiusKm);
    const opp = presence(ctx, enemy, o.center[0], o.center[1], o.radiusKm);
    let holder: typeof o.holder;
    if (o.kind === "CONTROL") holder = own > 1.5 * opp && own > 0 ? o.owner : opp > 1.5 * own && opp > 0 ? enemy : own + opp > 0 ? "CONTESTED" : "NONE";
    else if (o.kind === "DENY") holder = opp === 0 ? o.owner : own > opp ? "CONTESTED" : enemy;
    else holder = opp === 0 ? o.owner : enemy; // DESTROY: no enemy force left in the area
    if (holder !== o.holder) {
      ctx.emit({ type: "OBJECTIVE", vis: ["WHITE", "BLUE", "RED"], text: `Objective "${o.name}" (${o.owner}): ${o.holder} → ${holder}`, notable: holder === o.owner || o.holder === o.owner, factors: { own: Math.round(own), enemy: Math.round(opp) } });
      o.holder = holder;
    }
    if (holder === o.owner) o.heldHours += 1;
  }
}

export function updateWill(ctx: Ctx) {
  for (const f of ["BLUE", "RED"] as const) {
    const fs = ctx.s.factions[f];
    const held = ctx.s.objectives.filter((o) => o.owner === f && o.holder === f).reduce((s, o) => s + o.weight, 0);
    const lost = ctx.s.objectives.filter((o) => o.owner === f && o.holder !== f && o.holder !== "NONE").reduce((s, o) => s + o.weight, 0);
    const delta = -fs.hourLossPoints / 40 + fs.hourKillPoints / 120 - fs.hourHarm * 1.5 + 0.25 * held - 0.25 * lost;
    const before = fs.will;
    fs.will = Math.max(0, Math.min(100, Math.round((fs.will + delta) * 100) / 100));
    if (Math.abs(fs.will - before) >= 3) {
      ctx.emit({ type: "WILL", vis: ["WHITE", f], text: `${fs.name} national will ${before.toFixed(0)} → ${fs.will.toFixed(0)}`, notable: true, factors: { lossPoints: fs.hourLossPoints, killPoints: fs.hourKillPoints, harm: fs.hourHarm, objectivesHeld: held } });
    }
    fs.hourLossPoints = 0;
    fs.hourKillPoints = 0;
    fs.hourHarm = 0;
    if (fs.will <= 0 && !fs.seekingTerms) {
      fs.seekingTerms = true;
      ctx.emit({ type: "SEEKS_TERMS", vis: ["WHITE", "BLUE", "RED"], text: `${fs.name} national will collapsed — seeking terms`, notable: true });
    }
  }
  const b = ctx.s.factions.BLUE, r = ctx.s.factions.RED;
  ctx.s.history.push([Math.round(ctx.s.simMs / 3_600_000), b.will, r.will, b.escalation, r.escalation]);
  ctx.s.metrics.escalationPeak = Math.max(ctx.s.metrics.escalationPeak, b.escalation, r.escalation);
}

export function setEscalation(ctx: Ctx, f: Faction, rung: number, by: string) {
  const fs = ctx.s.factions[f];
  const next = Math.max(0, Math.min(6, rung));
  if (next === fs.escalation) return;
  const prev = fs.escalation;
  fs.escalation = next;
  ctx.emit({ type: "ESCALATION", vis: ["WHITE", "BLUE", "RED"], text: `${fs.name} ${next > prev ? "escalates" : "de-escalates"} to rung ${next} (${ESCALATION_LADDER[next].name}) by ${by}`, notable: true, factors: { from: prev, to: next } });
  // Escalating raises the opponent's alarm and costs will at home.
  fs.will = Math.max(0, fs.will - (next > prev ? 2 : -1));
  for (const o of ["BLUE", "RED"] as const) if (o !== f) ctx.s.factions[o].triggers.push(`${f} escalated to ${next}`);
  ctx.s.metrics.escalationPeak = Math.max(ctx.s.metrics.escalationPeak, next);
  if (next >= 6) {
    ctx.s.outcome = { winner: "CATASTROPHIC", reason: `${fs.name} reached the strategic rung — adjudicated catastrophic outcome (not modeled)` };
    ctx.s.ended = true;
  }
}

export function checkOutcome(ctx: Ctx) {
  if (ctx.s.outcome) return;
  const b = ctx.s.factions.BLUE, r = ctx.s.factions.RED;
  if (b.seekingTerms || r.seekingTerms) {
    ctx.s.outcome = b.seekingTerms && r.seekingTerms ? { winner: "DRAW", reason: "Both factions exhausted" } : { winner: b.seekingTerms ? "RED" : "BLUE", reason: `${b.seekingTerms ? b.name : r.name} sought terms` };
  } else if (ctx.s.simMs >= ctx.scn.durationH * 3_600_000) {
    const score = (f: Faction) => ctx.s.objectives.filter((o) => o.owner === f).reduce((s, o) => s + o.heldHours * o.weight, 0) + ctx.s.factions[f].will;
    const sb = score("BLUE"), sr = score("RED");
    ctx.s.outcome = Math.abs(sb - sr) < 5 ? { winner: "DRAW", reason: "Time limit reached with no decisive advantage" } : { winner: sb > sr ? "BLUE" : "RED", reason: `Time limit reached; objective-hours and will favor ${sb > sr ? b.name : r.name} (${Math.round(sb)} vs ${Math.round(sr)})` };
  }
  if (ctx.s.outcome) {
    ctx.s.ended = true;
    ctx.emit({ type: "SESSION_END", vis: ["WHITE", "BLUE", "RED"], text: `Scenario ended: ${ctx.s.outcome.winner} — ${ctx.s.outcome.reason}`, notable: true });
  }
}

/** Scheduled White-cell injects from the scenario definition. */
export function runInjects(ctx: Ctx) {
  const injects = ctx.scn.injects;
  while (ctx.s.injectsFired < injects.length) {
    const inj = injects[ctx.s.injectsFired];
    if (inj.atH * 3_600_000 > ctx.s.simMs) break;
    ctx.s.injectsFired += 1;
    applyInject(ctx, inj.kind, inj.text, inj.faction as Faction | undefined, inj.at as [number, number] | undefined, inj.target);
  }
}

export function applyInject(ctx: Ctx, kind: string, text: string, faction?: Faction, at?: [number, number], target?: string) {
  const now = ctx.s.simMs;
  const before = ctx.rng.draws;
  switch (kind) {
    case "CONVOY": {
      const p = at ?? ctx.scn.map.center;
      for (let i = 0; i < 3; i++) {
        const id = ctx.nextId("G-MERCHANT-");
        const e: Entity = {
          id, faction: "GREEN", cls: "oiler", domain: "SEA", callsign: id.replace("G-", ""), lat: p[0] + i * 0.05, lon: p[1], alt: 0, heading: 90, h3: h3Of(p[0], p[1]),
          task: { kind: "MOVE", point: target && /^-?[\d.]+,-?[\d.]+$/.test(target) ? (target.split(",").map(Number) as [number, number]) : [p[0] + 6, p[1]], issuedMs: now }, health: 1, readiness: 1, morale: 1, strength: 1, supplyDays: 30, fuel: 1, ammo: [],
          emcon: false, comms: "OK", autonomy: "FULL", destroyed: false, decoy: false, members: 1, sortie: "NA", posture: "MOVE", entrenchH: 0, kills: 0,
        };
        ctx.s.entities.push(e);
        ctx.byId.set(e.id, e);
        ctx.touch(e);
      }
      break;
    }
    case "SAT_FAILURE": {
      const sats = ctx.s.entities.filter((e) => e.orbit && !e.destroyed && (!faction || e.faction === faction) && (!target || e.cls === target));
      if (sats.length) destroy(ctx, ctx.rng.pick(sats), "on-orbit failure (inject)");
      break;
    }
    case "STORM": {
      const p = at ?? ctx.scn.map.center;
      ctx.s.fronts.push({ lat: p[0], lon: p[1], radiusKm: 350, intensity: 0.95, vLat: 0.05, vLon: 0.2 });
      break;
    }
    case "CYBER_OUTAGE": {
      const f = faction ?? "BLUE";
      const hq = ctx.s.entities.find((e) => e.faction === f && e.cls === "hq" && !e.destroyed);
      if (hq) ctx.s.cyber.push({ id: ctx.nextId("CY-"), attacker: f === "BLUE" ? "RED" : "BLUE", victim: f, node: hq.id, kind: "DELAY", untilMs: now + 3 * 3_600_000, detected: true });
      ctx.c2Dirty = true;
      break;
    }
    case "GNSS_OUTAGE": {
      const p = at ?? ctx.scn.map.center;
      ctx.s.ew.push({ id: ctx.nextId("EW-GNSS-"), faction: faction === "BLUE" ? "RED" : "BLUE", source: "INJECT", lat: p[0], lon: p[1], radiusKm: 400, strength: 0.8, kind: "GNSS", untilMs: now + 12 * 3_600_000 });
      break;
    }
    case "CEASEFIRE_OFFER": {
      for (const f of ["BLUE", "RED"] as const) ctx.s.factions[f].triggers.push("ceasefire offer");
      break;
    }
    case "REINFORCE": {
      if (faction && at && target) {
        try {
          const c = getClass(target);
          const id = ctx.nextId(`${faction[0]}-REINF-`);
          const e: Entity = {
            id, faction, cls: c.id, domain: c.domain, callsign: id.slice(2), lat: at[0], lon: at[1], alt: 0, heading: 0, h3: h3Of(at[0], at[1]),
            task: { kind: "HOLD", issuedMs: now }, health: 1, readiness: 0.8, morale: 1, strength: 1, supplyDays: 8, fuel: 1, ammo: c.effectors.map((x) => x.magazine),
            emcon: false, comms: "OK", autonomy: "MISSION", destroyed: false, decoy: false, members: c.members ?? 1, sortie: "NA", posture: "DEFEND", entrenchH: 0, kills: 0,
            landmass: ctx.map.landmassAt(at[0], at[1]),
          };
          ctx.s.entities.push(e);
          ctx.byId.set(e.id, e);
          ctx.touch(e);
        } catch { /* unknown class: ignore */ }
      }
      break;
    }
    case "DECEPTION": {
      const f = faction ?? "BLUE";
      const p = at ?? ctx.scn.map.center;
      injectFalseTrack(ctx, f, p[0], p[1], "inject");
      break;
    }
  }
  ctx.emit({ type: "INJECT", vis: ["WHITE", "BLUE", "RED"], text: `White cell inject: ${text}`, notable: true, factors: { kind } }, before);
}

/** Environment per tick: fronts drift, EW/cyber effects expire, replacement launches arrive. */
export function environmentTick(ctx: Ctx) {
  const h = ctx.s.tickMs / 3_600_000;
  for (const f of ctx.s.fronts) {
    f.lat += f.vLat * h;
    f.lon += f.vLon * h;
  }
  const now = ctx.s.simMs;
  const ewBefore = ctx.s.ew.length;
  ctx.s.ew = ctx.s.ew.filter((x) => x.untilMs > now && (x.source === "INJECT" || !ctx.byId.get(x.source)?.destroyed));
  const cyBefore = ctx.s.cyber.length;
  ctx.s.cyber = ctx.s.cyber.filter((x) => x.untilMs > now);
  if (ewBefore !== ctx.s.ew.length || cyBefore !== ctx.s.cyber.length) ctx.c2Dirty = true;
  for (const c of ctx.s.cyber) {
    if (c.kind === "DECEIVE" && ctx.s.tick % 60 === 0) {
      const n = ctx.byId.get(c.node);
      if (n) injectFalseTrack(ctx, c.victim, n.lat + 0.5, n.lon + 0.5, "cyber deception");
    }
  }
  while (ctx.s.launches.length && ctx.s.launches[0].atMs <= now) {
    const l = ctx.s.launches.shift()!;
    if (!ctx.s.entities.some((x) => x.faction === l.faction && x.cls === "launch_site" && !x.destroyed) || !l.orbit) continue;
    const orbit = { ...l.orbit, m0: l.orbit.m0 + 0.3 };
    const sp = propagate(orbit, now);
    const id = ctx.nextId(`${l.faction[0]}-${l.callsign}-`);
    const e: Entity = {
      id, faction: l.faction, cls: l.cls, domain: "SPACE", callsign: id.slice(2), lat: sp.lat, lon: sp.lon, alt: sp.altKm * 1000, heading: 0, h3: h3Of(sp.lat, sp.lon),
      task: { kind: "ISR", issuedMs: now }, health: 1, readiness: 1, morale: 1, strength: 1, supplyDays: 999, fuel: 1, ammo: [], emcon: false, comms: "OK",
      autonomy: "FULL", destroyed: false, decoy: false, members: 1, sortie: "NA", posture: "MOVE", entrenchH: 0, orbit, pendingImagery: [], kills: 0,
    };
    ctx.s.entities.push(e);
    ctx.byId.set(e.id, e);
    ctx.touch(e);
    ctx.emit({ type: "LAUNCH", vis: ["WHITE", "BLUE", "RED"], text: `${ctx.s.factions[l.faction].name} launched replacement ${getClass(l.cls).name}`, entities: [e.id] });
  }
}
