/// <reference lib="webworker" />
// Monte Carlo batch: one rules-only run per seed, using the user's cores rather than the free tier.
import { Engine, computeMetrics } from "@sentinel/engine";
import { RulesCommander } from "@sentinel/agents-rules";
import { getScenario } from "@sentinel/scenarios";
import type { EventView } from "@sentinel/protocol";

export interface McResult {
  seed: number;
  winner: string;
  hours: number;
  willBlue: number;
  willRed: number;
  costBlue: number;
  costRed: number;
  escalationPeak: number;
  s2sMin: number;
  objectivesBlue: number;
  objectivesRed: number;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<{ scenarioId: string; seed: number; hours: number }>) => {
  const { scenarioId, seed, hours } = ev.data;
  const scn = getScenario(scenarioId)!;
  const eng = Engine.create(scn, seed);
  const cmd = new RulesCommander();
  const events: EventView[] = [];
  const ticks = Math.round((Math.min(hours, scn.durationH) * 3_600_000) / scn.rules.tickMs);
  for (let i = 0; i < ticks; i++) {
    const r = eng.step();
    if (r.cops) {
      for (const f of ["BLUE", "RED"] as const) {
        for (const d of cmd.decide(r.cops[f])) if (d.orders.length) eng.submit({ faction: f, from: d.agent, batch: { orders: d.orders, rationale: d.rationale, confidence: d.confidence }, source: "RULES" });
      }
      events.push(...eng.drain({ c2: false }).events.filter((e) => e.type === "METRICS" || e.type === "SESSION_END" || e.type === "OBJECTIVE"));
    }
    if (r.ended) break;
  }
  events.push(...eng.drain({ c2: false }).events.filter((e) => e.type === "METRICS" || e.type === "SESSION_END"));
  const m = computeMetrics(events);
  const s = eng.state;
  const objHeld = (f: "BLUE" | "RED") => s.objectives.filter((o) => o.owner === f).reduce((a, o) => a + o.heldHours * o.weight, 0);
  const winner = s.outcome?.winner ?? (Math.abs(objHeld("BLUE") + s.factions.BLUE.will - objHeld("RED") - s.factions.RED.will) < 5 ? "DRAW" : objHeld("BLUE") + s.factions.BLUE.will > objHeld("RED") + s.factions.RED.will ? "BLUE" : "RED");
  const res: McResult = {
    seed, winner, hours: Math.round(s.simMs / 3_600_000), willBlue: s.factions.BLUE.will, willRed: s.factions.RED.will,
    costBlue: m.costExchange.blue, costRed: m.costExchange.red, escalationPeak: m.escalationPeak, s2sMin: m.meanSensorToShooterMin,
    objectivesBlue: objHeld("BLUE"), objectivesRed: objHeld("RED"),
  };
  ctx.postMessage(res);
};
