// View types: what a console or an agent is allowed to see. Faction views never contain ground truth.
import type { Domain, Faction, KillChainStage, Role, Task, TrackQuality, View } from "./core";
import type { Decision } from "./orders";

export interface EntityView {
  id: string;
  faction: Faction;
  cls: string;
  domain: Domain;
  callsign: string;
  parent?: string;
  lat: number;
  lon: number;
  /** metres; negative is depth below the surface. */
  alt: number;
  heading: number;
  health: number;
  readiness: number;
  morale?: number;
  strength?: number;
  supplyDays: number;
  fuel: number;
  task: Task;
  taskPoint?: [number, number];
  taskTarget?: string;
  emcon: boolean;
  comms: "OK" | "DEGRADED" | "CUT";
  destroyed: boolean;
  h3: string;
  /** Swarm members remaining, for drone swarms. */
  count?: number;
  /** Only in WHITE views: true for decoys. */
  decoy?: boolean;
}

export interface TrackView {
  id: string;
  owner: Faction;
  believedClass?: string;
  believedDomain: Domain;
  affiliation: "HOSTILE" | "UNKNOWN" | "NEUTRAL";
  quality: TrackQuality;
  lat: number;
  lon: number;
  alt?: number;
  /** Uncertainty ellipse (km, km, degrees). */
  ellipse: [number, number, number];
  lastSeenMs: number;
  sources: string[];
  /** WHITE only: the true entity behind the track (or "DECOY"). */
  truth?: string;
}

export interface KillChainView {
  id: string;
  faction: Faction;
  shooter: string;
  track: string;
  weapon: string;
  status: "ACTIVE" | "SUCCESS" | "BROKEN";
  stages: { stage: KillChainStage; startMs: number; endMs?: number; ok?: boolean; reason?: string }[];
  brokenAt?: KillChainStage;
  /** What the shooter believes happened (BDA may be wrong). */
  believedKill?: boolean;
  /** WHITE only. */
  actualKill?: boolean;
  c2LatencyMs: number;
}

export interface C2NodeView {
  id: string;
  kind: "HQ" | "UNIT" | "GROUND" | "SAT" | "RELAY";
  label: string;
  lat: number;
  lon: number;
  alive: boolean;
  cyber?: "DELAY" | "DENY" | "DECEIVE";
}
export interface C2LinkView {
  a: string;
  b: string;
  kind: "FIBER" | "HF" | "LOS" | "SATCOM" | "LASER";
  latencyMs: number;
  reliability: number;
  jammed: boolean;
}
export interface C2View {
  faction: Faction;
  nodes: C2NodeView[];
  links: C2LinkView[];
  unreachable: string[];
  meanLatencyMs: number;
}

export interface SupplyFlowView {
  from: string;
  to: string;
  kind: "ROAD" | "SEA" | "AIR";
  amount: number;
  interdicted: boolean;
}
export interface LogisticsView {
  faction: Faction;
  flows: SupplyFlowView[];
  shortfallHours: number;
}

export interface ObjectiveView {
  id: string;
  name: string;
  owner: Faction;
  kind: "CONTROL" | "DESTROY" | "DENY";
  domain: "LAND" | "SEA" | "ANY";
  center: [number, number];
  radiusKm: number;
  holder: Faction | "CONTESTED" | "NONE";
  heldHours: number;
  weight: number;
}

export interface FactionPolitics {
  faction: Faction;
  name: string;
  will: number;
  escalation: number;
  losses: Record<Domain, number>;
  lossPoints: number;
  kills: Record<Domain, number>;
  civilianHarm: number;
  seekingTerms: boolean;
}
export interface PoliticsView {
  factions: FactionPolitics[];
  objectives: ObjectiveView[];
  /** [simHour, BLUE will, RED will, BLUE escalation, RED escalation] */
  history: [number, number, number, number, number][];
  outcome?: { winner: Faction | "DRAW" | "CATASTROPHIC"; reason: string };
}

