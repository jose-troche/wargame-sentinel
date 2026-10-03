import { describe, expect, it } from "vitest";
import { OrderBatchSchema, ROLES, extractJson } from "@sentinel/protocol";
import { Engine } from "@sentinel/engine";
import { getScenario } from "@sentinel/scenarios";
import { rulePolicy, rolesDue } from "../src";
import fixtures from "./fixtures/model-outputs.json";

describe("rule policies", () => {
  const eng = Engine.create(getScenario("strait-crisis")!, 9);
  for (let i = 0; i < 120; i++) eng.step();
  const cop = eng.cop("BLUE");

  it("every role returns a schema-valid order batch with a rationale", () => {
    for (const role of ROLES) {
      const r = rulePolicy(role, cop);
      expect(OrderBatchSchema.safeParse(r).success, role).toBe(true);
      expect(r.rationale.length).toBeGreaterThan(5);
    }
  });

  it("J5 proposes ranked courses of action", () => {
    const r = rulePolicy("j5", cop);
    expect(r.coas?.length).toBe(3);
    expect(r.coas![0].score).toBeGreaterThanOrEqual(r.coas![2].score);
  });

  it("schedules roles by cadence and skips human-held seats", () => {
    const due = rolesDue({ ...cop, simMs: 0, triggers: [] }, {}, new Set(["blue.acc"]));
    expect(due).toContain("j2");
    expect(due).not.toContain("acc");
  });
});

describe("agent output contract (recorded model outputs)", () => {
  for (const f of fixtures as { name: string; raw: unknown; valid: boolean }[]) {
    it(`${f.name}: ${f.valid ? "parses" : "falls back cleanly"}`, () => {
      const parsed = OrderBatchSchema.safeParse(extractJson(f.raw));
      expect(parsed.success).toBe(f.valid);
    });
  }
});
