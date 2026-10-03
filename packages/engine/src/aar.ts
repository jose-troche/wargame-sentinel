// After-action review: metrics derived from the event log, and a rule-based narrative whose every
// turning point links to supporting events (spec §8). The LLM AAR Analyst uses the same structure.
import { DOMAINS, KILL_CHAIN_STAGES, fmtSimTime, type EventView } from "@sentinel/protocol";
import type { Ctx } from "./ctx";

export function emitMetrics(ctx: Ctx) {
  const m = ctx.s.metrics;
  const f: Record<string, number | string> = {};
  for (const fac of ["BLUE", "RED"] as const) {
    for (const d of DOMAINS) f[`loss_${fac}_${d}`] = m.lossesByDomain[fac][d];
    f[`cost_${fac}`] = m.costLost[fac];
    f[`will_${fac}`] = ctx.s.factions[fac].will;
    f[`harm_${fac}`] = ctx.s.factions[fac].civilianHarm;
    f[`esc_${fac}`] = ctx.s.factions[fac].escalation;
  }
  for (const st of KILL_CHAIN_STAGES) f[`broken_${st}`] = m.chainsBroken[st];
  f.chains_ok = m.chainsSucceeded;
  const sts = m.sensorToShooterMs;
  f.s2s_mean_min = sts.length ? Math.round(sts.reduce((a, b) => a + b, 0) / sts.length / 6000) / 10 : 0;
  f.shortfall_h = m.supplyShortfallHours;
  f.esc_peak = m.escalationPeak;
  f.obj = ctx.s.objectives.map((o) => `${o.id}:${o.holder}:${o.heldHours}`).join(",");
  ctx.emit({ type: "METRICS", vis: ["WHITE"], text: `Hourly metrics at ${fmtSimTime(ctx.s.simMs)}`, factors: f });
}

export interface AarMetrics {
  simHours: number;
  outcome?: string;
  lossExchange: Record<string, { blue: number; red: number; ratio: number | null }>;
  costExchange: { blue: number; red: number; ratio: number | null };
  meanSensorToShooterMin: number;
  chainsSucceeded: number;
  chainsBrokenByStage: Record<string, number>;
  brokenPct: Record<string, number>;
  supplyShortfallHours: number;
  escalationPeak: number;
  civilianHarm: { blue: number; red: number };
  will: { blue: number; red: number };
  objectiveTimeline: { simMs: number; text: string; seq: number }[];
}

export interface TurningPoint {
  title: string;
  text: string;
  simMs: number;
  events: number[];
}

export interface AarReport {
  metrics: AarMetrics;
  narrative: { summary: string; turningPoints: TurningPoint[]; counterfactuals: { text: string; events: number[] }[]; source: "RULES" | "LLM" };
}

export function computeMetrics(events: EventView[]): AarMetrics {
  const last = [...events].reverse().find((e) => e.type === "METRICS");
  const f = (last?.factors ?? {}) as Record<string, number>;
  const lossExchange: AarMetrics["lossExchange"] = {};
  for (const d of DOMAINS) {
    const blue = f[`loss_BLUE_${d}`] ?? 0, red = f[`loss_RED_${d}`] ?? 0;
    lossExchange[d] = { blue, red, ratio: blue ? Math.round((red / blue) * 100) / 100 : null };
  }
  const cb = f.cost_BLUE ?? 0, cr = f.cost_RED ?? 0;
  const brokenByStage: Record<string, number> = {};
  let brokenTotal = 0;
  for (const st of KILL_CHAIN_STAGES) {
    brokenByStage[st] = f[`broken_${st}`] ?? 0;
    brokenTotal += brokenByStage[st];
  }
  const total = brokenTotal + (f.chains_ok ?? 0);
  const brokenPct: Record<string, number> = {};
  for (const st of KILL_CHAIN_STAGES) brokenPct[st] = total ? Math.round((brokenByStage[st] / total) * 1000) / 10 : 0;
  const end = events.find((e) => e.type === "SESSION_END");
  return {
    simHours: Math.round((events[events.length - 1]?.simMs ?? 0) / 3_600_000),
    outcome: end?.text,
    lossExchange,
    costExchange: { blue: cb, red: cr, ratio: cb ? Math.round((cr / cb) * 100) / 100 : null },
    meanSensorToShooterMin: f.s2s_mean_min ?? 0,
    chainsSucceeded: f.chains_ok ?? 0,
    chainsBrokenByStage: brokenByStage,
    brokenPct,
    supplyShortfallHours: f.shortfall_h ?? 0,
    escalationPeak: f.esc_peak ?? 0,
    civilianHarm: { blue: f.harm_BLUE ?? 0, red: f.harm_RED ?? 0 },
    will: { blue: f.will_BLUE ?? 0, red: f.will_RED ?? 0 },
    objectiveTimeline: events.filter((e) => e.type === "OBJECTIVE").map((e) => ({ simMs: e.simMs, text: e.text, seq: e.seq })),
  };
}

