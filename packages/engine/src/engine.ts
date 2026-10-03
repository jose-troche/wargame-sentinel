// The World Engine: one deterministic tick pipeline that can run whole (browser Web Worker,
// Profile B) or as resumable slices of fixed work units (Durable Object alarms, Profile A).
import { decode, encode, HOUR_MS, type CopForAgents, type EventView, type Scenario, type View, type ViewDelta } from "@sentinel/protocol";
import { Ctx } from "./ctx";
import { createWorld } from "./init";
import { WorldMap } from "./world";
import { propagate } from "./orbit";
import { deliverMessages, refreshC2 } from "./c2";
import { tacticalEntity, applyTask } from "./tactical";
import { fuse, senseEntity } from "./sensing";
import { debrisCollisions, landCombat, progressChain, startChains } from "./engagement";
import { consume, distribute } from "./logistics";
import { applyInject, checkOutcome, environmentTick, runInjects, updateObjectives, updateWill } from "./politics";
import { applyOrderBatch } from "./orders";
import { buildCop, buildDelta, type DrainOptions } from "./views";
import { emitMetrics } from "./aar";
import type { PendingOrder, WorldState } from "./types";

export interface TickResult {
  tick: number;
  simMs: number;
  hour: boolean;
  cops?: { BLUE: CopForAgents; RED: CopForAgents };
  ended: boolean;
}

/** Work units per phase used to size Profile A slices (calibrated offline; see tools/bench). */
export const SLICE_DEFAULTS = { move: 40, sense: 25, engage: 60 } as const;

const PHASES = ["pre", "move", "sense", "fuse", "engage", "combat", "post"] as const;
type Phase = (typeof PHASES)[number];

export class Engine {
  readonly ctx: Ctx;
  lastResult: TickResult | null = null;

  private constructor(public scenario: Scenario, state: WorldState) {
    this.ctx = new Ctx(state, scenario, new WorldMap(scenario, state.seed));
  }

  static create(scenario: Scenario, seed: number): Engine {
    const map = new WorldMap(scenario, seed);
    const state = createWorld(scenario, seed, map);
    const eng = new Engine(scenario, state);
    eng.ctx.emit({ type: "SCENARIO_START", vis: ["WHITE", "BLUE", "RED"], text: `${scenario.name} begins (seed ${seed})`, notable: true });
    refreshC2(eng.ctx);
    return eng;
  }

  static restore(scenario: Scenario, snapshot: Uint8Array | WorldState): Engine {
    const state = snapshot instanceof Uint8Array ? decode<WorldState>(snapshot) : snapshot;
    return new Engine(scenario, state);
  }

  get state(): WorldState {
    return this.ctx.s;
  }

  /** Queue an order batch; it takes effect at the start of the next tick. */
  submit(p: PendingOrder) {
    this.ctx.s.pendingOrders.push(p);
  }

  private ensureSatPos() {
    const ctx = this.ctx;
    if (ctx.satPosMs === ctx.s.simMs) return;
    ctx.satPos.clear();
    for (const e of ctx.s.entities) if (e.orbit && !e.destroyed) ctx.satPos.set(e.id, propagate(e.orbit, ctx.s.simMs));
    ctx.satPosMs = ctx.s.simMs;
  }

  private ensureIndex() {
    const ctx = this.ctx;
    if (ctx.indexStamp === ctx.s.tick) return;
    ctx.index.rebuild(ctx.s.entities);
    ctx.indexStamp = ctx.s.tick;
  }

  private phaseUnits(phase: Phase): number {
    const s = this.ctx.s;
    if (phase === "move" || phase === "sense") return s.entities.length;
    if (phase === "engage") return s.chains.length;
    return 1;
  }

