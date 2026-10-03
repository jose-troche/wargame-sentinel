import { describe, expect, it } from "vitest";
import { CATALOG, validateCatalog, validateScenario } from "../src";

describe("catalog", () => {
  it("holds 42 band-only classes across five domains", () => {
    expect(CATALOG).toHaveLength(42);
    expect(new Set(CATALOG.map((c) => c.domain)).size).toBe(5);
    expect(validateCatalog()).toEqual([]);
  });

  it("rejects precise performance numbers in scenarios", () => {
    const res = validateScenario({ id: "x", orbat: [{ cls: "destroyer", max_range_km: 370 }] });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes("notional bands"))).toBe(true);
  });

  it("rejects real persons named as commanders", () => {
    const res = validateScenario({ id: "x", name: "Strike on President Smith" });
    expect(res.errors.some((e) => e.includes("real persons"))).toBe(true);
  });
});
