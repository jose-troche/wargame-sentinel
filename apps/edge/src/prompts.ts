// Compact prompt assembly for FactionAgent roles (impl. §5): role card, ROE for the rung, top-25 COP
// tracks as fixed-width rows, own units, current plan memory, sustainment limits and the output schema.
import { ESCALATION_LADDER, ROLE_INFO, TASKS, type CopForAgents, type Role } from "@sentinel/protocol";
import { roleCanCommand } from "@sentinel/catalog";
import { valueOf, km } from "@sentinel/agents-rules";

export const GUARDRAIL =
  "You are an AI commander in WARFARE SENTINEL, an educational wargame with fictional factions and notional data. " +
  "Reason only at the game-abstraction level: bands, H3 cells, unit ids and abstract effects. " +
  "Never produce real-world operational, targeting, tactics or weapons-engineering detail, and never refer to real countries, people or forces. " +
  "Output only one JSON object that matches the schema. No prose outside JSON.";

const ROLE_CARD: Record<Role, string> = {
  nca: "Set end states, approve escalation steps (ESCALATE/DEESCALATE one rung at a time) and set ROE (WEAPONS_HOLD/TIGHT/FREE). You cannot move units.",
  jfc: "Turn objectives into a phased campaign: set a PRIORITY (supported component) and task ISR assets (hale_isr, aewc) with ISR over key areas.",
  lcc: "Command land formations: MOVE, ATTACK (target a hostile LAND track id), DEFEND a point, WITHDRAW; convoys RESUPPLY a unit id.",
  mcc: "Command ships, submarines, USVs and UUVs: PATROL areas, STRIKE hostile SEA tracks, MOVE oilers near the fleet, MOVE the amphibious group to land objectives.",
  acc: "Write the air tasking order: CAP points, STRIKE hostile tracks, ISR orbits, TANK tracks, with window_sim_h [start,end] in simulated hours.",
  scc: "Task satellites (ISR focus), ground stations (JAM enemy SATCOM over an area) and, only at rung 5, launch-site STRIKE on an enemy satellite id.",
  cyber: "Command EW battalions (JAM a point), cyber units (CYBER a hostile track id of an HQ or ground station) and decoys (MOVE as feints).",
  j2: "Write the INTSUM: fuse the COP into a short estimate of enemy disposition and intent with confidence. Issue no orders.",
  j4: "Write the LOGSTAT. Issue no orders.",
  j5: "Propose two or three courses of action and recommend one via a PRIORITY order.",
  j6: "Report network status. Issue no orders.",
};

