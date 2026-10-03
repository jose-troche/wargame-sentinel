// Simulated C2 network: per-faction graph of HQs, units, ground stations, satellites and relays.
// Every order and report is routed over it, so jamming, cyber and destruction delay or drop traffic.
import { fmtSimTime, type C2LinkView, type C2NodeView, type C2View, type Faction, type MessageEnvelope, type Roe } from "@sentinel/protocol";
import { getClass } from "@sentinel/catalog";
import type { Ctx } from "./ctx";
import { distKm, radarHorizonKm } from "./geo";
import { footprintKm } from "./orbit";
import type { Entity, InFlightMessage, TaskState } from "./types";

type LinkKind = C2LinkView["kind"];
const BASE: Record<LinkKind, { lat: number; rel: number }> = {
  FIBER: { lat: 60_000, rel: 0.995 },
  LOS: { lat: 60_000, rel: 0.96 },
  SATCOM: { lat: 180_000, rel: 0.97 },
  LASER: { lat: 30_000, rel: 0.985 },
  HF: { lat: 900_000, rel: 0.8 },
};
const PROCESS_MS = { HQ: 300_000, UNIT: 60_000, GROUND: 60_000, SAT: 10_000, RELAY: 60_000 } as const;

interface Graph {
  nodes: C2NodeView[];
  links: C2LinkView[];
  adj: Map<string, { to: string; link: C2LinkView }[]>;
  root: string | null;
  /** shortest path results from the root */
  best: Map<string, { latency: number; rel: number; path: string[]; jammed: boolean; hfOnly: boolean }>;
}

const graphs = new WeakMap<Ctx, Partial<Record<Faction, Graph>>>();

function jamAt(ctx: Ctx, faction: Faction, lat: number, lon: number, kinds: ("JAM" | "SATCOM")[]): number {
  let j = 0;
  for (const f of ctx.s.ew) {
    if (f.faction === faction || !kinds.includes(f.kind as "JAM" | "SATCOM")) continue;
    if (distKm(lat, lon, f.lat, f.lon) <= f.radiusKm && f.strength > j) j = f.strength;
  }
  return j;
}

function cyberOn(ctx: Ctx, faction: Faction, node: string) {
  return ctx.s.cyber.find((c) => c.victim === faction && c.node === node && c.untilMs > ctx.s.simMs);
}

export function mainHq(ctx: Ctx, faction: Faction): Entity | undefined {
  return ctx.s.entities.find((e) => e.faction === faction && !e.destroyed && getClass(e.cls).tags.includes("HQ") && !(cyberOn(ctx, faction, e.id)?.kind === "DENY"));
}

