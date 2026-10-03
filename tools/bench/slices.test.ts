// Profile A slice benchmark (impl. §4, §11): measures the worst-case wall time of one engine slice
// of SLICE_DEFAULTS work units on each starter scenario under 10-minute ticks. Workers cannot time
// their own CPU, so slice sizes are calibrated offline here. Target: worst slice well under 6 ms.
import { expect, it } from "vitest";
import { Engine, SLICE_DEFAULTS } from "@sentinel/engine";
import { RulesCommander } from "@sentinel/agents-rules";
import { SCENARIOS } from "@sentinel/scenarios";

it("reports slice timings per scenario", () => {
  const rows: string[] = [];
  for (const scn of SCENARIOS) {
    const eng = Engine.create(scn, 1, { tickMs: 600_000 });
    const cmd = new RulesCommander();
    const times: number[] = [];
    for (let tick = 0; tick < 6 * 24; tick++) {
      for (;;) {
        const t0 = performance.now();
        const r = eng.stepSlice(SLICE_DEFAULTS.move);
        times.push(performance.now() - t0);
        if (!r) continue;
        if (r.cops) for (const f of ["BLUE", "RED"] as const) for (const d of cmd.decide(r.cops[f])) if (d.orders.length) eng.submit({ faction: f, from: d.agent, batch: d, source: "RULES" });
        eng.drain();
        break;
      }
    }
    times.sort((a, b) => a - b);
    const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))].toFixed(2);
    rows.push(`${scn.id.padEnd(16)} entities=${String(eng.state.entities.length).padEnd(4)} slices=${times.length} p50=${p(0.5)}ms p95=${p(0.95)}ms p99=${p(0.99)}ms max=${p(1)}ms`);
  }
  process.stderr.write(`\nProfile A slice timings (${SLICE_DEFAULTS.move} work units per slice, Node ${process.version}):\n${rows.join("\n")}\n`);
  expect(rows.length).toBe(SCENARIOS.length);
});