  private runPhase(phase: Phase, from: number, to: number) {
    const ctx = this.ctx;
    const s = ctx.s;
    switch (phase) {
      case "pre": {
        this.ensureSatPos();
        const pending = s.pendingOrders;
        s.pendingOrders = [];
        for (const p of pending) {
          s.orderLog.push({ tick: s.tick, p });
          if (p.inject) applyInject(ctx, p.inject.kind, p.inject.text, p.inject.faction, p.inject.at, p.inject.target);
          else applyOrderBatch(ctx, p);
        }
        runInjects(ctx);
        environmentTick(ctx);
        if (ctx.c2Dirty || s.tick % 5 === 0) refreshC2(ctx);
        deliverMessages(ctx, (u, task) => {
          applyTask(ctx, u, task);
          ctx.emit({ type: "ORDER_DELIVERED", vis: ctx.vis(u.faction), entities: [u.id], text: `${u.callsign} received ${task.kind}` });
        });
        return;
      }
      case "move":
        this.ensureSatPos();
        for (let i = from; i < to; i++) tacticalEntity(ctx, s.entities[i]);
        return;
      case "sense":
        this.ensureSatPos();
        this.ensureIndex();
        for (let i = from; i < to; i++) senseEntity(ctx, s.entities[i]);
        return;
      case "fuse":
        fuse(ctx);
        startChains(ctx);
        return;
      case "engage":
        this.ensureIndex();
        for (let i = from; i < to && i < s.chains.length; i++) progressChain(ctx, s.chains[i]);
        return;
      case "combat":
        this.ensureIndex();
        landCombat(ctx);
        consume(ctx);
        return;
      case "post": {
        s.tick += 1;
        s.simMs += s.tickMs;
        const hour = s.simMs % HOUR_MS === 0;
        let cops: TickResult["cops"];
        if (hour) {
          this.ensureSatPos();
          distribute(ctx);
          updateObjectives(ctx);
          updateWill(ctx);
          debrisCollisions(ctx);
          emitMetrics(ctx);
          cops = { BLUE: buildCop(ctx, "BLUE"), RED: buildCop(ctx, "RED") };
        }
        checkOutcome(ctx);
        // Keep the active chains plus a window of finished ones.
        if (s.chains.length > 400) {
          const active = s.chains.filter((c) => c.status === "ACTIVE");
          const done = s.chains.filter((c) => c.status !== "ACTIVE").slice(-250);
          s.chains = [...done, ...active];
        }
        s.rngDraws = ctx.rng.draws;
        this.lastResult = { tick: s.tick, simMs: s.simMs, hour, cops, ended: s.ended };
        return;
      }
    }
  }

  /** Runs one complete tick. */
  step(): TickResult {
    if (this.ctx.s.ended) return { tick: this.ctx.s.tick, simMs: this.ctx.s.simMs, hour: false, ended: true };
    for (;;) {
      const r = this.stepSlice(Infinity);
      if (r) return r;
    }
  }

  /**
   * Runs at most `budget` work units of the current tick and saves the cursor.
   * Returns the tick result when the tick completes, otherwise null.
   */
  stepSlice(budget: number = SLICE_DEFAULTS.move): TickResult | null {
    const s = this.ctx.s;
    if (s.ended) return { tick: s.tick, simMs: s.simMs, hour: false, ended: true };
    let left = budget;
    while (left > 0) {
      const phase = PHASES[s.cursor.phase];
      const units = this.phaseUnits(phase);
      const from = s.cursor.offset;
      const take = units === 1 ? 1 : Math.min(units - from, left);
      if (units === 1) this.runPhase(phase, 0, 1);
      else if (take > 0) this.runPhase(phase, from, from + take);
      left -= Math.max(1, take);
      if (units === 1 || from + take >= units) {
        s.cursor = { phase: s.cursor.phase + 1, offset: 0 };
        if (s.cursor.phase >= PHASES.length) {
          s.cursor = { phase: 0, offset: 0 };
          return this.lastResult;
        }
      } else {
        s.cursor = { phase: s.cursor.phase, offset: from + take };
      }
    }
    return null;
  }

  /** Is the engine at a tick boundary (safe to snapshot or drain)? */
  atBoundary() {
    return this.ctx.s.cursor.phase === 0 && this.ctx.s.cursor.offset === 0;
  }

  /** Collects per-view deltas and the event batch since the last drain. */
  drain(opt: DrainOptions = {}): { views: Record<View, ViewDelta>; events: EventView[] } {
    const ctx = this.ctx;
    const events = ctx.s.events;
    ctx.s.events = [];
    const o: DrainOptions = { c2: true, logistics: ctx.logisticsDirty, satellites: ctx.s.tick % 60 === 0, ...opt };
    const views = {
      WHITE: buildDelta(ctx, "WHITE", events, o),
      BLUE: buildDelta(ctx, "BLUE", events, o),
      RED: buildDelta(ctx, "RED", events, o),
    };
    ctx.dirty.clear();
    ctx.dirtyChains.clear();
    ctx.newMessages = [];
    ctx.logisticsDirty = false;
    return { views, events };
  }

  /** Full view state (used for SNAPSHOT frames); does not clear dirty sets. */
  viewSnapshot(view: View): ViewDelta {
    return buildDelta(this.ctx, view, [], { full: true });
  }

  cop(f: "BLUE" | "RED"): CopForAgents {
    return buildCop(this.ctx, f, false);
  }

  snapshot(): Uint8Array {
    this.ctx.s.rngDraws = this.ctx.rng.draws;
    return encode(this.ctx.s);
  }
}
