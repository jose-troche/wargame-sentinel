import type { CopForAgents, Decision, EventView, OrderBatch, ResumeOrder, View, ViewDelta } from "@sentinel/protocol";

export type WorkerMode = "local" | "host";

export type ToWorker =
  | { type: "init"; scenarioId: string; seed: number; mode: WorkerMode; speed: number; resume?: { snapshot?: Uint8Array; orders: ResumeOrder[]; pauseAtTick?: number; paused: boolean } }
  | { type: "play"; playing: boolean }
  | { type: "speed"; speed: number }
  | { type: "step" }
  | { type: "next_event" }
  | { type: "order"; faction: "BLUE" | "RED"; from: string; batch: OrderBatch; source: string }
  | { type: "inject"; inject: { kind: string; text: string; faction?: "BLUE" | "RED" | "GREEN"; at?: [number, number] } }
  | { type: "view"; view: View }
  | { type: "seek"; tick: number }
  | { type: "seats"; human: string[] }
  | { type: "aar" }
  | { type: "end" };

export type FromWorker =
  | {
      type: "frame";
      tick: number;
      simMs: number;
      views: Record<View, ViewDelta>;
      events: EventView[];
      cops?: { BLUE: CopForAgents; RED: CopForAgents };
      snapshot?: Uint8Array;
      ended: boolean;
    }
  | { type: "full"; view: View; delta: ViewDelta }
  | { type: "status"; playing: boolean; speed: number; tick: number; simMs: number; ended: boolean; actualSpeed: number; maxTick: number }
  | { type: "decision"; decision: Decision }
  | { type: "rewound"; tick: number; events: EventView[] }
  | { type: "aar"; report: unknown; notable: EventView[]; final: boolean }
  | { type: "error"; message: string };
