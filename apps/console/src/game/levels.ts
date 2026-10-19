// Difficulty levels and game-speed presets. Speeds are named by how long one simulated hour takes,
// which is what a player needs to judge how much time they have to think.
import type { Posture } from "@sentinel/protocol";

export type Level = "recruit" | "officer" | "commander";

export interface LevelInfo {
  id: Level;
  title: string;
  blurb: string;
  speed: number;
  /** Pause automatically when a decision of this severity or worse arrives (null: never). */
  pauseOn: "warning" | "critical" | null;
  /** Simulated hours before the staff act on their own recommendation (null: wait for you). */
  deadlineH: number | null;
  /** The computer opponent's posture. */
  opponent: Posture;
  hints: boolean;
}

export const LEVELS: Record<Level, LevelInfo> = {
  recruit: {
    id: "recruit", title: "Recruit", speed: 180, pauseOn: "warning", deadlineH: null, opponent: "DEFENSIVE", hints: true,
    blurb: "Slow pace. The game pauses whenever your staff need a decision, and they explain every option. A cautious opponent.",
  },
  officer: {
    id: "officer", title: "Officer", speed: 600, pauseOn: "critical", deadlineH: 3, opponent: "BALANCED", hints: true,
    blurb: "Normal pace. Pauses only for critical decisions; otherwise your staff act on their advice after 3 simulated hours.",
  },
  commander: {
    id: "commander", title: "Commander", speed: 600, pauseOn: null, deadlineH: 1.5, opponent: "AGGRESSIVE", hints: false,
    blurb: "Real-time pressure. No automatic pauses, short decision windows and an aggressive opponent.",
  },
};

export const SPEED_PRESETS = [
  { id: "slow", label: "Slow", speed: 180, hint: "1 hour ≈ 20 s" },
  { id: "normal", label: "Normal", speed: 600, hint: "1 hour ≈ 6 s" },
  { id: "fast", label: "Fast", speed: 1800, hint: "1 hour ≈ 2 s" },
  { id: "max", label: "Max", speed: 3600, hint: "1 hour ≈ 1 s" },
] as const;

export function speedPreset(speed: number) {
  let best: (typeof SPEED_PRESETS)[number] = SPEED_PRESETS[0];
  for (const p of SPEED_PRESETS) if (Math.abs(p.speed - speed) < Math.abs(best.speed - speed)) best = p;
  return best;
}

export const POSTURE_INFO: Record<Posture, { title: string; text: string }> = {
  AGGRESSIVE: { title: "Aggressive", text: "Attack at modest odds, push ships forward, shoot at classified contacts. Faster gains, heavier losses." },
  BALANCED: { title: "Balanced", text: "Attack with a clear advantage, keep the carrier back, strike identified targets. The default." },
  DEFENSIVE: { title: "Defensive", text: "Hold ground, no ground attacks, strike only threats near your objectives. Preserves forces and will." },
};
