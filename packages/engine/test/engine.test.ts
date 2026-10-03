import { describe, expect, it } from "vitest";
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
