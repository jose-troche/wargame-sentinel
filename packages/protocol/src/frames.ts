import { decode as mpDecode, encode as mpEncode } from "@msgpack/msgpack";
import type { View } from "./core";
import type { Decision, OrderBatch } from "./orders";
import type { AgentStatus, CopForAgents, EventView, MessageEnvelope, ViewDelta } from "./views";

export const PROTOCOL_VERSION = 1;

export type Profile = "A" | "B";
export type SessionStatus = "WAITING_HOST" | "RUNNING" | "PAUSED" | "ENDED";

export interface SessionMeta {
  id: string;
  scenarioId: string;
  scenarioName: string;
  seed: number;
  profile: Profile;
  status: SessionStatus;
  speed: number;
  simMs: number;
  tick: number;
  owner: string;
  createdAt: number;
  hostConnected: boolean;
  parent?: { session: string; tick: number };
  rulesOnly: boolean;
  lastSeq: number;
}

export interface JoinClaims {
  /** session id */
  sid: string;
  /** user id */
  sub: string;
  name: string;
  view: View;
  /** true for the session owner's WHITE socket that runs the engine (Profile B). */
  host: boolean;
  owner: boolean;
  exp: number;
}

// ---- Frames -------------------------------------------------------------------

export interface HelloFrame { t: "HELLO"; view: View; clientVersion: number; lastSeq?: number }
export interface SnapshotFrame { t: "SNAPSHOT"; meta: SessionMeta; d: ViewDelta; agents: AgentStatus[]; decisions: Decision[] }
/** Host → hub carries all three views; hub → client carries one in `d`. */
export interface DeltaFrame {
  t: "DELTA";
  tick: number;
  simMs: number;
  views?: Partial<Record<View, ViewDelta>>;
  d?: ViewDelta;
  /** Host → hub: the full event batch for the log (WHITE visibility), plus per-faction COPs on the hour. */
  events?: EventView[];
  cop?: Partial<Record<"BLUE" | "RED", CopForAgents>>;
  /** Host → hub: compressed full engine state for hourly snapshots. */
  snapshot?: Uint8Array;
  ended?: boolean;
}
export interface EventFrame { t: "EVENT"; events: EventView[] }
export interface MsgFrame { t: "MSG"; messages: MessageEnvelope[] }
export interface RationaleFrame { t: "RATIONALE"; decision: Decision }
export interface OrderFrame { t: "ORDER"; seat: string; batch: OrderBatch; decision?: Decision }
export interface ControlFrame {
  t: "CONTROL";
  op: "pause" | "resume" | "speed" | "step" | "next_event" | "branch" | "seat" | "inject" | "end" | "rules_only" | "snapshot_request";
  view?: View;
  speed?: number;
  seat?: string;
  take?: boolean;
  tick?: number;
  inject?: { kind: string; text: string; at?: [number, number]; faction?: string };
  value?: boolean;
}
export interface StatusFrame { t: "STATUS"; meta: SessionMeta; agents?: AgentStatus[] }
export interface ErrorFrame { t: "ERROR"; message: string }
export interface PingFrame { t: "PING" }
/** Host → hub at session end: the rule-based AAR plus the notable events the AAR Analyst may cite. */
export interface AarFrame { t: "AAR"; report: unknown; notable: EventView[] }
/** Hub → host: snapshot to resume from after a restart. */
export interface ResumeOrder { tick: number; faction: "BLUE" | "RED"; from: string; batch: OrderBatch; source: string }
export interface ResumeFrame { t: "RESUME"; snapshot?: Uint8Array; orders: ResumeOrder[]; pauseAtTick?: number; speed: number; paused: boolean }

export type Frame =
  | HelloFrame | SnapshotFrame | DeltaFrame | EventFrame | MsgFrame | RationaleFrame
  | OrderFrame | ControlFrame | StatusFrame | ErrorFrame | PingFrame | ResumeFrame | AarFrame;

export function encode(frame: unknown): Uint8Array {
  return mpEncode(frame, { ignoreUndefined: true });
}

export function decode<T = Frame>(data: ArrayBuffer | Uint8Array | string): T {
  if (typeof data === "string") return JSON.parse(data) as T;
  return mpDecode(data instanceof Uint8Array ? data : new Uint8Array(data)) as T;
}
