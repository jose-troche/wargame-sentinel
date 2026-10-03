// Ground-truth state. Lives only inside the World Engine; views and COPs are derived from it.
import type {
  Autonomy, C2LinkView, Domain, EventView, Faction, KillChainStage, MessageEnvelope, OrbitElements, OrderBatch, Roe, Task, TrackQuality,
} from "@sentinel/protocol";
import type { RngState } from "./rng";
import type { WeatherFront } from "./world";

export interface TaskState {
  kind: Task;
  point?: [number, number];
  target?: string;
  /** sim ms window */
  window?: [number, number];
  path?: [number, number][];
  pathIdx?: number;
  planFor?: [number, number];
  issuedMs: number;
  orderId?: string;
}

export interface Entity {
  id: string;
  faction: Faction;
  cls: string;
  domain: Domain;
  callsign: string;
  parent?: string;
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  h3: string;
  task: TaskState;
  health: number;
  readiness: number;
  morale: number;
  /** Land formations: fraction of starting combat power. */
  strength: number;
  supplyDays: number;
  fuel: number;
  /** remaining rounds per effector index */
  ammo: number[];
  emcon: boolean;
  comms: "OK" | "DEGRADED" | "CUT";
  autonomy: Autonomy;
  destroyed: boolean;
  destroyedMs?: number;
  decoy: boolean;
  members: number;
  /** Air: home base position or carrier id. */
  home?: { lat: number; lon: number; carrier?: string };
  sortie: "READY" | "AIRBORNE" | "REARMING" | "NA";
  rearmUntil?: number;
  orbit?: OrbitElements;
  /** Space ISR imagery awaiting downlink: truth ids detected on the pass. */
  pendingImagery?: { id: string; atMs: number; err: number }[];
  posture: "MOVE" | "ATTACK" | "DEFEND" | "ENTRENCHED";
  entrenchH: number;
  missionId?: string;
  engagedMs?: number;
  lastFireMs?: number;
  landmass?: string | null;
  kills: number;
  /** Set when a formation became combat-ineffective; cleared once it reconstitutes. */
  ineffectiveMs?: number;
}

export interface Track {
  id: string;
  owner: Faction;
  truthId: string;
  believedClass?: string;
  believedDomain: Domain;
  affiliation: "HOSTILE" | "UNKNOWN" | "NEUTRAL";
  quality: TrackQuality;
  hits: number;
  lat: number;
  lon: number;
  alt: number;
  errKm: number;
  lastSeenMs: number;
  firstSeenMs: number;
  sources: string[];
  /** True if created by deception rather than a real target. */
  false?: boolean;
  /** Believed destroyed (BDA) — may be wrong. */
  believedDead?: boolean;
}

export interface KillChain {
  id: string;
  faction: Faction;
  shooter: string;
  track: string;
  truthId: string;
  effector: number;
  weapon: string;
  stage: KillChainStage;
  stageStartMs: number;
  stages: { stage: KillChainStage; startMs: number; endMs?: number; ok?: boolean; reason?: string }[];
  status: "ACTIVE" | "SUCCESS" | "BROKEN";
  brokenAt?: KillChainStage;
  believedKill?: boolean;
  actualKill?: boolean;
  c2LatencyMs: number;
  startMs: number;
  endMs?: number;
  readyAtMs: number;
}

export interface InFlightMessage {
  env: MessageEnvelope;
  /** sim ms when held messages are retried */
  retryAtMs?: number;
  /** for order messages: the task to apply on delivery */
  apply?: { unit: string; task: TaskState; roe?: Roe };
}

export interface EwField {
  id: string;
  faction: Faction;
  source: string;
  lat: number;
  lon: number;
  radiusKm: number;
  strength: number;
  kind: "JAM" | "GNSS" | "SATCOM";
  untilMs: number;
}

