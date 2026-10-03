import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../index";

describe("starter scenarios", () => {
  it("all validate against the catalogue and guardrails", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(["strait-crisis", "northern-plains", "archipelago", "dark-skies", "sandbox"]);
  });
});
