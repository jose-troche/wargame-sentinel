// One store fed by the delta stream (local worker, host worker, or hub WebSocket).
// Entity maps are mutated in place and `version` bumps trigger re-renders, which keeps 5,000-symbol
// updates cheap.
import { create } from "zustand";
import type {
  AgentStatus, AirView, C2View, DebrisView, Decision, EntityView, EventView, EwFieldView, KillChainView, LogisticsView, MessageEnvelope,
  PoliticsView, SatelliteView, Scenario, SessionMeta, TrackView, View, ViewDelta,
} from "@sentinel/protocol";
import { TEACH } from "./lib/explain";

export type Mode = "local" | "host" | "viewer";

export interface WorldSlice {
  tick: number;
  simMs: number;
  entities: Map<string, EntityView>;
  tracks: TrackView[];
  chains: Map<string, KillChainView>;
  c2: C2View[];
  logistics: LogisticsView[];
  politics: PoliticsView | null;
  air: AirView | null;
  satellites: SatelliteView[];
  debris: DebrisView[];
  ew: EwFieldView[];
  events: EventView[];
  messages: Map<string, MessageEnvelope>;
}

export interface StoreState extends WorldSlice {
  mode: Mode | null;
  meta: SessionMeta | null;
  scenario: Scenario | null;
  view: View;
  allowedViews: View[];
  tokens: Partial<Record<View, string>>;
  joinCode?: string;
  decisions: Decision[];
  agents: AgentStatus[];
  allEvents: EventView[];
  selected: string | null;
  playing: boolean;
  speed: number;
  actualSpeed: number;
  maxTick: number;
  ended: boolean;
  teaching: boolean;
  teachSeen: string[];
  teachEvent: EventView | null;
  explain: EventView | null;
  toast: { text: string; bad?: boolean } | null;
  pick: null | { label: string; cb: (p: [number, number]) => void };
  version: number;
  connected: boolean;
  aar: { report: unknown; narrative: unknown } | null;
  humanSeats: string[];
  lastWall: number;

  reset(p: Partial<StoreState>): void;
  applyDelta(d: ViewDelta): void;
  addEvents(e: EventView[]): void;
  addDecision(d: Decision): void;
  set(p: Partial<StoreState>): void;
  select(id: string | null): void;
  notify(text: string, bad?: boolean): void;
}

const emptyWorld = (): WorldSlice => ({
  tick: 0, simMs: 0, entities: new Map(), tracks: [], chains: new Map(), c2: [], logistics: [], politics: null, air: null,
  satellites: [], debris: [], ew: [], events: [], messages: new Map(),
});

const TEACH_TYPES = new Set(Object.keys(TEACH));

export const useStore = create<StoreState>((set, get) => ({
  ...emptyWorld(),
  mode: null, meta: null, scenario: null, view: "WHITE", allowedViews: ["WHITE"], tokens: {}, decisions: [], agents: [], allEvents: [],
  selected: null, playing: false, speed: 600, actualSpeed: 0, maxTick: 0, ended: false, teaching: false, teachSeen: [], teachEvent: null,
  explain: null, toast: null, pick: null, version: 0, connected: false, aar: null, humanSeats: [], lastWall: 0,

  reset: (p) => set({ ...emptyWorld(), decisions: [], agents: [], allEvents: [], selected: null, aar: null, ended: false, version: 0, ...p }),
  set: (p) => set(p),
  select: (id) => set({ selected: id, version: get().version + 1 }),
  notify: (text, bad) => {
    set({ toast: { text, bad } });
    setTimeout(() => {
      if (get().toast?.text === text) set({ toast: null });
    }, 4500);
  },

  applyDelta: (d) => {
    const s = get();
    if (d.view !== s.view) return;
    if (d.full) s.entities.clear();
    for (const e of d.entities ?? []) s.entities.set(e.id, e);
    for (const id of d.removed ?? []) s.entities.delete(id);
    if (d.full) s.chains.clear();
    for (const c of d.chains ?? []) s.chains.set(c.id, c);
    if (s.chains.size > 600) {
      const keep = [...s.chains.values()].filter((c) => c.status === "ACTIVE").concat([...s.chains.values()].filter((c) => c.status !== "ACTIVE").slice(-300));
      s.chains.clear();
      for (const c of keep) s.chains.set(c.id, c);
    }
    for (const m of d.messages ?? []) s.messages.set(m.id, m);
    if (s.messages.size > 800) {
      const arr = [...s.messages.values()].slice(-500);
      s.messages.clear();
      for (const m of arr) s.messages.set(m.id, m);
    }
    const patch: Partial<StoreState> = { tick: d.tick, simMs: d.simMs, version: s.version + 1, lastWall: performance.now() };
    if (d.tracks) patch.tracks = d.tracks;
    if (d.c2) patch.c2 = d.c2;
    if (d.logistics) patch.logistics = d.logistics;
    if (d.politics) patch.politics = d.politics;
    if (d.air) patch.air = d.air;
    if (d.satellites) patch.satellites = d.satellites;
    if (d.debris) patch.debris = d.debris;
    if (d.ew) patch.ew = d.ew;
    set(patch);
    if (d.events?.length) get().addEvents(d.events);
  },

  addEvents: (evs) => {
    const s = get();
    const seen = new Set(s.events.slice(-500).map((e) => `${e.seq}:${e.type}`));
    const fresh = evs.filter((e) => e.vis.includes(s.view) && !seen.has(`${e.seq}:${e.type}`));
    if (!fresh.length) return;
    let events = s.events.concat(fresh);
    if (events.length > 6000) events = events.slice(-5000);
    const patch: Partial<StoreState> = { events };
    if (s.teaching) {
      const t = fresh.find((e) => TEACH_TYPES.has(e.type) && !s.teachSeen.includes(e.type));
      if (t) {
        patch.teachEvent = t;
        patch.teachSeen = [...s.teachSeen, t.type];
      }
    }
    set(patch);
  },

  addDecision: (d) => {
    const s = get();
    if (s.view !== "WHITE" && d.faction !== s.view) return;
    const decisions = s.decisions.concat(d).slice(-400);
    const agents = s.agents.map((a) => (a.id === d.agent ? { ...a, lastDecisionMs: d.simMs, lastSource: d.source, budgetLeft: d.budgetLeft ?? a.budgetLeft } : a));
    set({ decisions, agents });
  },
}));

/** Simulated time interpolated between deltas for smooth animation (orbits, swarms). */
export function liveSimMs(): number {
  const s = useStore.getState();
  if (!s.playing || s.ended) return s.simMs;
  const dt = performance.now() - s.lastWall;
  return s.simMs + Math.min(dt, 1500) * (s.actualSpeed || s.speed);
}