export interface MissionView {
  id: string;
  unit: string;
  faction: Faction;
  task: Task;
  startMs: number;
  endMs: number;
  status: "PLANNED" | "ACTIVE" | "DONE" | "ABORTED";
}
export interface AirView {
  missions: MissionView[];
  sortieRate: { base: string; faction: Faction; rate: number; readiness: number }[];
}

export interface OrbitElements {
  /** semi-major axis km */
  a: number;
  e: number;
  /** radians */
  i: number;
  raan: number;
  argp: number;
  m0: number;
  /** sim ms the elements refer to */
  epochMs: number;
}
export interface SatelliteView {
  id: string;
  faction: Faction;
  cls: string;
  elements: OrbitElements;
  alive: boolean;
  footprintKm: number;
}
export interface DebrisView {
  id: string;
  altKm: number;
  incDeg: number;
  createdMs: number;
  risk: number;
}
export interface EwFieldView {
  id: string;
  faction: Faction;
  lat: number;
  lon: number;
  radiusKm: number;
  strength: number;
  kind: "JAM" | "GNSS";
}

export interface EventView {
  seq: number;
  simMs: number;
  type: string;
  vis: View[];
  text: string;
  entities?: string[];
  /** Named factors behind an outcome, shown by the Explain button. */
  factors?: Record<string, number | string>;
  causal?: number[];
  rng?: number;
  notable?: boolean;
}

export interface MessageEnvelope {
  id: string;
  sim_time: string;
  sim_ms: number;
  faction: Faction;
  from: string;
  to: string[];
  family: "ORDER" | "REPORT" | "COORDINATION" | "ADJUDICATION" | "CONTROL";
  type: string;
  priority: "ROUTINE" | "PRIORITY" | "IMMEDIATE" | "FLASH";
  classification_tier: "FACTION" | "WHITE";
  path_hint: string[];
  body: Record<string, unknown>;
  rationale?: string;
  correlation_id?: string;
  delivery: {
    state: "IN_TRANSIT" | "DELIVERED" | "HELD" | "DROPPED";
    path: string[];
    deliverAtMs?: number;
    latencyMs?: number;
  };
}

/** One view's worth of state change. Arrays replace (small collections) or upsert (entities). */
export interface ViewDelta {
  view: View;
  tick: number;
  simMs: number;
  entities?: EntityView[];
  removed?: string[];
  tracks?: TrackView[];
  chains?: KillChainView[];
  c2?: C2View[];
  logistics?: LogisticsView[];
  politics?: PoliticsView;
  air?: AirView;
  satellites?: SatelliteView[];
  debris?: DebrisView[];
  ew?: EwFieldView[];
  events?: EventView[];
  messages?: MessageEnvelope[];
  /** Full replacement of entity set (snapshots). */
  full?: boolean;
}

/** What a FactionAgent receives each simulated hour: the faction COP, never ground truth. */
export interface UnitSummary {
  id: string;
  cls: string;
  domain: Domain;
  callsign: string;
  h3: string;
  lat: number;
  lon: number;
  health: number;
  supplyDays: number;
  fuel: number;
  task: Task;
  taskPoint?: [number, number];
  taskTarget?: string;
  comms: EntityView["comms"];
}
export interface CopForAgents {
  faction: Faction;
  simMs: number;
  tick: number;
  escalation: number;
  enemyEscalation: number;
  will: number;
  tracks: TrackView[];
  units: UnitSummary[];
  objectives: ObjectiveView[];
  shortfallUnits: number;
  unreachable: string[];
  meanLatencyMs: number;
  losses: number;
  kills: number;
  triggers: string[];
  /** Public space catalogue: enemy satellites (space situational awareness). */
  enemySpace: { id: string; cls: string }[];
  /** Own HQ position, for rule policies that keep forces near home. */
  hq?: [number, number];
}

export interface AgentStatus {
  id: string;
  faction: Faction;
  role: Role;
  seat: "AI" | string;
  lastDecisionMs?: number;
  lastSource?: Decision["source"];
  budgetLeft?: number;
}