export function buildGraph(ctx: Ctx, faction: Faction): Graph {
  const nodes: C2NodeView[] = [];
  const links: C2LinkView[] = [];
  const pos = new Map<string, Entity>();
  const own = ctx.s.entities.filter((e) => e.faction === faction && !e.destroyed);
  const hqs: Entity[] = [], grounds: Entity[] = [], relays: Entity[] = [], units: Entity[] = [];
  const geo: Entity[] = [];
  let leo = 0;
  for (const e of own) {
    const c = getClass(e.cls);
    if (c.tags.includes("HQ")) hqs.push(e);
    else if (c.tags.includes("GROUND_STATION")) grounds.push(e);
    else if (c.tags.includes("SATCOM") && c.tags.includes("ORBITAL")) {
      if (c.tags.includes("BROADBAND")) leo++;
      else geo.push(e);
    } else if (c.tags.includes("AEW") && e.sortie === "AIRBORNE") relays.push(e);
    else if (e.domain !== "SPACE" || !c.tags.includes("ORBITAL")) units.push(e);
  }
  const node = (e: Entity, kind: C2NodeView["kind"]) => {
    const cy = cyberOn(ctx, faction, e.id);
    nodes.push({ id: e.id, kind, label: e.callsign, lat: e.lat, lon: e.lon, alive: !(cy?.kind === "DENY"), cyber: cy?.kind });
    pos.set(e.id, e);
  };
  hqs.forEach((e) => node(e, "HQ"));
  grounds.forEach((e) => node(e, "GROUND"));
  relays.forEach((e) => node(e, "RELAY"));
  units.forEach((e) => node(e, "UNIT"));
  geo.forEach((e) => {
    const sp = ctx.satPos.get(e.id);
    nodes.push({ id: e.id, kind: "SAT", label: e.callsign, lat: sp?.lat ?? e.lat, lon: sp?.lon ?? e.lon, alive: true });
  });
  const leoOk = leo >= 4;
  if (leoOk) nodes.push({ id: `${faction}-LEO-NET`, kind: "SAT", label: `LEO net (${leo})`, lat: 0, lon: 0, alive: true });

  const add = (a: string, b: string, kind: LinkKind, la: { lat: number; lon: number }, lb: { lat: number; lon: number }) => {
    const base = BASE[kind];
    const jamKinds: ("JAM" | "SATCOM")[] = kind === "SATCOM" ? ["SATCOM", "JAM"] : kind === "FIBER" || kind === "LASER" ? [] : ["JAM"];
    const jam = jamKinds.length ? Math.max(jamAt(ctx, faction, la.lat, la.lon, jamKinds), jamAt(ctx, faction, lb.lat, lb.lon, jamKinds)) : 0;
    const rel = base.rel * (1 - 0.85 * jam);
    if (rel < 0.08) return;
    links.push({ a, b, kind, latencyMs: Math.round(base.lat * (1 + 3 * jam)), reliability: Math.round(rel * 1000) / 1000, jammed: jam > 0.25 });
  };

  // If every HQ is denied, a ground station acts as the alternate command post.
  const root = hqs.find((h) => !(cyberOn(ctx, faction, h.id)?.kind === "DENY")) ?? grounds.find((g) => !(cyberOn(ctx, faction, g.id)?.kind === "DENY")) ?? null;
  // Fixed infrastructure on fiber.
  const fixed = [...hqs, ...grounds];
  for (let i = 0; i < fixed.length; i++)
    for (let j = i + 1; j < fixed.length; j++)
      if (distKm(fixed[i].lat, fixed[i].lon, fixed[j].lat, fixed[j].lon) < 3000) add(fixed[i].id, fixed[j].id, "FIBER", fixed[i], fixed[j]);

  const satCovers = (sat: Entity, lat: number, lon: number) => {
    const sp = ctx.satPos.get(sat.id);
    return sp ? distKm(sp.lat, sp.lon, lat, lon) <= footprintKm(sp.altKm, 10) : false;
  };
  for (const g of grounds) {
    for (const s of geo) if (satCovers(s, g.lat, g.lon)) add(g.id, s.id, "SATCOM", g, ctx.satPos.get(s.id) ?? s);
    if (leoOk) add(g.id, `${faction}-LEO-NET`, "SATCOM", g, g);
  }
  if (leoOk) for (const s of geo) add(s.id, `${faction}-LEO-NET`, "LASER", s, s);

  const reachers = [...hqs, ...grounds, ...relays];
  for (const u of units) {
    const submerged = u.alt < -20;
    if (!submerged) {
      for (const r of reachers) {
        const d = distKm(u.lat, u.lon, r.lat, r.lon);
        const horizon = Math.min(400, radarHorizonKm(Math.max(10, u.alt), Math.max(30, r.alt)));
        if (d <= horizon) add(u.id, r.id, "LOS", u, r);
      }
      for (const s of geo) if (satCovers(s, u.lat, u.lon)) add(u.id, s.id, "SATCOM", u, ctx.satPos.get(s.id) ?? s);
      if (leoOk) add(u.id, `${faction}-LEO-NET`, "SATCOM", u, u);
    }
    if (root) add(u.id, root.id, "HF", u, root);
    if (u.parent && pos.has(u.parent) && u.parent !== root?.id) add(u.id, u.parent, "HF", u, pos.get(u.parent)!);
  }
  for (const r of relays) for (const h of hqs) if (distKm(r.lat, r.lon, h.lat, h.lon) < 450) add(r.id, h.id, "LOS", r, h);

  const adj = new Map<string, { to: string; link: C2LinkView }[]>();
  const deny = new Set(nodes.filter((n) => !n.alive).map((n) => n.id));
  for (const l of links) {
    if (deny.has(l.a) || deny.has(l.b)) continue;
    if (!adj.has(l.a)) adj.set(l.a, []);
    if (!adj.has(l.b)) adj.set(l.b, []);
    adj.get(l.a)!.push({ to: l.b, link: l });
    adj.get(l.b)!.push({ to: l.a, link: l });
  }

  // Dijkstra on expected latency (latency / reliability + processing at the receiving node).
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const best: Graph["best"] = new Map();
  if (root) {
    const cost = new Map<string, number>([[root.id, 0]]);
    best.set(root.id, { latency: 0, rel: 1, path: [root.id], jammed: false, hfOnly: false });
    const done = new Set<string>();
    for (;;) {
      let cur: string | null = null;
      let cc = Infinity;
      for (const [k, v] of cost) if (!done.has(k) && v < cc) { cc = v; cur = k; }
      if (cur === null) break;
      done.add(cur);
      const cb = best.get(cur)!;
      for (const { to, link } of adj.get(cur) ?? []) {
        if (done.has(to)) continue;
        const kind = kindOf.get(to) ?? "UNIT";
        let proc: number = PROCESS_MS[kind];
        if (cyberOn(ctx, faction, to)?.kind === "DELAY") proc += 1_800_000;
        const c = cc + link.latencyMs / link.reliability + proc;
        if (c < (cost.get(to) ?? Infinity)) {
          cost.set(to, c);
          best.set(to, {
            latency: cb.latency + link.latencyMs + proc, rel: cb.rel * link.reliability, path: [...cb.path, to],
            jammed: cb.jammed || link.jammed, hfOnly: link.kind === "HF" && (cb.path.length === 1 || cb.hfOnly),
          });
        }
      }
    }
  }
  return { nodes, links, adj, root: root?.id ?? null, best };
}

