import { describe, expect, it } from "vitest";
import { RulesCommander } from "@sentinel/agents-rules";
import type { OrderBatch } from "@sentinel/protocol";
import { getScenario } from "@sentinel/scenarios";
import { Engine, hashEvents, computeAar, aarLinksValid, dmath } from "../src";
import { runHeadless } from "./helpers";

describe("deterministic math", () => {
  it("matches Math within tolerance", () => {
    for (const x of [-7.1, -1, -0.3, 0, 0.2, 1, 2.5, 3.14159, 10]) {
      expect(Math.abs(dmath.sin(x) - Math.sin(x))).toBeLessThan(1e-12);
      expect(Math.abs(dmath.cos(x) - Math.cos(x))).toBeLessThan(1e-12);
      expect(Math.abs(dmath.atan2(x, 1.3) - Math.atan2(x, 1.3))).toBeLessThan(1e-12);
      expect(Math.abs(dmath.exp(x) - Math.exp(x)) / Math.exp(x)).toBeLessThan(1e-12);
    }
    expect(Math.abs(dmath.log(123.4) - Math.log(123.4))).toBeLessThan(1e-12);
  });
});

describe("engine determinism (NFR-05)", () => {
  it("same seed and order log produce byte-identical event logs", () => {
    const a = runHeadless("strait-crisis", 42, 8);
    const b = runHeadless("strait-crisis", 42, 8);
    expect(a.events.length).toBeGreaterThan(20);
    expect(hashEvents(a.events)).toBe(hashEvents(b.events));
  });

  it("different seeds diverge", () => {
    const a = runHeadless("sandbox", 1, 6);
    const b = runHeadless("sandbox", 2, 6);
    expect(hashEvents(a.events)).not.toBe(hashEvents(b.events));
  });

  it("Profile A slices reproduce the whole-tick run exactly", () => {
    const whole = runHeadless("sandbox", 7, 4);
    const sliced = runHeadless("sandbox", 7, 4, { sliced: 9 });
    expect(hashEvents(sliced.events)).toBe(hashEvents(whole.events));
  });

  it("snapshot + restore continues identically", () => {
    const scn = getScenario("sandbox")!;
    const a = Engine.create(scn, 5);
    for (let i = 0; i < 90; i++) a.step();
    a.drain();
    const b = Engine.restore(scn, a.snapshot());
    const ea = [], eb = [];
    for (let i = 0; i < 90; i++) { a.step(); b.step(); ea.push(...a.drain().events); eb.push(...b.drain().events); }
    expect(hashEvents(eb)).toBe(hashEvents(ea));
  });
});

describe("fog of war (FR-03)", () => {
  it("faction views never contain enemy entities or truth links", () => {
    const { eng } = runHeadless("strait-crisis", 3, 6);
    const blue = eng.viewSnapshot("BLUE");
    expect(blue.entities!.every((e) => e.faction === "BLUE")).toBe(true);
    expect(blue.tracks!.every((t) => t.truth === undefined && t.owner === "BLUE")).toBe(true);
    expect((blue.events ?? []).every((e) => e.vis.includes("BLUE"))).toBe(true);
    expect((blue.messages ?? []).every((m) => m.faction === "BLUE")).toBe(true);
    // The public space catalogue (enemySpace) is intentionally shared; nothing else may name enemy entities.
    const { enemySpace: _sats, ...cop } = eng.cop("BLUE");
    const json = JSON.stringify(cop);
    expect(json).not.toContain('"truth"');
    expect(json).not.toMatch(/"R-[A-Z]+-\d+"/);
    const white = eng.viewSnapshot("WHITE");
    expect(white.entities!.some((e) => e.faction === "RED")).toBe(true);
  });

  it("events in a faction view name only that faction's units and tracks", () => {
    const scn = getScenario("strait-crisis")!;
    const eng = Engine.create(scn, 3);
    const cmd = new RulesCommander();
    const blue: string[] = [];
    for (let i = 0; i < 18 * 60; i++) {
      const r = eng.step();
      if (r.cops) for (const f of ["BLUE", "RED"] as const) for (const d of cmd.decide(r.cops[f])) if (d.orders.length) eng.submit({ faction: f, from: d.agent, batch: d, source: "RULES" });
      for (const e of eng.drain().views.BLUE.events ?? []) blue.push(...(e.entities ?? []));
    }
    expect(blue.length).toBeGreaterThan(0);
    expect(blue.filter((id) => !id.startsWith("B-") && !id.startsWith("TB-"))).toEqual([]);
  });
});

