// SessionDO: the session hub and the only server component that sees ground truth.
// WebSocket fan-out by view tag (Hibernation API), order intake with seat checks, the agent bridge,
// persistence (tick-batched events, hourly snapshots), and Profile A alarm-sliced engine ticks.
import { DurableObject } from "cloudflare:workers";
import { getAgentByName } from "agents";
import {
  agentId, decode, encode, fmtSimTime, OrderBatchSchema, parseAgentId, ROLES, type AgentStatus, type ControlFrame, type CopForAgents,
  type Decision, type DeltaFrame, type EventView, type Faction, type JoinClaims, type OrderBatch, type OrderFrame, type ResumeOrder, type Role,
  type SessionMeta, type View, type ViewDelta, type AarFrame,
} from "@sentinel/protocol";
import { Engine, computeAar, type AarReport } from "@sentinel/engine";
import { getScenario } from "@sentinel/scenarios";
import { verifyToken } from "./auth";
import { archiveStore } from "./archive";
import type { FactionAgent } from "./faction";

const SHARD = 40;
const SLICE_BUDGET = 40;
const PROFILE_A_TICK_MS = 600_000;
const VIEWS: View[] = ["BLUE", "RED", "WHITE"];

type Row = Record<string, SqlStorageValue>;

/** SQLite BLOB parameters must be ArrayBuffers. */
const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export class SessionDO extends DurableObject<Env> {
  private meta: SessionMeta | null = null;
  private engine: Engine | null = null;
  private viewCache: Partial<Record<View, ViewDelta>> = {};
  private idIndex = new Map<string, number>();
  private lastTickWall = 0;
  private requests = 0;
  private deltasSinceMeta = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.sql(`
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
        CREATE TABLE IF NOT EXISTS seats (agent_id TEXT PRIMARY KEY, faction TEXT, holder TEXT, since INTEGER);
        CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, seq_to INTEGER, tick INTEGER, sim_ms INTEGER, batch BLOB);
        CREATE INDEX IF NOT EXISTS events_tick ON events(tick);
        CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, faction TEXT, from_agent TEXT, sim_ms INTEGER, tick INTEGER, body BLOB, state TEXT);
        CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, sim_ms INTEGER, faction TEXT, body TEXT);
        CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY CHECK (id = 1), tick INTEGER, phase TEXT, offset INTEGER);
        CREATE TABLE IF NOT EXISTS entity_shards (shard INTEGER PRIMARY KEY, state BLOB);
        CREATE TABLE IF NOT EXISTS core (id INTEGER PRIMARY KEY CHECK (id = 1), state BLOB);
        CREATE TABLE IF NOT EXISTS snapshots (tick INTEGER PRIMARY KEY, sim_ms INTEGER, blob BLOB);
      `);
      const row = this.sql<{ v: string }>("SELECT v FROM meta WHERE k = 'meta'")[0];
      if (row) this.meta = JSON.parse(row.v) as SessionMeta;
    });
  }

  private sql<T extends Row = Row>(q: string, ...args: SqlStorageValue[]): T[] {
    return this.ctx.storage.sql.exec<T>(q, ...args).toArray();
  }

  private saveMeta() {
    if (!this.meta) return;
    this.sql("INSERT OR REPLACE INTO meta (k, v) VALUES ('meta', ?)", JSON.stringify(this.meta));
    this.deltasSinceMeta = 0;
  }

  private async faction(f: Faction | "WHITE"): Promise<DurableObjectStub<FactionAgent>> {
    const stub = await getAgentByName(this.env.FACTION as never, `faction:${this.meta!.id}:${f}`);
    return stub as unknown as DurableObjectStub<FactionAgent>;
  }

  // ------------------------------------------------------------------ lifecycle

  async init(meta: SessionMeta, grant: number, branch?: { snapshot: Uint8Array; orders: ResumeOrder[]; pauseAtTick: number }): Promise<SessionMeta> {
    this.meta = meta;
    for (const f of ["BLUE", "RED"] as const) {
      for (const r of ROLES) this.sql("INSERT OR REPLACE INTO seats (agent_id, faction, holder, since) VALUES (?, ?, 'AI', ?)", agentId(f, r), f, Date.now());
    }
    const scn = getScenario(meta.scenarioId)!;
    for (const f of ["BLUE", "RED", "WHITE"] as const) {
      const stub = await this.faction(f);
      const name = f === "WHITE" ? "White cell" : scn.factions.find((x) => x.id === f)?.name ?? f;
      await stub.init(meta.id, f, name, meta.rulesOnly, grant);
    }
    if (branch) {
      this.sql("INSERT OR REPLACE INTO snapshots (tick, sim_ms, blob) VALUES (?, ?, ?)", 0, 0, ab(branch.snapshot));
      this.ctx.storage.kv.put("branch", { orders: branch.orders, pauseAtTick: branch.pauseAtTick });
    }
    if (meta.profile === "A") {
      this.engine = branch ? Engine.restore(scn, branch.snapshot) : Engine.create(scn, meta.seed, { tickMs: PROFILE_A_TICK_MS });
      if (branch) for (const o of branch.orders) this.engine.submit({ faction: o.faction, from: o.from, batch: o.batch, source: o.source });
      this.persistEngine(true);
      meta.status = "RUNNING";
      meta.hostConnected = true;
      meta.tick = this.engine.state.tick;
      meta.simMs = this.engine.state.simMs;
      await this.ctx.storage.setAlarm(Date.now() + 500);
    }
    this.saveMeta();
    return meta;
  }

  async getMeta(): Promise<SessionMeta | null> {
    return this.meta;
  }

  // ------------------------------------------------------------------ websockets

  override async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const claims = await verifyToken(new URL(req.url).searchParams.get("t"), this.env.JOIN_SECRET);
    if (!claims || !this.meta || claims.sid !== this.meta.id) return new Response("forbidden", { status: 403 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const isHost = claims.host && this.meta.profile === "B";
    if (isHost) for (const old of this.ctx.getWebSockets("host")) old.close(4000, "replaced by a new host");
    const tags = [`view:${claims.view}`, `user:${claims.sub}`];
    if (isHost) tags.push("host");
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment(claims);
    if (isHost) {
      this.meta.hostConnected = true;
      this.saveMeta();
      server.send(encode(this.resumeFrame()));
      this.broadcastStatus();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private resumeFrame() {
    const snap = this.sql<{ tick: number; blob: ArrayBuffer }>("SELECT tick, blob FROM snapshots ORDER BY tick DESC LIMIT 1")[0];
    const orders: ResumeOrder[] = this.sql<{ tick: number; faction: string; from_agent: string; body: ArrayBuffer }>(
      "SELECT tick, faction, from_agent, body FROM orders WHERE tick >= ? AND state = 'FORWARDED' ORDER BY rowid", snap ? snap.tick : 0,
    ).map((o) => {
      const b = decode<{ batch: OrderBatch; source: string }>(new Uint8Array(o.body));
      return { tick: o.tick, faction: o.faction as "BLUE" | "RED", from: o.from_agent, batch: b.batch, source: b.source };
    });
    // A fresh branch replays its parent's orders up to the branch tick, then pauses there.
    const plan = this.ctx.storage.kv.get<{ orders: ResumeOrder[]; pauseAtTick: number }>("branch");
    const fresh = plan && this.meta!.lastSeq === 0;
    return {
      t: "RESUME" as const, snapshot: snap ? new Uint8Array(snap.blob) : undefined, orders: fresh ? [...plan.orders, ...orders] : orders,
      pauseAtTick: fresh ? plan.pauseAtTick : undefined, speed: this.meta!.speed, paused: this.meta!.status !== "RUNNING" && !fresh,
    };
  }

  override async webSocketMessage(ws: WebSocket, data: ArrayBuffer | string) {
    const who = ws.deserializeAttachment() as JoinClaims;
    this.requests++;
    let frame: { t: string };
    try {
      frame = decode(data);
    } catch {
      return;
    }
    const isHost = this.ctx.getWebSockets("host").includes(ws);
    switch (frame.t) {
      case "HELLO":
        return this.hello(ws, who, frame as { t: "HELLO"; lastSeq?: number });
      case "DELTA":
        if (isHost) return this.hostDelta(frame as DeltaFrame, ws);
        return;
      case "AAR":
        if (isHost) return this.finalize(frame as AarFrame);
        return;
      case "ORDER": {
        const r = await this.acceptOrder(who, frame as OrderFrame);
        if (!r.ok) ws.send(encode({ t: "ERROR", message: r.error }));
        return;
      }
      case "CONTROL": {
        const r = await this.control(who, frame as ControlFrame);
        if (!r.ok) ws.send(encode({ t: "ERROR", message: r.error }));
        return;
      }
    }
  }

  override async webSocketClose(ws: WebSocket) {
    if (this.meta && this.ctx.getWebSockets("host").every((s) => s === ws)) {
      if (this.meta.profile === "B" && this.meta.hostConnected) {
        this.meta.hostConnected = false;
        if (this.meta.status === "RUNNING") this.meta.status = "PAUSED";
        this.saveMeta();
        this.broadcastStatus();
      }
    }
  }

  private async hello(ws: WebSocket, who: JoinClaims, f: { lastSeq?: number }) {
    if (!this.meta) return;
    const view = who.view;
    let d: ViewDelta = this.viewCache[view] ?? { view, tick: this.meta.tick, simMs: this.meta.simMs };
    if (this.meta.profile === "A") d = this.ensureEngine().viewSnapshot(view);
    else if (!this.viewCache[view]) for (const h of this.ctx.getWebSockets("host")) h.send(encode({ t: "CONTROL", op: "snapshot_request", view }));
    ws.send(encode({ t: "SNAPSHOT", meta: this.meta, d, agents: this.agents(), decisions: this.decisions(view, 60) }));
    const events = this.eventsFrom(view, (f.lastSeq ?? 0) + 1, 400);
    if (events.length) ws.send(encode({ t: "EVENT", events }));
  }

  private send(view: View, frame: unknown, except?: WebSocket) {
    const bytes = encode(frame);
    for (const s of this.ctx.getWebSockets(`view:${view}`)) if (s !== except) {
      try { s.send(bytes); } catch { /* closed */ }
    }
  }

  private broadcastStatus() {
    if (!this.meta) return;
    const frame = { t: "STATUS", meta: this.meta, agents: this.agents() };
    for (const v of VIEWS) this.send(v, frame);
  }

  // ------------------------------------------------------------------ deltas (Profile B host, or Profile A engine)

  private async hostDelta(frame: DeltaFrame, sender: WebSocket | null) {
    if (!this.meta) return;
    for (const v of VIEWS) {
      const part = frame.views?.[v];
      if (!part) continue;
      if (part.full) this.viewCache[v] = part;
      this.send(v, { t: "DELTA", tick: frame.tick, simMs: frame.simMs, d: part }, sender ?? undefined);
    }
    if (frame.events?.length) {
      const first = frame.events[0].seq, last = frame.events[frame.events.length - 1].seq;
      this.sql("INSERT OR REPLACE INTO events (seq, seq_to, tick, sim_ms, batch) VALUES (?, ?, ?, ?, ?)", first, last, frame.tick, frame.simMs, ab(encode(frame.events)));
      this.meta.lastSeq = last;
    }
    this.meta.tick = frame.tick;
    this.meta.simMs = frame.simMs;
    if (this.meta.status === "WAITING_HOST") this.meta.status = "RUNNING";
    if (frame.snapshot) {
      this.sql("INSERT OR REPLACE INTO snapshots (tick, sim_ms, blob) VALUES (?, ?, ?)", frame.tick, frame.simMs, ab(frame.snapshot));
      this.sql("DELETE FROM snapshots WHERE tick NOT IN (SELECT tick FROM snapshots ORDER BY tick DESC LIMIT 3)");
      // Archive a snapshot every six simulated hours (R2, or D1 when R2 is not bound).
      if (Math.round(frame.simMs / 3_600_000) % 6 === 0) {
        this.ctx.waitUntil(archiveStore(this.env).put(`sessions/${this.meta.id}/snapshots/${frame.tick}.msgpack`, frame.snapshot));
      }
    }
    if (frame.cop) await this.pushCops(frame.cop);
    if (++this.deltasSinceMeta >= 30 || frame.cop) {
      this.saveMeta();
      const n = this.requests;
      this.requests = 0;
      if (n > 0) this.ctx.waitUntil(this.env.USAGE.get(this.env.USAGE.idFromName("global")).reportRequests(n));
    }
    if (frame.ended && this.meta.profile === "A") await this.finalize(null);
  }

  /** Agent bridge: each faction's COP goes to its FactionAgent once per simulated hour. */
  private async pushCops(cop: Partial<Record<"BLUE" | "RED", CopForAgents>>) {
    for (const f of ["BLUE", "RED"] as const) {
      const c = cop[f];
      if (!c) continue;
      try {
        const stub = await this.faction(f);
        await stub.onCopUpdate(c);
      } catch (err) {
        console.error(JSON.stringify({ session: this.meta?.id, faction: f, error: String(err) }));
      }
    }
  }

  // ------------------------------------------------------------------ orders and seats

  private forward(faction: "BLUE" | "RED", from: string, batch: OrderBatch, source: string, decision: Decision) {
    const id = decision.id;
    const tick = this.meta!.tick;
    this.sql("INSERT OR REPLACE INTO orders (id, faction, from_agent, sim_ms, tick, body, state) VALUES (?, ?, ?, ?, ?, ?, 'FORWARDED')", id, faction, from, this.meta!.simMs, tick, ab(encode({ batch, source })));
    if (this.meta!.profile === "A") this.ensureEngine().submit({ faction, from, batch, source });
    else for (const h of this.ctx.getWebSockets("host")) h.send(encode({ t: "ORDER", seat: from, batch, decision }));
  }

  private recordDecision(d: Decision) {
    this.sql("INSERT OR REPLACE INTO decisions (id, sim_ms, faction, body) VALUES (?, ?, ?, ?)", d.id, d.simMs, d.faction, JSON.stringify(d));
    this.sql("DELETE FROM decisions WHERE id NOT IN (SELECT id FROM decisions ORDER BY sim_ms DESC LIMIT 400)");
    const frame = { t: "RATIONALE", decision: d };
    this.send(d.faction as View, frame);
    this.send("WHITE", frame);
  }

  /** RPC from FactionAgent. Ignored when a human holds the seat. */
  async submitAgentOrders(faction: "BLUE" | "RED", role: Role, decision: Decision) {
    if (!this.meta || this.meta.status === "ENDED") return { ok: false };
    const seat = agentId(faction, role);
    const holder = this.sql<{ holder: string }>("SELECT holder FROM seats WHERE agent_id = ?", seat)[0]?.holder ?? "AI";
    if (holder !== "AI") return { ok: false, reason: "seat held by a human" };
    this.recordDecision(decision);
    if (decision.orders.length) this.forward(faction, seat, { orders: decision.orders, rationale: decision.rationale, confidence: decision.confidence }, decision.source, decision);
    return { ok: true };
  }

  async acceptOrder(who: JoinClaims, frame: OrderFrame): Promise<{ ok: boolean; error?: string }> {
    if (!this.meta || this.meta.status === "ENDED") return { ok: false, error: "session not running" };
    const seat = parseAgentId(frame.seat);
    if (!seat) return { ok: false, error: "unknown seat" };
    const holder = this.sql<{ holder: string }>("SELECT holder FROM seats WHERE agent_id = ?", frame.seat)[0]?.holder;
    if (holder !== who.sub) return { ok: false, error: "take over the seat before issuing orders" };
    if (who.view !== seat.faction && !who.owner) return { ok: false, error: "seat belongs to another faction" };
    const parsed = OrderBatchSchema.safeParse(frame.batch);
    if (!parsed.success) return { ok: false, error: `invalid order: ${parsed.error.issues[0]?.message}` };
    const decision: Decision = {
      ...parsed.data, id: crypto.randomUUID(), agent: frame.seat, role: seat.role, faction: seat.faction, simMs: this.meta.simMs, source: "HUMAN",
    };
    this.recordDecision(decision);
    this.forward(seat.faction as "BLUE" | "RED", frame.seat, parsed.data, "HUMAN", decision);
    return { ok: true };
  }

  async control(who: JoinClaims, f: ControlFrame): Promise<{ ok: boolean; error?: string; meta?: SessionMeta }> {
    if (!this.meta) return { ok: false, error: "no session" };
    const m = this.meta;
    if (f.op === "seat") {
      const seat = f.seat ? parseAgentId(f.seat) : null;
      if (!seat || seat.faction === "GREEN") return { ok: false, error: "unknown seat" };
      if (who.view !== seat.faction && !who.owner) return { ok: false, error: "seat belongs to another faction" };
      const cur = this.sql<{ holder: string }>("SELECT holder FROM seats WHERE agent_id = ?", f.seat!)[0]?.holder ?? "AI";
      if (f.take) {
        if (cur !== "AI" && cur !== who.sub) return { ok: false, error: `seat held by ${cur}` };
        this.sql("UPDATE seats SET holder = ?, since = ? WHERE agent_id = ?", who.sub, Date.now(), f.seat!);
      } else {
        if (cur !== who.sub && !who.owner) return { ok: false, error: "only the holder can release this seat" };
        this.sql("UPDATE seats SET holder = 'AI', since = ? WHERE agent_id = ?", Date.now(), f.seat!);
      }
      const stub = await this.faction(seat.faction);
      await stub.seatTakeover(seat.role, f.take ? who.sub : null);
      const ev: EventView = { seq: 0, simMs: m.simMs, type: "SEAT", vis: ["WHITE", seat.faction as View], text: `${who.name} ${f.take ? "took over" : "handed back"} ${f.seat}` };
      this.send("WHITE", { t: "EVENT", events: [ev] });
      this.send(seat.faction as View, { t: "EVENT", events: [ev] });
      this.broadcastStatus();
      return { ok: true };
    }
    if (!who.owner) return { ok: false, error: "only the session owner controls time" };
    switch (f.op) {
      case "pause": m.status = m.status === "ENDED" ? "ENDED" : "PAUSED"; break;
      case "resume": if (m.status !== "ENDED") m.status = m.profile === "B" && !m.hostConnected ? "WAITING_HOST" : "RUNNING"; break;
      case "speed": m.speed = Math.max(1, Math.min(3600, Math.round(f.speed ?? 1))); break;
      case "rules_only": {
        m.rulesOnly = !!f.value;
        for (const fac of ["BLUE", "RED", "WHITE"] as const) await (await this.faction(fac)).setRulesOnly(m.rulesOnly);
        break;
      }
      case "end":
        if (m.profile === "A") await this.finalize(null);
        break;
      case "inject":
        if (m.profile === "A" && f.inject) {
          this.ensureEngine().submit({ faction: "BLUE", from: "white.director", source: "INJECT", batch: { orders: [], rationale: f.inject.text, confidence: 1 }, inject: { ...f.inject, faction: f.inject.faction as Faction | undefined } });
        }
        break;
    }
    this.saveMeta();
    if (m.profile === "B") for (const h of this.ctx.getWebSockets("host")) h.send(encode(f));
    else if (m.status === "RUNNING") await this.ctx.storage.setAlarm(Date.now() + 10);
    if (m.profile === "A" && (f.op === "step" || f.op === "next_event")) await this.ctx.storage.setAlarm(Date.now() + 10);
    this.broadcastStatus();
    return { ok: true, meta: m };
  }

  // ------------------------------------------------------------------ queries

  agents(): AgentStatus[] {
    const seats = this.sql<{ agent_id: string; faction: string; holder: string }>("SELECT agent_id, faction, holder FROM seats");
    const last = new Map<string, Decision>();
    for (const r of this.sql<{ body: string }>("SELECT body FROM decisions ORDER BY sim_ms DESC LIMIT 200")) {
      const d = JSON.parse(r.body) as Decision;
      if (!last.has(d.agent)) last.set(d.agent, d);
    }
    return seats.map((s) => {
      const p = parseAgentId(s.agent_id)!;
      const d = last.get(s.agent_id);
      return { id: s.agent_id, faction: p.faction, role: p.role, seat: s.holder, lastDecisionMs: d?.simMs, lastSource: d?.source, budgetLeft: d?.budgetLeft };
    });
  }

  decisions(view: View, limit: number): Decision[] {
    const rows = view === "WHITE"
      ? this.sql<{ body: string }>("SELECT body FROM decisions ORDER BY sim_ms DESC LIMIT ?", limit)
      : this.sql<{ body: string }>("SELECT body FROM decisions WHERE faction = ? ORDER BY sim_ms DESC LIMIT ?", view, limit);
    return rows.map((r) => JSON.parse(r.body) as Decision).reverse();
  }

  eventsFrom(view: View, fromSeq: number, limit = 500): EventView[] {
    const out: EventView[] = [];
    const rows = this.sql<{ batch: ArrayBuffer }>("SELECT batch FROM events WHERE seq_to >= ? ORDER BY seq LIMIT 200", fromSeq);
    for (const r of rows) {
      for (const e of decode<EventView[]>(new Uint8Array(r.batch))) {
        if (e.seq >= fromSeq && e.vis.includes(view)) out.push(e);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  private allEvents(): EventView[] {
    const out: EventView[] = [];
    for (const r of this.sql<{ batch: ArrayBuffer }>("SELECT batch FROM events ORDER BY seq")) out.push(...decode<EventView[]>(new Uint8Array(r.batch)));
    return out;
  }

  async apiEvents(view: View, from: number) {
    return { events: this.eventsFrom(view, from, 500), lastSeq: this.meta?.lastSeq ?? 0 };
  }

  async apiAgents(view: View) {
    return { agents: this.agents().filter((a) => view === "WHITE" || a.faction === view), decisions: this.decisions(view, 100) };
  }

  async audit(faction: "BLUE" | "RED" | "WHITE", limit = 50) {
    const stub = await this.faction(faction);
    return stub.auditLog(limit);
  }

  /** Branch support: the snapshot at or before `tick` plus forwarded orders up to `tick`. */
  async branchSource(tick: number) {
    const snap = this.sql<{ tick: number; blob: ArrayBuffer }>("SELECT tick, blob FROM snapshots WHERE tick <= ? ORDER BY tick DESC LIMIT 1", tick)[0]
      ?? this.sql<{ tick: number; blob: ArrayBuffer }>("SELECT tick, blob FROM snapshots ORDER BY tick ASC LIMIT 1")[0];
    if (!snap) return null;
    const orders: ResumeOrder[] = this.sql<{ tick: number; faction: string; from_agent: string; body: ArrayBuffer }>(
      "SELECT tick, faction, from_agent, body FROM orders WHERE tick >= ? AND tick <= ? ORDER BY rowid", snap.tick, tick,
    ).map((o) => {
      const b = decode<{ batch: OrderBatch; source: string }>(new Uint8Array(o.body));
      return { tick: o.tick, faction: o.faction as "BLUE" | "RED", from: o.from_agent, batch: b.batch, source: b.source };
    });
    return { snapshot: new Uint8Array(snap.blob), orders, snapTick: snap.tick };
  }

  async branchPlan(): Promise<{ orders: ResumeOrder[]; pauseAtTick: number } | null> {
    return (await this.ctx.storage.kv.get("branch")) ?? null;
  }

  // ------------------------------------------------------------------ AAR and end of session

  async aar(): Promise<{ report: AarReport | null; narrative: unknown }> {
    if (!this.meta) return { report: null, narrative: null };
    const row = await this.env.DB.prepare("SELECT metrics_json, narrative_json FROM aar WHERE session_id = ?").bind(this.meta.id).first<{ metrics_json: string; narrative_json: string | null }>();
    if (row) return { report: JSON.parse(row.metrics_json) as AarReport, narrative: row.narrative_json ? JSON.parse(row.narrative_json) : null };
    return { report: computeAar(this.allEvents()), narrative: null };
  }

  private async finalize(frame: AarFrame | null) {
    if (!this.meta || this.meta.status === "ENDED" && frame === null) return;
    const m = this.meta;
    m.status = "ENDED";
    this.ctx.storage.kv.put("endedAt", Date.now());
    this.saveMeta();
    this.broadcastStatus();
    const events = this.allEvents();
    const report = (frame?.report as AarReport | undefined) ?? computeAar(events);
    const notable = frame?.notable ?? events.filter((e) => e.notable);
    const archive = archiveStore(this.env);
    const key = `sessions/${m.id}/events-0.msgpack`;
    try {
      await archive.put(key, encode(events));
    } catch (err) {
      console.error(JSON.stringify({ session: m.id, archive: archive.kind, error: String(err) }));
    }
    await this.env.DB.prepare("UPDATE sessions SET status = 'ENDED', ended_at = ?, archive_key = ? WHERE id = ?").bind(Date.now(), key, m.id).run();
    await this.env.DB.prepare("INSERT OR REPLACE INTO aar (session_id, metrics_json, narrative_key, narrative_json) VALUES (?, ?, NULL, NULL)").bind(m.id, JSON.stringify(report)).run();
    let narrative = null;
    try {
      const white = await this.faction("WHITE");
      narrative = await white.analyzeAar(report.narrative.summary, notable);
    } catch (err) {
      console.error(JSON.stringify({ session: m.id, aar: "llm", error: String(err) }));
    }
    if (narrative) await this.env.DB.prepare("UPDATE aar SET narrative_json = ? WHERE session_id = ?").bind(JSON.stringify(narrative), m.id).run();
    const ev: EventView = { seq: m.lastSeq + 1, simMs: m.simMs, type: "AAR_READY", vis: ["WHITE", "BLUE", "RED"], text: `After-action review ready (${narrative ? "AAR Analyst narrative" : "rule-based narrative"}) at ${fmtSimTime(m.simMs)}`, notable: true };
    for (const v of VIEWS) this.send(v, { t: "EVENT", events: [ev] });
    // Hot SQLite rows are deleted 7 days after the session ends (they are archived above).
    await this.ctx.storage.setAlarm(Date.now() + 7 * 86_400_000);
  }

  // ------------------------------------------------------------------ Profile A: engine in the Durable Object

  private ensureEngine(): Engine {
    if (this.engine) return this.engine;
    const scn = getScenario(this.meta!.scenarioId)!;
    const core = this.sql<{ state: ArrayBuffer }>("SELECT state FROM core WHERE id = 1")[0];
    if (!core) {
      this.engine = Engine.create(scn, this.meta!.seed, { tickMs: PROFILE_A_TICK_MS });
      this.persistEngine(true);
    } else {
      const state = decode<Record<string, unknown>>(new Uint8Array(core.state));
      const entities: unknown[] = [];
      for (const s of this.sql<{ state: ArrayBuffer }>("SELECT state FROM entity_shards ORDER BY shard")) entities.push(...decode<unknown[]>(new Uint8Array(s.state)));
      state.entities = entities;
      this.engine = Engine.restore(scn, state as never);
    }
    this.idIndex = new Map(this.engine.state.entities.map((e, i) => [e.id, i]));
    return this.engine;
  }

  /** Entities are stored as ~40-entity msgpack shards: the free tier meters rows written, not bytes. */
  private persistEngine(full = false) {
    const eng = this.engine!;
    const s = eng.state;
    const ents = s.entities;
    if (ents.length !== this.idIndex.size) this.idIndex = new Map(ents.map((e, i) => [e.id, i]));
    const shards = new Set<number>();
    if (full) for (let i = 0; i < ents.length; i += SHARD) shards.add(i / SHARD);
    else for (const id of eng.ctx.dirty) { const i = this.idIndex.get(id); if (i !== undefined) shards.add(Math.floor(i / SHARD)); }
    for (const sh of shards) this.sql("INSERT OR REPLACE INTO entity_shards (shard, state) VALUES (?, ?)", sh, ab(encode(ents.slice(sh * SHARD, sh * SHARD + SHARD))));
    eng.ctx.s.rngDraws = eng.ctx.rng.draws;
    this.sql("INSERT OR REPLACE INTO core (id, state) VALUES (1, ?)", ab(encode({ ...s, entities: [] })));
    this.sql("INSERT OR REPLACE INTO cursor (id, tick, phase, offset) VALUES (1, ?, ?, ?)", s.tick, String(s.cursor.phase), s.cursor.offset);
  }

  override async alarm() {
    if (!this.meta) return;
    if (this.meta.status === "ENDED") {
      // Retention: hot rows go 7 days after the end; the archive keeps the log.
      const endedAt = this.ctx.storage.kv.get<number>("endedAt") ?? 0;
      if (Date.now() - endedAt >= 7 * 86_400_000 - 60_000) this.sql("DELETE FROM events; DELETE FROM entity_shards; DELETE FROM core; DELETE FROM snapshots;");
      return;
    }
    if (this.meta.profile !== "A" || this.meta.status !== "RUNNING") return;
    const eng = this.ensureEngine();
    const r = eng.stepSlice(SLICE_BUDGET);
    if (!r) {
      this.persistEngine();
      await this.ctx.storage.setAlarm(Date.now());
      return;
    }
    // Tick complete: drain, broadcast, persist.
    const { views, events } = eng.drain({ c2: r.tick % 5 === 0 });
    const frame: DeltaFrame = { t: "DELTA", tick: r.tick, simMs: r.simMs, views, events, cop: r.cops, ended: r.ended };
    if (r.hour) frame.snapshot = eng.snapshot();
    this.persistEngine();
    await this.hostDelta(frame, null);
    if (r.ended) return;
    const wallPerTick = eng.state.tickMs / Math.max(1, this.meta.speed);
    const next = Math.max(Date.now(), this.lastTickWall + wallPerTick);
    this.lastTickWall = next;
    await this.ctx.storage.setAlarm(next);
  }
}