export function refreshC2(ctx: Ctx) {
  const g: Partial<Record<Faction, Graph>> = {};
  for (const f of ["BLUE", "RED"] as const) {
    const gr = buildGraph(ctx, f);
    g[f] = gr;
    const fs = ctx.s.factions[f];
    fs.c2Links = gr.links;
    const unreachable: string[] = [];
    let sum = 0, n = 0;
    for (const e of ctx.s.entities) {
      if (e.faction !== f || e.destroyed || (e.domain === "SPACE" && e.orbit)) continue;
      const b = gr.best.get(e.id);
      const comms = !b ? "CUT" : b.jammed || b.hfOnly ? "DEGRADED" : "OK";
      if (!b) unreachable.push(e.id);
      else { sum += b.latency; n++; }
      if (e.comms !== comms) {
        e.comms = comms;
        ctx.touch(e);
      }
    }
    fs.unreachable = unreachable;
    fs.meanLatencyMs = n ? Math.round(sum / n) : 0;
  }
  graphs.set(ctx, g);
  ctx.c2Dirty = false;
}

export function c2Route(ctx: Ctx, faction: Faction, unit: string) {
  let g = graphs.get(ctx)?.[faction];
  if (!g) {
    refreshC2(ctx);
    g = graphs.get(ctx)![faction]!;
  }
  return g.best.get(unit) ?? null;
}

export function c2View(ctx: Ctx, faction: Faction): C2View {
  let g = graphs.get(ctx)?.[faction];
  if (!g) {
    refreshC2(ctx);
    g = graphs.get(ctx)![faction]!;
  }
  const fs = ctx.s.factions[faction];
  return { faction, nodes: g.nodes, links: g.links, unreachable: fs.unreachable, meanLatencyMs: fs.meanLatencyMs };
}

/** Creates an order message from the faction HQ to a unit and starts it through the network. */
export function sendOrder(
  ctx: Ctx, faction: Faction, from: string, unit: Entity, type: string, task: TaskState,
  meta: { rationale?: string; correlation?: string; roe?: Roe; priority?: MessageEnvelope["priority"] },
): InFlightMessage {
  const id = ctx.nextId("msg_");
  const env: MessageEnvelope = {
    id, sim_time: fmtSimTime(ctx.s.simMs), sim_ms: ctx.s.simMs, faction, from, to: [unit.id], family: "ORDER", type,
    priority: meta.priority ?? "PRIORITY", classification_tier: "FACTION", path_hint: ["SATCOM", "LOS", "HF"],
    body: { task: task.kind, point: task.point, target: task.target, window: task.window, roe: meta.roe },
    rationale: meta.rationale, correlation_id: meta.correlation, delivery: { state: "IN_TRANSIT", path: [] },
  };
  const m: InFlightMessage = { env, apply: { unit: unit.id, task, roe: meta.roe } };
  routeMessage(ctx, m);
  ctx.s.messages.push(m);
  ctx.newMessages.push(id);
  return m;
}

