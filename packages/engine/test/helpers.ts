import { RulesCommander } from "@sentinel/agents-rules";
import { getScenario } from "@sentinel/scenarios";
import type { EventView } from "@sentinel/protocol";
import { Engine } from "../src";

/** Runs a scenario headless with rules-only agents for N simulated hours. */
export function runHeadless(scenarioId: string, seed: number, hours: number, opts: { sliced?: number } = {}) {
  const scn = getScenario(scenarioId)!;
  const eng = Engine.create(scn, seed);
  const cmd = new RulesCommander();
  const events: EventView[] = [];
  const ticks = Math.round((hours * 3_600_000) / scn.rules.tickMs);
  for (let i = 0; i < ticks; i++) {
    let r = null;
    if (opts.sliced) while (!(r = eng.stepSlice(opts.sliced)));
    else r = eng.step();
    if (r.cops) {
      for (const f of ["BLUE", "RED"] as const) {
        for (const d of cmd.decide(r.cops[f])) {
          if (d.orders.length) eng.submit({ faction: f, from: d.agent, batch: { orders: d.orders, rationale: d.rationale, confidence: d.confidence }, source: "RULES" });
        }
      }
    }
    events.push(...eng.drain().events);
    if (r.ended) break;
  }
  return { eng, events };
}
