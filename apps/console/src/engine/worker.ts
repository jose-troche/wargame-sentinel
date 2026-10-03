/// <reference lib="webworker" />
// The World Engine host (Profile B) and local sandbox: runs @sentinel/engine off the UI thread,
// paces ticks to the requested speed, runs rules agents locally (local mode), keeps hourly snapshots
// for rewind/replay, and emits per-view frames at ~5 Hz.
import { Engine, computeAar } from "@sentinel/engine";
import { RulesCommander } from "@sentinel/agents-rules";
import { getScenario } from "@sentinel/scenarios";
import type { EventView, ResumeOrder, View } from "@sentinel/protocol";
import type { FromWorker, ToWorker, WorkerMode } from "./messages";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FromWorker, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

let engine: Engine | null = null;
let scenarioId = "";
let mode: WorkerMode = "local";
let speed = 600;
let playing = false;
let commander = new RulesCommander();
let humanSeats = new Set<string>();
const snapshots = new Map<number, Uint8Array>();
let allEvents: EventView[] = [];
let pendingCops: { BLUE: import("@sentinel/protocol").CopForAgents; RED: import("@sentinel/protocol").CopForAgents } | undefined;
let pendingSnapshot: Uint8Array | undefined;
let queued: ResumeOrder[] = [];
let pauseAtTick: number | undefined;
let budget = 0;
let lastLoop = performance.now();
let lastFrame = 0;
let ticksThisSecond = 0;
let actualSpeed = 0;
let secondStart = performance.now();
let maxTick = 0;
let stepOnce = false;
let seekNotable = false;

function applyQueued() {
  if (!engine) return;
  const t = engine.state.tick;
  while (queued.length && queued[0].tick <= t) {
    const o = queued.shift()!;
    engine.submit({ faction: o.faction, from: o.from, batch: o.batch, source: o.source });
  }
}

function runTick(withAgents: boolean) {
  const eng = engine!;
  applyQueued();
  const r = eng.step();
  ticksThisSecond++;
  if (r.hour) {
    const snap = eng.snapshot();
    snapshots.set(r.tick, snap);
    pruneSnapshots(r.tick);
    if (mode === "host") pendingSnapshot = snap;
    if (r.cops) {
      if (mode === "host") pendingCops = r.cops;
      else if (withAgents) {
        for (const f of ["BLUE", "RED"] as const) {
          for (const d of commander.decide(r.cops[f])) {
            if (d.orders.length) eng.submit({ faction: f, from: d.agent, batch: { orders: d.orders, rationale: d.rationale, confidence: d.confidence }, source: "RULES" });
            post({ type: "decision", decision: d });
          }
        }
      }
    }
  }
  maxTick = Math.max(maxTick, r.tick);
  return r;
}

function pruneSnapshots(now: number) {
  // Hourly for the last two days, then every sixth hour.
  for (const t of snapshots.keys()) {
    if (t === 0) continue;
    const ageH = (now - t) * (engine!.state.tickMs / 3_600_000);
    const hour = Math.round((t * engine!.state.tickMs) / 3_600_000);
    if (ageH > 48 && hour % 6 !== 0) snapshots.delete(t);
  }
}

function emitFrame(force = false) {
  if (!engine) return;
  const now = performance.now();
  if (!force && now - lastFrame < 200) return;
  lastFrame = now;
  const { views, events } = engine.drain();
  allEvents.push(...events);
  if (allEvents.length > 60_000) allEvents = allEvents.slice(-50_000);
  const s = engine.state;
  post({ type: "frame", tick: s.tick, simMs: s.simMs, views, events, cops: pendingCops, snapshot: pendingSnapshot, ended: s.ended });
  pendingCops = undefined;
  pendingSnapshot = undefined;
  status();
}

function status() {
  if (!engine) return;
  const s = engine.state;
  post({ type: "status", playing, speed, tick: s.tick, simMs: s.simMs, ended: s.ended, actualSpeed, maxTick });
}

function loop() {
  const now = performance.now();
  const dt = now - lastLoop;
  lastLoop = now;
  if (now - secondStart >= 1000) {
    actualSpeed = engine ? Math.round((ticksThisSecond * engine.state.tickMs) / (now - secondStart)) : 0;
    ticksThisSecond = 0;
    secondStart = now;
  }
  if (engine && (playing || stepOnce) && !engine.state.ended) {
    const tickMs = engine.state.tickMs;
    if (stepOnce) {
      runTick(true);
      stepOnce = false;
      emitFrame(true);
    } else {
      budget = Math.min(budget + (speed * dt) / tickMs, 400);
      const start = performance.now();
      while (budget >= 1 && performance.now() - start < 40) {
        const r = runTick(true);
        budget -= 1;
        if (pauseAtTick !== undefined && r.tick >= pauseAtTick) {
          playing = false;
          pauseAtTick = undefined;
          budget = 0;
          break;
        }
        if (seekNotable && engine.state.events.some((e) => e.notable)) {
          playing = false;
          seekNotable = false;
          budget = 0;
          break;
        }
        if (r.ended) {
          playing = false;
          finish();
          break;
        }
      }
    }
  }
  emitFrame();
  setTimeout(loop, 50);
}