const WEIGHT: Record<string, number> = {
  ESCALATION: 50, SEEKS_TERMS: 80, OBJECTIVE: 30, CIVILIAN_HARM: 25, DEBRIS: 35, INJECT: 15, WILL: 10, COMBAT_INEFFECTIVE: 12, COHESION_LOST: 8, CYBER_DETECTED: 10, SESSION_END: 5,
};

/** Rule-based AAR Analyst: picks the highest-impact events and links each claim to them. */
export function ruleNarrative(events: EventView[], metrics: AarMetrics): AarReport["narrative"] {
  const scored = events
    .filter((e) => e.type !== "METRICS")
    .map((e) => {
      let w = WEIGHT[e.type] ?? 0;
      if (e.type === "ENTITY_DESTROYED") w = Number(e.factors?.cost ?? 0) / 3;
      return { e, w };
    })
    .filter((x) => x.w >= 8)
    .sort((a, b) => b.w - a.w || a.e.seq - b.e.seq)
    .slice(0, 8)
    .sort((a, b) => a.e.seq - b.e.seq);
  const turningPoints: TurningPoint[] = scored.map(({ e }) => ({
    title: `${fmtSimTime(e.simMs)} · ${e.type.replace(/_/g, " ").toLowerCase()}`,
    text: e.text,
    simMs: e.simMs,
    events: [e.seq, ...(e.causal ?? [])],
  }));
  const counterfactuals: AarReport["narrative"]["counterfactuals"] = [];
  const worst = Object.entries(metrics.chainsBrokenByStage).sort((a, b) => b[1] - a[1])[0];
  const brokenEvents = events.filter((e) => e.type === "KILL_CHAIN_BROKEN" && e.factors?.stage === worst?.[0]).slice(0, 3).map((e) => e.seq);
  if (worst && worst[1] > 0 && brokenEvents.length) {
    const advice: Record<string, string> = {
      FIX: "More persistent ISR (HALE drones, AEW) would have classified tracks before they faded.",
      TRACK: "Tracks went stale before weapons were released; shorter sensor-to-shooter paths or organic sensors on shooters would help.",
      TARGET: "Approval latency or ROE blocked fires; mission-type autonomy or a closer C2 node shortens the loop.",
      ENGAGE: "Magazines ran dry; sustainment of munitions limited reach.",
      FIND: "Shooters lost their cue entirely.", ASSESS: "Assessment broke down.",
    };
    counterfactuals.push({ text: `Most kill chains broke at ${worst[0]} (${worst[1]}). ${advice[worst[0]] ?? ""}`, events: brokenEvents });
  }
  const shortfall = events.filter((e) => e.type === "SUPPLY_EXHAUSTED").slice(0, 3).map((e) => e.seq);
  if (metrics.supplyShortfallHours > 0 && shortfall.length) {
    counterfactuals.push({ text: `Units spent ${metrics.supplyShortfallHours} unit-hours without supply; protecting lines of communication would have preserved combat power.`, events: shortfall });
  }
  const harm = events.filter((e) => e.type === "CIVILIAN_HARM").map((e) => e.seq);
  if (harm.length) counterfactuals.push({ text: `Civilian harm occurred ${harm.length} time(s), costing national will; tighter ROE near cities would avoid it.`, events: harm.slice(0, 5) });
  const ce = metrics.costExchange;
  const summary = [
    metrics.outcome ?? `Run reviewed at H+${metrics.simHours}.`,
    `Cost exchange (Red lost / Blue lost): ${ce.ratio ?? "n/a"} (${ce.red} vs ${ce.blue} points).`,
    `Mean sensor-to-shooter time ${metrics.meanSensorToShooterMin} min across ${metrics.chainsSucceeded} completed kill chains.`,
    `Escalation peaked at rung ${metrics.escalationPeak}.`,
  ].join(" ");
  return { summary, turningPoints, counterfactuals, source: "RULES" };
}

export function computeAar(events: EventView[]): AarReport {
  const metrics = computeMetrics(events);
  return { metrics, narrative: ruleNarrative(events, metrics) };
}

/** Acceptance check: every turning point cites at least one event that exists in the log. */
export function aarLinksValid(report: AarReport, events: EventView[]): boolean {
  const seqs = new Set(events.map((e) => e.seq));
  return report.narrative.turningPoints.every((t) => t.events.length > 0 && t.events.some((s) => seqs.has(s)));
}
