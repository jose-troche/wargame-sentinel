// Plain-language explanations for teaching mode and the Explain button.
import type { EventView } from "@sentinel/protocol";

export const TEACH: Record<string, { title: string; body: string }> = {
  ESCALATION: {
    title: "Climbing the escalation ladder",
    body: "Each rung unlocks new target sets: rung 2 permits fires at sea and in the air, rung 3 land forces, rung 4 logistics and command nodes, rung 5 space and homeland. Escalating costs national will and alarms the opponent, who often matches the step.",
  },
  KILL_CHAIN_BROKEN: {
    title: "A kill chain broke",
    body: "Engagements succeed only if every link holds: Find, Fix, Track, Target, Engage, Assess. Stale tracks, slow approvals over a degraded network, ROE limits and empty magazines each break the chain at a different link. The Kill Chain Console shows which link failed.",
  },
  JAMMING_ON: {
    title: "Electronic warfare",
    body: "Jammers project a degradation field: radars inside it detect less, datalinks lose reliability and C2 messages take longer. Watch the C2 Network Graph: jammed links turn dashed and order latency rises.",
  },
  DEBRIS: {
    title: "Debris: a shared hazard",
    body: "Destroying a satellite creates a debris field that raises collision risk for every faction in that orbital shell, including the attacker. Open the Orbital Console to see revisit gaps widen.",
  },
  CIVILIAN_HARM: {
    title: "Civilian harm is a cost",
    body: "Strikes near cities or on neutral shipping harm civilians. The model never rewards it: it lowers national will and is reported prominently in the after-action review.",
  },
  OBJECTIVE: {
    title: "Objectives change hands",
    body: "An objective is held when one side's combat power in the area exceeds the other's by half again. Holding objectives raises national will each hour; losing them lowers it.",
  },
  COMBAT_INEFFECTIVE: {
    title: "Combat-ineffective formation",
    body: "Below 50% strength a formation loses cohesion; below 30% it is combat-ineffective and withdraws to reconstitute. Lanchester's square law means concentrated force wins disproportionately.",
  },
  SUPPLY_EXHAUSTED: {
    title: "Out of supply",
    body: "Units consume fuel, munitions and spares by activity. At zero days of supply their speed, sortie rate and kill probability degrade. Interdicting supply lines is therefore a valid strategy.",
  },
  LAUNCH_WARNING: {
    title: "Missile warning from space",
    body: "Infrared satellites see long-range launches and cue the defender, buying minutes for air defenses. Attacking these satellites is highly escalatory.",
  },
  DOWNLINK: {
    title: "Imagery waits for a downlink",
    body: "Imaging satellites detect only during passes, and their detections reach J2 only when the satellite next passes a friendly ground station. Space ISR is powerful but late.",
  },
  CYBER_EFFECT: {
    title: "Cyber effects on C2",
    body: "Cyber actions are timed effects on command nodes: delay adds processing time, deny takes the node off the network, deceive injects false tracks. Each attempt risks exposing the attacker.",
  },
  SEEKS_TERMS: {
    title: "National will collapsed",
    body: "Losses, civilian harm and lost objectives drain national will. A faction whose will reaches zero seeks terms, which ends the scenario.",
  },
  LAND_COMBAT: {
    title: "Lanchester square law",
    body: "Formation combat uses a stochastic Lanchester square law: each side's losses scale with the other's effective combat power, modified by terrain, posture, supply and morale.",
  },
};

export const FACTOR_HELP: Record<string, string> = {
  S: "Sensor strength band (0–1.6)",
  sigma: "Target signature band for this sensor type",
  R: "Range to target (km)",
  E: "Environment factor: weather, night, sea state, clutter",
  J: "Jamming fraction applied to the sensor",
  pd: "Probability of detection per look",
  salvo: "Weapons fired",
  interceptors: "Defensive shots from the target and nearby air defenses",
  intercepted: "Incoming weapons destroyed by defenses",
  leakers: "Weapons that got through the defenses",
  pk: "Kill probability per leaker after soft-kill, GNSS and supply modifiers",
  gnss: "GNSS factor: 0.6 inside a GNSS-denied area",
  hits: "Leakers that hit",
  ownPower: "Own effective combat power (strength × morale × supply × posture × terrain)",
  enemyPower: "Enemy effective combat power in contact",
  lossPerHour: "Strength lost per hour (square law)",
  harm: "Civilian harm points (cost to national will)",
};

export function explainFormula(e: EventView): string | null {
  if (e.type === "ENGAGEMENT") return "Salvo vs layered defense: each defender fires shots with its own Pk; leakers then hit with Pk × (1 − 0.3·soft-kill) × GNSS × supply.";
  if (e.type === "LAND_COMBAT") return "dS/dt = −0.04 · ΣP_enemy / P_own,max, with P = power × strength × morale × supply × posture × terrain.";
  if (e.type === "KILL_CHAIN_BROKEN") return "F2T2EA: Find → Fix (classified track) → Track (fresh track) → Target (ROE + C2 approval latency) → Engage → Assess.";
  if (e.type === "TRACK_IDENTIFIED") return "Track quality rises with consecutive detections: Detected → Classified (2) → Identified (5) → Tracked (8).";
  return null;
}
