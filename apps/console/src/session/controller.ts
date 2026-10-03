// Session controller: one interface over three modes.
//  local  — engine + rules agents in a Web Worker, no server (offline sandbox, rewind/replay).
//  host   — Profile B owner: engine in a Web Worker, deltas streamed to the SessionDO hub (≤1/s).
//  viewer — any other seat (or any Profile A client): state arrives over the hub WebSocket.
import {
  decode, encode, PROTOCOL_VERSION, type ControlFrame, type Decision, type DeltaFrame, type EventView, type Frame, type OrderBatch,
  type ResumeFrame, type SessionMeta, type View, type ViewDelta,
} from "@sentinel/protocol";
import { getScenario } from "@sentinel/scenarios";
import { useStore } from "../store";
import { mergeDelta } from "../lib/merge";
import type { FromWorker, ToWorker } from "../engine/messages";
import { api, type CreatedSession } from "../lib/api";
import { getUser, saveTokens } from "../lib/identity";

/** msgpack bytes backed by a plain ArrayBuffer (what WebSocket.send expects). */
const bin = (frame: unknown) => new Uint8Array(encode(frame));

class HubClient {
  ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private lastSeq = 0;
  private ping: ReturnType<typeof setInterval> | null = null;
  constructor(private sid: string, private token: string, private view: View, private onFrame: (f: Frame) => void, private onOpen?: () => void) {}

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/sessions/${this.sid}?t=${encodeURIComponent(this.token)}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      useStore.getState().set({ connected: true });
      ws.send(bin({ t: "HELLO", view: this.view, clientVersion: PROTOCOL_VERSION, lastSeq: this.lastSeq }));
      this.onOpen?.();
      this.ping = setInterval(() => ws.readyState === 1 && ws.send(bin({ t: "PING" })), 50_000);
    };
    ws.onmessage = (ev) => {
      const f = decode<Frame>(ev.data as ArrayBuffer);
      if (f.t === "DELTA" && f.d?.events?.length) this.lastSeq = Math.max(this.lastSeq, f.d.events[f.d.events.length - 1].seq);
      if (f.t === "EVENT" && f.events.length) this.lastSeq = Math.max(this.lastSeq, ...f.events.map((e) => e.seq));
      this.onFrame(f);
    };
    ws.onclose = (ev) => {
      if (this.ping) clearInterval(this.ping);
      useStore.getState().set({ connected: false });
      if (this.closed || ev.code === 4000) {
        if (ev.code === 4000) useStore.getState().notify("Another tab took over as host.", true);
        return;
      }
      this.retry++;
      setTimeout(() => !this.closed && this.connect(), Math.min(15_000, 500 * 2 ** this.retry));
    };
  }

  send(frame: unknown) {
    if (this.ws?.readyState === 1) this.ws.send(bin(frame));
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

export class SessionController {
  private worker: Worker | null = null;
  private hub: HubClient | null = null;
  private hubBuffer: { views: Partial<Record<View, ViewDelta>>; events: EventView[]; cop?: DeltaFrame["cop"]; snapshot?: Uint8Array; ended?: boolean; tick: number; simMs: number } | null = null;
  private hubTimer: ReturnType<typeof setInterval> | null = null;
  private workerStarted = false;
  sid: string | null = null;

  // ------------------------------------------------------------------ start

  startLocal(scenarioId: string, seed: number) {
    const scenario = getScenario(scenarioId)!;
    const meta: SessionMeta = {
      id: "local", scenarioId, scenarioName: scenario.name, seed, profile: "B", status: "PAUSED", speed: 600, simMs: 0, tick: 0, owner: getUser().id,
      createdAt: Date.now(), hostConnected: true, rulesOnly: true, lastSeq: 0,
    };
    useStore.getState().reset({ mode: "local", meta, scenario, view: "WHITE", allowedViews: ["WHITE", "BLUE", "RED"], tokens: {}, playing: false, speed: 600 });
    useStore.getState().set({ agents: localAgents() });
    this.spawnWorker();
    this.toWorker({ type: "init", scenarioId, seed, mode: "local", speed: 600 });
  }

  startOnline(created: CreatedSession, preferView?: View) {
    const meta = created.session;
    this.sid = meta.id;
    saveTokens(meta.id, created);
    const scenario = getScenario(meta.scenarioId)!;
    const user = getUser();
    const owner = meta.owner === user.id;
    const allowed = (["WHITE", "BLUE", "RED"] as View[]).filter((v) => created.tokens[v]);
    const view = preferView && allowed.includes(preferView) ? preferView : allowed[0];
    const host = owner && meta.profile === "B" && !!created.tokens.WHITE;
    useStore.getState().reset({ mode: host ? "host" : "viewer", meta, scenario, view, allowedViews: allowed, tokens: created.tokens, joinCode: created.joinCode, playing: meta.status === "RUNNING", speed: meta.speed });
    if (host) {
      this.spawnWorker();
      this.hub = new HubClient(meta.id, created.tokens.WHITE!, "WHITE", (f) => this.onHostFrame(f));
      this.hub.connect();
      this.hubTimer = setInterval(() => this.flushHub(), 1000);
    } else {
      this.connectViewer(view);
    }
  }

  private connectViewer(view: View) {
    const s = useStore.getState();
    this.hub?.close();
    this.hub = new HubClient(this.sid!, s.tokens[view]!, view, (f) => this.onViewerFrame(f));
    this.hub.connect();
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
    this.workerStarted = false;
    this.hub?.close();
    this.hub = null;
    if (this.hubTimer) clearInterval(this.hubTimer);
    this.hubTimer = null;
    this.hubBuffer = null;
  }

  // ------------------------------------------------------------------ worker

  private spawnWorker() {
    this.worker?.terminate();
    this.worker = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onWorker(ev.data);
  }

  private toWorker(m: ToWorker) {
    this.worker?.postMessage(m);
  }

  private onWorker(m: FromWorker) {
    const st = useStore.getState();
    switch (m.type) {
      case "frame": {
        st.applyDelta(m.views[st.view]);
        st.set({ allEvents: st.allEvents.concat(m.events).slice(-60_000) });
        if (st.mode === "host") {
          const b = this.hubBuffer ?? { views: {}, events: [], tick: m.tick, simMs: m.simMs };
          for (const v of ["WHITE", "BLUE", "RED"] as View[]) b.views[v] = mergeDelta(b.views[v], m.views[v]);
          b.events.push(...m.events);
          if (m.cops) b.cop = m.cops;
          if (m.snapshot) b.snapshot = m.snapshot;
          if (m.ended) b.ended = true;
          b.tick = m.tick;
          b.simMs = m.simMs;
          this.hubBuffer = b;
          if (m.cops || m.ended) this.flushHub();
        }
        break;
      }
      case "full":
        if (m.view === st.view) st.applyDelta(m.delta);
        if (st.mode === "host" && this.hubBuffer) this.hubBuffer.views[m.view] = m.delta;
        else if (st.mode === "host") this.hubBuffer = { views: { [m.view]: m.delta }, events: [], tick: m.delta.tick, simMs: m.delta.simMs };
        break;
      case "status":
        st.set({ playing: m.playing, speed: m.speed, actualSpeed: m.actualSpeed, ended: m.ended, maxTick: m.maxTick, meta: st.meta ? { ...st.meta, status: m.ended ? "ENDED" : m.playing ? "RUNNING" : "PAUSED", speed: m.speed } : st.meta });
        break;
      case "decision":
        st.addDecision(m.decision);
        break;
      case "rewound":
        st.set({ allEvents: m.events, events: m.events.filter((e) => e.vis.includes(st.view)).slice(-5000) });
        break;
      case "aar":
        st.set({ aar: { report: m.report, narrative: null } });
        if (st.mode === "host") this.hub?.send({ t: "AAR", report: m.report, notable: m.notable });
        break;
      case "error":
        st.notify(m.message, true);
        break;
    }
  }

  private flushHub() {
    const b = this.hubBuffer;
    if (!b || !this.hub) return;
    this.hubBuffer = null;
    const frame: DeltaFrame = { t: "DELTA", tick: b.tick, simMs: b.simMs, views: b.views, events: b.events, cop: b.cop, snapshot: b.snapshot, ended: b.ended };
    this.hub.send(frame);
  }

  private onHostFrame(f: Frame) {
    const st = useStore.getState();
    switch (f.t) {
      case "RESUME": {
        const r = f as ResumeFrame;
        if (!this.workerStarted) {
          this.workerStarted = true;
          const meta = st.meta!;
          this.toWorker({ type: "init", scenarioId: meta.scenarioId, seed: meta.seed, mode: "host", speed: r.speed, resume: { snapshot: r.snapshot, orders: r.orders, pauseAtTick: r.pauseAtTick, paused: r.paused } });
        }
        break;
      }
      case "ORDER":
        this.toWorker({ type: "order", faction: (f.decision?.faction ?? f.seat.split(".")[0].toUpperCase()) as "BLUE" | "RED", from: f.seat, batch: f.batch, source: f.decision?.source ?? "HUMAN" });
        break;
      case "CONTROL":
        this.applyControlToWorker(f);
        break;
      case "RATIONALE":
        st.addDecision(f.decision);
        break;
      case "STATUS":
        st.set({ meta: f.meta, agents: f.agents ?? st.agents });
        break;
      case "SNAPSHOT":
        st.set({ meta: f.meta, agents: f.agents });
        for (const d of f.decisions) st.addDecision(d);
        break;
      case "EVENT":
        st.addEvents(f.events);
        break;
      case "ERROR":
        st.notify(f.message, true);
        break;
    }
  }

  private applyControlToWorker(f: ControlFrame) {
    switch (f.op) {
      case "pause": this.toWorker({ type: "play", playing: false }); break;
      case "resume": this.toWorker({ type: "play", playing: true }); break;
      case "speed": this.toWorker({ type: "speed", speed: f.speed ?? 600 }); break;
      case "step": this.toWorker({ type: "step" }); break;
      case "next_event": this.toWorker({ type: "next_event" }); break;
      case "inject": if (f.inject) this.toWorker({ type: "inject", inject: f.inject as never }); break;
      case "snapshot_request": if (f.view) this.toWorker({ type: "view", view: f.view }); break;
      case "end": this.toWorker({ type: "aar" }); break;
    }
  }

  private onViewerFrame(f: Frame) {
    const st = useStore.getState();
    switch (f.t) {
      case "SNAPSHOT":
        st.set({ meta: f.meta, agents: f.agents, playing: f.meta.status === "RUNNING", speed: f.meta.speed, ended: f.meta.status === "ENDED" });
        st.applyDelta(f.d);
        for (const d of f.decisions) st.addDecision(d);
        break;
      case "DELTA":
        if (f.d) st.applyDelta(f.d);
        break;
      case "EVENT":
        st.addEvents(f.events);
        if (f.events.some((e) => e.type === "AAR_READY")) st.notify("After-action review is ready.");
        break;
      case "RATIONALE":
        st.addDecision(f.decision);
        break;
      case "STATUS":
        st.set({ meta: f.meta, agents: f.agents ?? st.agents, playing: f.meta.status === "RUNNING", speed: f.meta.speed, ended: f.meta.status === "ENDED", actualSpeed: f.meta.speed });
        break;
      case "ERROR":
        st.notify(f.message, true);
        break;
    }
  }

  // ------------------------------------------------------------------ commands

  private control(frame: Omit<ControlFrame, "t">) {
    const st = useStore.getState();
    if (st.mode === "local") return this.applyControlToWorker({ t: "CONTROL", ...frame });
    this.hub?.send({ t: "CONTROL", ...frame });
  }

  play(playing: boolean) {
    this.control({ op: playing ? "resume" : "pause" });
  }
  setSpeed(speed: number) {
    this.control({ op: "speed", speed });
  }
  step() {
    this.control({ op: "step" });
  }
  nextEvent() {
    this.control({ op: "next_event" });
  }
  inject(inject: { kind: string; text: string; faction?: "BLUE" | "RED"; at?: [number, number] }) {
    this.control({ op: "inject", inject });
  }
  end() {
    this.control({ op: "end" });
  }
  rulesOnly(value: boolean) {
    this.control({ op: "rules_only", value });
  }

  /** Local: deterministic rewind/branch. Online host: create a server-side branch session. */
  async seek(tick: number): Promise<CreatedSession | null> {
    const st = useStore.getState();
    if (st.mode === "local") {
      this.toWorker({ type: "seek", tick });
      return null;
    }
    if (st.mode === "host" && st.tokens.WHITE && this.sid) {
      return api.branch(this.sid, st.tokens.WHITE, tick);
    }
    st.notify("Only the session owner can branch.", true);
    return null;
  }

  switchView(view: View) {
    const st = useStore.getState();
    if (!st.allowedViews.includes(view) || view === st.view) return;
    st.reset({ ...pick(st), view });
    if (st.mode === "local" || st.mode === "host") {
      this.toWorker({ type: "view", view });
      useStore.getState().set({ events: st.allEvents.filter((e) => e.vis.includes(view)).slice(-5000), decisions: [] });
    } else {
      this.connectViewer(view);
    }
  }

  seat(agent: string, take: boolean) {
    const st = useStore.getState();
    if (st.mode === "local") {
      const set = new Set(st.humanSeats);
      if (take) set.add(agent);
      else set.delete(agent);
      st.set({ humanSeats: [...set], agents: st.agents.map((a) => (a.id === agent ? { ...a, seat: take ? getUser().id : "AI" } : a)) });
      this.toWorker({ type: "seats", human: [...set] });
      st.notify(`${take ? "Took over" : "Handed back"} ${agent}`);
      return;
    }
    this.hub?.send({ t: "CONTROL", op: "seat", seat: agent, take });
  }

  order(seat: string, batch: OrderBatch) {
    const st = useStore.getState();
    const faction = seat.split(".")[0].toUpperCase() as "BLUE" | "RED";
    if (st.mode === "local") {
      this.toWorker({ type: "order", faction, from: seat, batch, source: "HUMAN" });
      const d: Decision = { ...batch, id: crypto.randomUUID(), agent: seat, role: seat.split(".")[1] as Decision["role"], faction, simMs: st.simMs, source: "HUMAN" };
      st.addDecision(d);
      return;
    }
    this.hub?.send({ t: "ORDER", seat, batch });
  }

  requestAar() {
    this.toWorker({ type: "aar" });
  }
}

function pick(st: ReturnType<typeof useStore.getState>) {
  return {
    mode: st.mode, meta: st.meta, scenario: st.scenario, allowedViews: st.allowedViews, tokens: st.tokens, joinCode: st.joinCode, playing: st.playing,
    speed: st.speed, agents: st.agents, allEvents: st.allEvents, teaching: st.teaching, teachSeen: st.teachSeen, humanSeats: st.humanSeats, maxTick: st.maxTick,
  };
}

function localAgents() {
  const out = [];
  for (const f of ["BLUE", "RED"] as const) {
    for (const r of ["nca", "jfc", "lcc", "mcc", "acc", "scc", "cyber", "j2", "j4", "j5", "j6"] as const) {
      out.push({ id: `${f.toLowerCase()}.${r}`, faction: f, role: r, seat: "AI" });
    }
  }
  return out;
}

export const controller = new SessionController();
