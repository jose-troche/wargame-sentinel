// Core vocabulary shared by the engine, the edge and the console.

export const FACTIONS = ["BLUE", "RED", "GREEN"] as const;
export type Faction = (typeof FACTIONS)[number];
export const OPPOSING: Record<Faction, Faction[]> = { BLUE: ["RED"], RED: ["BLUE"], GREEN: [] };

export const VIEWS = ["BLUE", "RED", "WHITE"] as const;
export type View = (typeof VIEWS)[number];

export const DOMAINS = ["LAND", "SEA", "AIR", "DRONE", "SPACE"] as const;
export type Domain = (typeof DOMAINS)[number];

/** Notional bands: every performance value in the game is one of these, never a precise number. */
export const BANDS = ["none", "very_low", "low", "medium", "high", "very_high"] as const;
export type Band = (typeof BANDS)[number];

export const SPEED_BANDS = ["static", "very_slow", "slow", "medium", "fast", "very_fast", "supersonic", "hypersonic", "orbital"] as const;
export type SpeedBand = (typeof SPEED_BANDS)[number];

export const RANGE_BANDS = ["none", "very_short", "short", "medium", "long", "very_long", "global"] as const;
export type RangeBand = (typeof RANGE_BANDS)[number];

export const ECHELONS = ["platform", "section", "unit", "formation"] as const;
export type Echelon = (typeof ECHELONS)[number];

export const ROLES = ["nca", "jfc", "lcc", "mcc", "acc", "scc", "cyber", "j2", "j4", "j5", "j6"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_INFO: Record<Role, { title: string; tier: "STRATEGIC" | "OPERATIONAL" | "STAFF"; cadenceH: number; domain?: Domain[] }> = {
  nca: { title: "National Command Authority", tier: "STRATEGIC", cadenceH: 12 },
  jfc: { title: "Joint Force Commander", tier: "OPERATIONAL", cadenceH: 6 },
  lcc: { title: "Land Component", tier: "OPERATIONAL", cadenceH: 8, domain: ["LAND"] },
  mcc: { title: "Maritime Component", tier: "OPERATIONAL", cadenceH: 8, domain: ["SEA"] },
  acc: { title: "Air Component", tier: "OPERATIONAL", cadenceH: 8, domain: ["AIR", "DRONE"] },
  scc: { title: "Space Component", tier: "OPERATIONAL", cadenceH: 8, domain: ["SPACE"] },
  cyber: { title: "Cyber/EW Component", tier: "OPERATIONAL", cadenceH: 8 },
  j2: { title: "J2 Intelligence", tier: "STAFF", cadenceH: 2 },
  j4: { title: "J4 Logistics", tier: "STAFF", cadenceH: 6 },
  j5: { title: "J5 Plans", tier: "STAFF", cadenceH: 12 },
  j6: { title: "J6 Communications", tier: "STAFF", cadenceH: 6 },
};

export const agentId = (faction: Faction, role: Role) => `${faction.toLowerCase()}.${role}`;
export function parseAgentId(id: string): { faction: Faction; role: Role } | null {
  const [f, r] = id.split(".");
  const faction = f?.toUpperCase() as Faction;
  if (!FACTIONS.includes(faction) || !ROLES.includes(r as Role)) return null;
  return { faction, role: r as Role };
}

export const TRACK_QUALITY = ["DETECTED", "CLASSIFIED", "IDENTIFIED", "TRACKED"] as const;
export type TrackQuality = (typeof TRACK_QUALITY)[number];

export const ROE_LEVELS = ["WEAPONS_HOLD", "WEAPONS_TIGHT", "WEAPONS_FREE"] as const;
export type Roe = (typeof ROE_LEVELS)[number];

export const AUTONOMY = ["STRICT", "MISSION", "FULL"] as const;
export type Autonomy = (typeof AUTONOMY)[number];

export const ESCALATION_LADDER = [
  { rung: 0, name: "Posturing", allows: "Movement, ISR, exercises. No kinetic fire." },
  { rung: 1, name: "Gray zone", allows: "Jamming, cyber, harassment; self-defense only." },
  { rung: 2, name: "Limited conventional", allows: "Fires against forces at sea and in the air inside the theater." },
  { rung: 3, name: "Regional conventional", allows: "Strikes on land forces and bases in the theater." },
  { rung: 4, name: "Expanded conventional", allows: "Strikes on logistics and C2 nodes anywhere in the theater." },
  { rung: 5, name: "Space and homeland", allows: "Counter-space attacks and strikes on homeland infrastructure." },
  { rung: 6, name: "Strategic", allows: "Catastrophic outcome: the scenario ends (not modeled)." },
] as const;

export const KILL_CHAIN_STAGES = ["FIND", "FIX", "TRACK", "TARGET", "ENGAGE", "ASSESS"] as const;
export type KillChainStage = (typeof KILL_CHAIN_STAGES)[number];

export const TASKS = [
  "HOLD", "MOVE", "PATROL", "CAP", "STRIKE", "DEFEND", "ATTACK", "WITHDRAW", "ISR",
  "JAM", "CYBER", "ESCORT", "RESUPPLY", "TANK", "EMCON", "RTB",
] as const;
export type Task = (typeof TASKS)[number];

/** Tactical tick lengths (sim ms). */
export const TICK = { tactical: 60_000, operational: 600_000, strategic: 3_600_000 } as const;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Formats sim time as D+d T hh:mm Z, matching the message envelope in the spec. */
export function fmtSimTime(simMs: number): string {
  const d = Math.floor(simMs / DAY_MS);
  const rem = simMs - d * DAY_MS;
  const h = Math.floor(rem / HOUR_MS);
  const m = Math.floor((rem - h * HOUR_MS) / 60_000);
  return `D+${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}Z`;
}

export const FACTION_COLORS: Record<Faction | "WHITE" | "UNKNOWN", string> = {
  // Okabe–Ito colorblind-safe palette; every color is paired with a symbol frame shape.
  BLUE: "#0072B2",
  RED: "#D55E00",
  GREEN: "#009E73",
  WHITE: "#9a9a9a",
  UNKNOWN: "#E69F00",
};