function finish() {
  emitFrame(true);
  const report = computeAar(allEvents);
  post({ type: "aar", report, notable: allEvents.filter((e) => e.notable).slice(-120), final: true });
}

/** Rewind (or fast-forward) deterministically: restore the nearest snapshot and replay the order log. */
function seek(target: number) {
  if (!engine) return;
  const scn = getScenario(scenarioId)!;
  const cur = engine.state.tick;
  if (target === cur) return;
  playing = false;
  if (target < cur) {
    const log = engine.state.orderLog.slice();
    let best = 0;
    for (const t of snapshots.keys()) if (t <= target && t > best) best = t;
    const snap = snapshots.get(best);
    if (!snap) return;
    engine = Engine.restore(scn, snap.slice());
    engine.state.events = []; // already in allEvents
    const keepSeq = engine.state.eventSeq;
    allEvents = allEvents.filter((e) => e.seq <= keepSeq);
    queued = log.filter((x) => x.tick >= best && x.tick < target).map((x) => ({ tick: x.tick, faction: x.p.faction as "BLUE" | "RED", from: x.p.from, batch: x.p.batch, source: x.p.source }));
    // Pending (unapplied) orders in the restored snapshot are re-fed from the log instead.
    engine.state.pendingOrders = [];
    while (engine.state.tick < target && !engine.state.ended) {
      runTick(false);
      allEvents.push(...engine.drain().events);
    }
    for (const t of [...snapshots.keys()]) if (t > target) snapshots.delete(t);
    queued = [];
    commander = new RulesCommander(humanSeats);
    maxTick = target;
  } else {
    while (engine.state.tick < target && !engine.state.ended) {
      runTick(true);
      allEvents.push(...engine.drain().events);
    }
  }
  post({ type: "rewound", tick: engine.state.tick, events: allEvents });
  for (const v of ["WHITE", "BLUE", "RED"] as View[]) post({ type: "full", view: v, delta: engine.viewSnapshot(v) });
  status();
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case "init": {
        const scn = getScenario(m.scenarioId);
        if (!scn) throw new Error(`unknown scenario ${m.scenarioId}`);
        scenarioId = m.scenarioId;
        mode = m.mode;
        speed = m.speed;
        engine = m.resume?.snapshot ? Engine.restore(scn, m.resume.snapshot) : Engine.create(scn, m.seed);
        if (m.resume?.snapshot) engine.state.events = [];
        snapshots.clear();
        snapshots.set(engine.state.tick, engine.snapshot());
        allEvents = [];
        queued = (m.resume?.orders ?? []).slice().sort((a, b) => a.tick - b.tick);
        pauseAtTick = m.resume?.pauseAtTick;
        playing = m.resume ? !m.resume.paused || pauseAtTick !== undefined : false;
        if (pauseAtTick !== undefined) speed = Math.max(speed, 3600);
        commander = new RulesCommander(humanSeats);
        maxTick = engine.state.tick;
        for (const v of ["WHITE", "BLUE", "RED"] as View[]) post({ type: "full", view: v, delta: engine.viewSnapshot(v) });
        emitFrame(true);
        break;
      }
      case "play": playing = m.playing; budget = 0; status(); break;
      case "speed": speed = Math.max(1, Math.min(3600, m.speed)); status(); break;
      case "step": stepOnce = true; break;
      case "next_event": seekNotable = true; playing = true; break;
      case "order": engine?.submit({ faction: m.faction, from: m.from, batch: m.batch, source: m.source }); break;
      case "inject": engine?.submit({ faction: "BLUE", from: "white.director", source: "INJECT", batch: { orders: [], rationale: m.inject.text, confidence: 1 }, inject: m.inject }); break;
      case "view": if (engine) post({ type: "full", view: m.view, delta: engine.viewSnapshot(m.view) }); break;
      case "seek": seek(m.tick); break;
      case "seats": humanSeats = new Set(m.human); commander.humanSeats = humanSeats; break;
      case "aar": post({ type: "aar", report: computeAar(allEvents), notable: allEvents.filter((e) => e.notable).slice(-120), final: false }); break;
      case "end": playing = false; finish(); break;
    }
  } catch (err) {
    post({ type: "error", message: String((err as Error).message ?? err) });
  }
};

setTimeout(loop, 50);
