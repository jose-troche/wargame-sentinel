// Shared vocabulary of the command-post layer: what the staff tell the commander and what the
// commander can decide. Everything here is derived from one faction's own picture (never truth).
import type { Order, Posture } from "@sentinel/protocol";
import type { PlayId } from "@sentinel/agents-rules";

export type Side = "BLUE" | "RED";

/** Severity drives color and ordering. Each level also has its own icon, so color is never the only cue. */
export type Severity = "critical" | "warning" | "info" | "good";
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, good: 2, info: 3 };
export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", warning: "Warning", info: "Update", good: "Good news" };

/** Which staff cell the report comes from. */
export type Category = "intel" | "land" | "sea" | "air" | "space" | "cyber" | "logistics" | "comms" | "strategy";
export const CATEGORY_LABEL: Record<Category, string> = {
  intel: "Intelligence", land: "Land", sea: "Maritime", air: "Air", space: "Space", cyber: "Cyber / EW", logistics: "Logistics", comms: "Communications", strategy: "Strategy",
};

/** Drill-down views: the expert consoles behind each part of the briefing. */
export type Drill = "strategic" | "forces" | "logistics" | "c2" | "intel" | "killchain" | "orbital" | "agents" | "events";

export interface Alert {
  key: string;
  severity: Severity;
  category: Category;
  title: string;
  detail?: string;
  simMs: number;
  firstMs: number;
  count: number;
  where?: [number, number];
  entity?: string;
  drill?: Drill;
  /** Event seq numbers behind this report, for the Explain button. */
  seqs: number[];
}

export type Action =
  | { kind: "play"; play: PlayId; objective?: string; target?: string }
  | { kind: "intent"; posture?: Posture; objective?: string }
  | { kind: "escalate"; steps: number }
  | { kind: "orders"; orders: Order[]; rationale: string }
  | { kind: "multi"; actions: Action[] }
  | { kind: "none" };

export interface DecisionOption {
  label: string;
  /** The consequence in plain language. */
  detail: string;
  action: Action;
}

export interface DecisionCard {
  id: string;
  kind: "intent" | "escalation" | "objective" | "supply" | "ceasefire" | "target" | "comms" | "losses";
  severity: Severity;
  category: Category;
  title: string;
  /** Why the staff bring this to the commander now. */
  situation: string;
  options: DecisionOption[];
  /** Index of the staff's recommended option. */
  recommended: number;
  createdMs: number;
  /** Sim ms after which the staff act on their recommendation (no deadline on Recruit). */
  deadlineMs?: number;
  where?: [number, number];
}

export interface StatusTile {
  id: string;
  label: string;
  value: string;
  sub: string;
  severity: Severity;
  drill: Drill;
  help: string;
}

export interface ObjectiveStatus {
  id: string;
  name: string;
  place: string;
  owner: Side;
  mine: boolean;
  kind: "CONTROL" | "DESTROY" | "DENY";
  state: "held" | "contested" | "lost" | "open";
  stateText: string;
  weight: number;
  heldHours: number;
  center: [number, number];
  radiusKm: number;
}

export interface Brief {
  headline: string;
  tone: Severity;
  score: { own: number; enemy: number; ownName: string; enemyName: string; hoursLeft: number; durationH: number };
  objectives: ObjectiveStatus[];
  tiles: StatusTile[];
  alerts: Alert[];
  outcome?: { result: "victory" | "defeat" | "draw" | "catastrophe"; text: string };
}