export interface CyberEffect {
  id: string;
  attacker: Faction;
  victim: Faction;
  node: string;
  kind: "DELAY" | "DENY" | "DECEIVE";
  untilMs: number;
  detected: boolean;
}

export interface Debris {
  id: string;
  altKm: number;
  incDeg: number;
  createdMs: number;
  risk: number;
}

export interface ObjectiveState {
  id: string;
  name: string;
  owner: Faction;
  kind: "CONTROL" | "DESTROY" | "DENY";
  domain: "LAND" | "SEA" | "ANY";
  center: [number, number];
  radiusKm: number;
  weight: number;
  holder: Faction | "CONTESTED" | "NONE";
  heldHours: number;
}

export interface Mission {
  id: string;
  unit: string;
  faction: Faction;
  task: Task;
  startMs: number;
  endMs: number;
  status: "PLANNED" | "ACTIVE" | "DONE" | "ABORTED";
}

export interface SupplyFlow {
  from: string;
  to: string;
  kind: "ROAD" | "SEA" | "AIR";
  amount: number;
  interdicted: boolean;
}

export interface FactionState {
  id: Faction;
  name: string;
  will: number;
  escalation: number;
  roe: Roe;
  losses: Record<Domain, number>;
  kills: Record<Domain, number>;
  lossPoints: number;
  killPoints: number;
  civilianHarm: number;
  seekingTerms: boolean;
  tracks: Track[];
  nextTrackId: number;
  priority?: string;
  flows: SupplyFlow[];
  shortfallHours: number;
  c2Links: C2LinkView[];
  unreachable: string[];
  meanLatencyMs: number;
  /** Per-hour accumulators for will changes. */
  hourLossPoints: number;
  hourKillPoints: number;
  hourHarm: number;
  triggers: string[];
  lastWarnMs?: number;
}

export interface PendingOrder {
  faction: Faction;
  from: string;
  batch: OrderBatch;
  source: string;
  /** White-cell inject delivered through the same deterministic queue. */
  inject?: { kind: string; text: string; faction?: Faction; at?: [number, number]; target?: string };
}

export interface EngageRequest {
  shooter: string;
  trackId: string;
  effector: number;
}

export interface Cursor {
  phase: number;
  offset: number;
}

export interface WorldState {
  version: 1;
  scenarioId: string;
  seed: number;
  tick: number;
  simMs: number;
  tickMs: number;
  rng: RngState;
  rngDraws: number;
  entities: Entity[];
  factions: Record<"BLUE" | "RED" | "GREEN", FactionState>;
  messages: InFlightMessage[];
  chains: KillChain[];
  missions: Mission[];
  ew: EwField[];
  cyber: CyberEffect[];
  debris: Debris[];
  objectives: ObjectiveState[];
  fronts: WeatherFront[];
  eventSeq: number;
  /** Events generated since the last drain. */
  events: EventView[];
  history: [number, number, number, number, number][];
  injectsFired: number;
  pendingOrders: PendingOrder[];
  /** Every applied order with the tick it took effect: replay and branching re-feed this log. */
  orderLog: { tick: number; p: PendingOrder }[];
  engageRequests: EngageRequest[];
  detections: { faction: Faction; truthId: string; sensor: string; errKm: number; strength: number }[];
  nextId: number;
  /** Replacement satellites scheduled from surviving launch sites. */
  launches: { faction: Faction; cls: string; callsign: string; atMs: number; orbit: Entity["orbit"] }[];
  cursor: Cursor;
  outcome?: { winner: Faction | "DRAW" | "CATASTROPHIC"; reason: string };
  ended: boolean;
  /** cumulative metrics used by the AAR */
  metrics: {
    chainsSucceeded: number;
    chainsBroken: Record<KillChainStage, number>;
    sensorToShooterMs: number[];
    escalationPeak: number;
    supplyShortfallHours: number;
    lossesByDomain: Record<Faction, Record<Domain, number>>;
    costLost: Record<Faction, number>;
  };
}
