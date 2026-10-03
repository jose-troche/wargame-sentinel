// Starter scenarios bundled with the console and the edge (spec §8).
import type { Scenario, ScenarioSummary } from "@sentinel/protocol";
import { validateScenario } from "@sentinel/catalog";
import strait from "./strait-crisis.json";
import plains from "./northern-plains.json";
import archipelago from "./archipelago.json";
import darkSkies from "./dark-skies.json";
import sandbox from "./sandbox.json";

const RAW: unknown[] = [strait, plains, archipelago, darkSkies, sandbox];

export const SCENARIOS: Scenario[] = RAW.map((r) => {
  const v = validateScenario(r);
  if (!v.ok || !v.scenario) throw new Error(`invalid bundled scenario: ${v.errors.join("; ")}`);
  return v.scenario;
});

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export function summarize(s: Scenario): ScenarioSummary {
  return {
    id: s.id, name: s.name, version: s.version, scale: s.scale, description: s.description, teachingFocus: s.teachingFocus, domains: s.domains,
    entities: s.orbat.reduce((n, u) => n + u.count, 0) + s.space.reduce((n, c) => n + c.planes * c.perPlane, 0),
  };
}

export const SCENARIO_SUMMARIES: ScenarioSummary[] = SCENARIOS.map(summarize);