describe("commander's intent", () => {
  const scn = getScenario("strait-crisis")!;
  const submit = (eng: Engine, from: string, source: string, orders: OrderBatch["orders"]) => eng.submit({ faction: "BLUE", from, source, batch: { orders, rationale: "test", confidence: 0.7 } });

  it("an INTENT order sets posture and main effort in the faction's own picture only", () => {
    const eng = Engine.create(scn, 4);
    submit(eng, "blue.nca", "HUMAN", [{ type: "INTENT", to: "blue.jfc", posture: "AGGRESSIVE", objective: "B2" }]);
    eng.step();
    expect(eng.cop("BLUE")).toMatchObject({ posture: "AGGRESSIVE", mainEffort: "B2" });
    expect(eng.viewSnapshot("BLUE").politics!.factions.find((f) => f.faction === "BLUE")).toMatchObject({ posture: "AGGRESSIVE", mainEffort: "B2" });
    expect(eng.viewSnapshot("RED").politics!.factions.find((f) => f.faction === "BLUE")!.posture).toBeUndefined();
  });

  it("only the commander may set intent, and only toward its own objectives", () => {
    const eng = Engine.create(scn, 4);
    submit(eng, "blue.acc", "RULES", [{ type: "INTENT", to: "blue.jfc", posture: "DEFENSIVE" }]);
    submit(eng, "blue.nca", "HUMAN", [{ type: "INTENT", to: "blue.jfc", objective: "R1" }]);
    eng.step();
    expect(eng.cop("BLUE").posture).toBe("BALANCED");
    expect(eng.cop("BLUE").mainEffort).toBeUndefined();
  });

  it("a human commander's direct order holds against AI re-tasking", () => {
    const eng = Engine.create(scn, 4);
    const unit = eng.cop("BLUE").units.find((u) => u.domain === "SEA")!;
    submit(eng, "blue.nca", "HUMAN", [{ type: "FRAGO", to: unit.id, task: "HOLD" }]);
    eng.step();
    expect(eng.cop("BLUE").units.find((u) => u.id === unit.id)!.held).toBe(true);
    submit(eng, "blue.mcc", "RULES", [{ type: "FRAGO", to: unit.id, task: "PATROL", point: [unit.lat, unit.lon + 1] }]);
    eng.step();
    const ev = eng.drain().events.filter((e) => e.type === "ORDER").pop()!;
    expect(ev.factors).toMatchObject({ applied: 0, rejected: 1 });
  });
});

describe("simulation behaviour", () => {
  it("builds tracks, issues orders, fights and produces a linked AAR", () => {
    const { eng, events } = runHeadless("strait-crisis", 11, 24);
    const types = new Set(events.map((e) => e.type));
    expect(eng.state.factions.BLUE.tracks.length).toBeGreaterThan(0);
    expect(types.has("ORDER")).toBe(true);
    expect(types.has("ORDER_DELIVERED")).toBe(true);
    expect(types.has("SORTIE")).toBe(true);
    expect(types.has("ENGAGEMENT") || types.has("KILL_CHAIN_BROKEN")).toBe(true);
    const aar = computeAar(events);
    expect(aar.metrics.simHours).toBeGreaterThanOrEqual(23);
    expect(aarLinksValid(aar, events)).toBe(true);
  });
});
