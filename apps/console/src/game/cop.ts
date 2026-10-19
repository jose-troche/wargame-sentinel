// The commander's own picture in the shape the rule policies and plays expect. Built only from the
// faction view held by the console, so it never contains more than the player is allowed to see.
import type { CopForAgents, EntityView, PoliticsView, TrackView } from "@sentinel/protocol";
import type { Side } from "./types";

export interface ViewState {
  simMs: number;
  tick: number;
  entities: Map<string, EntityView>;
  tracks: TrackView[];
  politics: PoliticsView | null;
}

export function copFromView(side: Side, s: ViewState): CopForAgents {
  const own = s.politics?.factions.find((f) => f.faction === side);
  const enemy = s.politics?.factions.find((f) => f.faction !== side);
  const units = [...s.entities.values()]
    .filter((e) => e.faction === side && !e.destroyed)
    .map((e) => ({
      id: e.id, cls: e.cls, domain: e.domain, callsign: e.callsign, h3: e.h3, lat: e.lat, lon: e.lon,
      health: e.domain === "LAND" ? e.strength ?? e.health : e.health, supplyDays: e.supplyDays, fuel: e.fuel, task: e.task,
      taskPoint: e.taskPoint, taskTarget: e.taskTarget, comms: e.comms, ...(e.heldUntilMs !== undefined && e.heldUntilMs > s.simMs ? { held: true } : {}),
    }));
  const hq = units.find((u) => u.cls === "hq");
  return {
    faction: side, simMs: s.simMs, tick: s.tick, escalation: own?.escalation ?? 0, enemyEscalation: enemy?.escalation ?? 0, will: own?.will ?? 50,
    tracks: s.tracks.filter((t) => t.owner === side), units, objectives: s.politics?.objectives ?? [],
    shortfallUnits: units.filter((u) => u.supplyDays <= 0.5).length, unreachable: [], meanLatencyMs: 0, losses: own?.lossPoints ?? 0, kills: 0,
    triggers: [], enemySpace: [], hq: hq ? [hq.lat, hq.lon] : undefined, posture: own?.posture ?? "BALANCED", mainEffort: own?.mainEffort,
  };
}
