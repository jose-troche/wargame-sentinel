// Command-post state: the briefing, open decisions and the commander's settings. The briefing is
// recomputed once a second (not on every 5 Hz delta), so text panels stay calm and readable.
import { create } from "zustand";
import { useStore } from "../store";
import { controller } from "../session/controller";
import { getUser } from "../lib/identity";
import { Briefer } from "./brief";
import { DecisionDesk } from "./decisions";
import { copFromView } from "./cop";
import { execute } from "./actions";
import { LEVELS, SPEED_PRESETS, type Level } from "./levels";
import { speak } from "./voice";
import { SEVERITY_RANK, type Brief, type DecisionCard, type Drill, type Severity, type Side } from "./types";
import type { Reply } from "./ask";

export type Opponent = "computer" | "llm" | "human";
export type Sheet = "brief" | "status" | "actions" | "ask" | null;

export interface LogEntry {
  simMs: number;
  text: string;
  tone: Severity;
}

interface GameState {
  side: Side | null;
  level: Level;
  opponent: Opponent;
  brief: Brief | null;
  cards: DecisionCard[];
  log: LogEntry[];
  voice: boolean;
  drawer: Drill | null;
  focus: { center: [number, number]; zoom?: number; nonce: number } | null;
  sheet: Sheet;
  pausedFor: string | null;
  reply: (Reply & { q: string }) | null;
  intro: boolean;
  tour: number | null;
  configure(p: { side: Side | null; level: Level; opponent: Opponent }): void;
  set(p: Partial<GameState>): void;
  decide(cardId: string, option: number, auto?: boolean): void;
  focusOn(center: [number, number], zoom?: number): void;
  logEntry(text: string, tone?: Severity): void;
}

const pref = (k: string, d: string) => {
  try { return localStorage.getItem(k) ?? d; } catch { return d; }
};

export const useGame = create<GameState>((set, get) => ({
  side: null, level: "recruit", opponent: "computer", brief: null, cards: [], log: [], voice: pref("ws.voice", "0") === "1",
  drawer: null, focus: null, sheet: null, pausedFor: null, reply: null, intro: false, tour: null,
  configure: (p) => {
    briefer = p.side ? new Briefer(p.side) : null;
    desk.reset();
    set({ ...p, brief: null, cards: [], log: [], drawer: null, focus: null, sheet: null, pausedFor: null, reply: null });
  },
  set: (p) => set(p),
  decide: (cardId, option, auto = false) => {
    const g = get();
    const card = g.cards.find((c) => c.id === cardId);
    if (!card || !g.side) return;
    const opt = card.options[option];
    const res = execute(opt.action, g.side);
    const who = auto ? "Time ran out; your staff acted on their advice" : "You decided";
    get().logEntry(`${who}: ${opt.label}. ${res.ok ? "" : res.text}`.trim(), res.ok ? "info" : "warning");
    if (!res.ok) useStore.getState().notify(res.text, true);
    else if (!auto) useStore.getState().notify(res.text);
    const cards = g.cards.filter((c) => c.id !== cardId);
    const resume = g.pausedFor === cardId && !cards.some((c) => pauses(c, g.level));
    set({ cards, pausedFor: resume ? null : g.pausedFor === cardId ? cards[0]?.id ?? null : g.pausedFor });
    if (resume && !auto && canControlTime()) controller.play(true);
  },
  focusOn: (center, zoom) => set({ focus: { center, zoom, nonce: Date.now() } }),
  logEntry: (text, tone = "info") => set({ log: [...get().log.slice(-60), { simMs: useStore.getState().simMs, text, tone }] }),
}));

let briefer: Briefer | null = null;
const desk = new DecisionDesk();
const spoken = new Set<string>();

export function canControlTime() {
  const st = useStore.getState();
  return st.mode === "local" || st.meta?.owner === getUser().id;
}

function pauses(c: DecisionCard, level: Level) {
  const on = LEVELS[level].pauseOn;
  return on !== null && SEVERITY_RANK[c.severity] <= SEVERITY_RANK[on];
}

/** One step of the command-post loop: refresh the briefing, raise decisions, apply deadlines. */
export function tickGame() {
  const st = useStore.getState();
  const g = useGame.getState();
  if (!g.side || !st.scenario || !briefer) return;
  const side = g.side;
  const brief = briefer.update({ side, scenario: st.scenario, simMs: st.simMs, entities: st.entities, tracks: st.tracks, politics: st.politics, c2: st.c2, logistics: st.logistics, events: st.events });
  let cards = g.cards;
  let pausedFor = g.pausedFor;
  if (st.politics && !brief.outcome) {
    const cop = copFromView(side, st);
    const c2 = st.c2.find((c) => c.faction === side);
    const willHistory = (st.politics.history ?? []).map(([h, b, r]) => [h, side === "BLUE" ? b : r] as [number, number]);
    const fresh = desk.detect({ side, level: g.level, simMs: st.simMs, cop, brief, events: st.events, unreachable: c2?.unreachable.length ?? 0, willHistory }, new Set(cards.map((c) => c.id)));
    if (fresh.length) {
      cards = [...cards, ...fresh].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.createdMs - b.createdMs).slice(0, 4);
      const stop = fresh.find((c) => pauses(c, g.level));
      if (stop && st.playing && canControlTime()) {
        controller.play(false);
        pausedFor = stop.id;
      }
      if (g.voice) speak(`Commander, decision needed: ${fresh[0].title}.`);
    }
  } else if (brief.outcome && cards.length) {
    cards = [];
  }
  useGame.setState({ brief, cards, pausedFor });
  // Deadlines: the staff act on their own recommendation.
  for (const c of cards) if (c.deadlineMs !== undefined && st.simMs >= c.deadlineMs) useGame.getState().decide(c.id, c.recommended, true);
  if (g.voice) {
    const crit = brief.alerts.find((a) => a.severity === "critical" && !spoken.has(`${a.key}:${a.count}`));
    if (crit) {
      spoken.add(`${crit.key}:${crit.count}`);
      speak(crit.title);
    }
  }
}

export function stepSpeed(dir: 1 | -1) {
  const st = useStore.getState();
  const i = SPEED_PRESETS.findIndex((p) => p.speed >= st.speed);
  const next = SPEED_PRESETS[Math.max(0, Math.min(SPEED_PRESETS.length - 1, (i < 0 ? SPEED_PRESETS.length - 1 : i) + dir))];
  controller.setSpeed(next.speed);
}