/** Sends a report up the chain (BDA, SPOTREP...). Reports only affect timing and the message trace. */
export function sendReport(ctx: Ctx, faction: Faction, from: Entity, type: string, body: Record<string, unknown>) {
  const id = ctx.nextId("msg_");
  const r = c2Route(ctx, faction, from.id);
  const env: MessageEnvelope = {
    id, sim_time: fmtSimTime(ctx.s.simMs), sim_ms: ctx.s.simMs, faction, from: from.id, to: [`${faction.toLowerCase()}.j2`], family: "REPORT", type,
    priority: "ROUTINE", classification_tier: "FACTION", path_hint: [], body,
    delivery: r ? { state: "IN_TRANSIT", path: [...r.path].reverse(), deliverAtMs: ctx.s.simMs + r.latency, latencyMs: r.latency } : { state: "HELD", path: [] },
  };
  ctx.s.messages.push({ env, retryAtMs: r ? undefined : ctx.s.simMs + 600_000 });
  ctx.newMessages.push(id);
}

function routeMessage(ctx: Ctx, m: InFlightMessage) {
  const unit = m.apply?.unit ?? m.env.to[0];
  const r = c2Route(ctx, m.env.faction, unit);
  if (!r) {
    m.env.delivery = { state: "HELD", path: [] };
    m.retryAtMs = ctx.s.simMs + 600_000;
    return;
  }
  // Failure compounds per hop: one roll on end-to-end reliability; a lost message is retransmitted after a timeout.
  if (!ctx.rng.chance(r.rel)) {
    m.env.delivery = { state: "HELD", path: r.path, latencyMs: r.latency };
    m.retryAtMs = ctx.s.simMs + 600_000 + r.latency;
    return;
  }
  m.env.delivery = { state: "IN_TRANSIT", path: r.path, deliverAtMs: ctx.s.simMs + r.latency, latencyMs: r.latency };
  m.retryAtMs = undefined;
}

/** Delivers due messages, retries held ones, prunes old ones. */
export function deliverMessages(ctx: Ctx, applyTask: (unit: Entity, task: TaskState, roe?: Roe) => void) {
  const now = ctx.s.simMs;
  for (const m of ctx.s.messages) {
    const d = m.env.delivery;
    if (d.state === "IN_TRANSIT" && d.deliverAtMs !== undefined && d.deliverAtMs <= now) {
      d.state = "DELIVERED";
      ctx.newMessages.push(m.env.id);
      if (m.apply) {
        const u = ctx.byId.get(m.apply.unit);
        if (u && !u.destroyed) applyTask(u, m.apply.task, m.apply.roe);
      }
    } else if (d.state === "HELD" && m.retryAtMs !== undefined && m.retryAtMs <= now) {
      const age = now - m.env.sim_ms;
      if (age > 12 * 3_600_000) {
        d.state = "DROPPED";
        m.retryAtMs = undefined;
      } else if (m.apply) routeMessage(ctx, m);
      else {
        const from = ctx.byId.get(m.env.from);
        const r = from ? c2Route(ctx, m.env.faction, from.id) : null;
        if (r) m.env.delivery = { state: "IN_TRANSIT", path: [...r.path].reverse(), deliverAtMs: now + r.latency, latencyMs: r.latency };
        else m.retryAtMs = now + 600_000;
      }
      ctx.newMessages.push(m.env.id);
    }
  }
  // Keep finished messages for two simulated hours for the message trace.
  if (ctx.s.tick % 10 === 0) {
    ctx.s.messages = ctx.s.messages.filter(
      (m) => !(m.env.delivery.state === "DELIVERED" || m.env.delivery.state === "DROPPED") || now - m.env.sim_ms < 2 * 3_600_000,
    );
  }
}