export function buildPrompt(role: Role, cop: CopForAgents, factionName: string, memory: string) {
  const info = ROLE_INFO[role];
  const rung = ESCALATION_LADDER[Math.max(0, Math.min(6, cop.escalation))];
  const anchor = cop.objectives.find((o) => o.owner === cop.faction)?.center ?? cop.hq ?? [0, 0];
  const tracks = cop.tracks
    .filter((t) => t.affiliation !== "NEUTRAL")
    .sort((a, b) => valueOf(b) - valueOf(a) || km(anchor, [a.lat, a.lon]) - km(anchor, [b.lat, b.lon]))
    .slice(0, 25)
    .map((t) => `${t.id.padEnd(8)}|${(t.believedClass ?? "?").padEnd(16)}|${t.believedDomain.padEnd(5)}|${t.quality.slice(0, 4)}|${t.lat.toFixed(2)},${t.lon.toFixed(2)}|${Math.round((cop.simMs - t.lastSeenMs) / 60000)}m`);
  const units = cop.units
    .filter((u) => roleCanCommand(role === "j2" || role === "j4" || role === "j5" || role === "j6" ? "jfc" : role, u))
    .slice(0, 30)
    .map((u) => `${u.id.padEnd(14)}|${u.cls.padEnd(18)}|${u.lat.toFixed(2)},${u.lon.toFixed(2)}|hp ${u.health.toFixed(2)}|sup ${u.supplyDays.toFixed(1)}d|${u.task}`);
  const objectives = cop.objectives.filter((o) => o.owner === cop.faction).map((o) => `${o.id} ${o.name} (${o.kind}, ${o.domain}) at ${o.center[0]},${o.center[1]} r${o.radiusKm}km holder=${o.holder}`);
  const hour = Math.round(cop.simMs / 3_600_000);
  const user = [
    `ROLE: ${info.title} of ${factionName} (${cop.faction}). ${ROLE_CARD[role]}`,
    `TIME: H+${hour}. ESCALATION rung ${cop.escalation} (${rung.name}): ${rung.allows} Enemy rung ${cop.enemyEscalation}. National will ${cop.will.toFixed(0)}.`,
    `OBJECTIVES:\n${objectives.join("\n") || "none"}`,
    `HOSTILE/UNKNOWN TRACKS (id|class|domain|quality|lat,lon|age):\n${tracks.join("\n") || "none"}`,
    `UNITS YOU COMMAND (id|class|lat,lon|health|supply|task):\n${units.join("\n") || "none"}`,
    `SUSTAINMENT: ${cop.shortfallUnits} units out of supply. NETWORK: mean order latency ${Math.round(cop.meanLatencyMs / 60000)} min, ${cop.unreachable.length} unreachable.`,
    `RECENT TRIGGERS: ${cop.triggers.join("; ") || "none"}`,
    `CURRENT PLAN MEMORY: ${memory || "none yet"}`,
    `OUTPUT: one compact JSON object, no markdown, no extra whitespace. Omit fields you do not need.\n{"orders":[{"type":"OPORD|FRAGO|ATO|STO|ROE|ESCALATE|DEESCALATE|PRIORITY","to":"<unit id>","task":"${TASKS.join("|")}","point":[lat,lon],"target":"<track or unit id>","window_sim_h":[start,end],"roe":"WEAPONS_HOLD|WEAPONS_TIGHT|WEAPONS_FREE"}],"rationale":"<=40 words citing ids","confidence":0.0-1.0}`,
    `Issue at most 6 orders. Use only unit ids from your list. Respect the escalation rung.`,
  ].join("\n\n");
  return [
    { role: "system" as const, content: GUARDRAIL },
    { role: "user" as const, content: user },
  ];
}

export function buildAarPrompt(summary: string, notable: { seq: number; t: string; text: string }[]) {
  const user = [
    "You are the AAR Analyst (White cell). Write an after-action review of this simulated run.",
    `METRICS AND RULE-BASED SUMMARY: ${summary}`,
    `NOTABLE EVENTS (seq|time|text):\n${notable.map((e) => `${e.seq}|${e.t}|${e.text}`).join("\n")}`,
    'Return JSON: {"summary":"<=120 words","turningPoints":[{"title":"...","text":"<=50 words","events":[<seq numbers from the list>]}],"counterfactuals":[{"text":"<=40 words","events":[<seq>]}]}',
    "Every turning point and counterfactual must cite at least one seq number from the list. 3 to 6 turning points.",
  ].join("\n\n");
  return [
    { role: "system" as const, content: GUARDRAIL.replace("AI commander", "AI analyst") },
    { role: "user" as const, content: user },
  ];
}

/** Neurons per million tokens (in, out) from the Workers AI pricing page; config, not physics. */
const RATES: Record<string, [number, number]> = {
  "@cf/qwen/qwen3-30b-a3b-fp8": [4625, 30475],
  "@cf/openai/gpt-oss-120b": [31818, 68182],
  "@cf/ibm-granite/granite-4.0-h-micro": [1542, 10158],
};

export function neuronsFor(model: string, tokensIn: number, tokensOut: number): number {
  const [i, o] = RATES[model] ?? [10000, 30000];
  return (tokensIn / 1e6) * i + (tokensOut / 1e6) * o;
}

export function estimateNeurons(model: string, promptChars: number, maxOut: number): number {
  return neuronsFor(model, promptChars / 3.5, maxOut);
}

export function modelFor(role: Role | "aar", env: Env): string {
  if (role === "nca" || role === "aar") return env.MODEL_STRATEGIC;
  if (role === "j2" || role === "j4" || role === "j6") return env.MODEL_SUMMARY;
  return env.MODEL_OPERATIONAL;
}
