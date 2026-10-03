import type { CopForAgents, ObjectiveView, Order, TrackView, UnitSummary } from "@sentinel/protocol";

export function km(a: [number, number] | { lat: number; lon: number }, b: [number, number] | { lat: number; lon: number }): number {
  const [la1, lo1] = Array.isArray(a) ? a : [a.lat, a.lon];
  const [la2, lo2] = Array.isArray(b) ? b : [b.lat, b.lon];
  const dy = (la2 - la1) * 111.2;
  const dx = (lo2 - lo1) * 111.2 * Math.cos((((la1 + la2) / 2) * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Notional value of a believed class, for target scoring. */
const VALUE: Record<string, number> = {
  csg: 300, arg: 120, lrad_bn: 60, destroyer: 60, ssn: 80, bomber: 60, hq: 50, armored_bde: 90, mech_inf_bde: 70, coastal_ashm: 40, aewc: 40,
  frigate: 40, light_inf_bde: 40, artillery_bn: 35, ground_station: 30, launch_site: 120, ssk: 30, shorad_bn: 25, tanker: 25, oiler: 20, mpa: 20,
  ew_bn: 25, fighter_as: 12, fighter_mr: 10, log_convoy: 8, hale_isr: 15, male_drone: 4, cca: 5,
};
export const valueOf = (t: TrackView) => (t.believedClass ? VALUE[t.believedClass] ?? 10 : t.believedDomain === "SEA" ? 30 : 15);

export const hostile = (cop: CopForAgents) => cop.tracks.filter((t) => t.affiliation === "HOSTILE");

export function ownObjectives(cop: CopForAgents): ObjectiveView[] {
  return cop.objectives.filter((o) => o.owner === cop.faction);
}

/** Objective the faction should focus on: the heaviest one it does not yet hold. */
export function focusObjective(cop: CopForAgents, domain?: "LAND" | "SEA"): ObjectiveView | undefined {
  const objs = ownObjectives(cop).filter((o) => !domain || o.domain === domain || o.domain === "ANY");
  return objs.sort((a, b) => Number(a.holder === cop.faction) - Number(b.holder === cop.faction) || b.weight - a.weight)[0];
}

export function nearestTrack(tracks: TrackView[], p: [number, number], filter: (t: TrackView) => boolean): TrackView | undefined {
  let best: TrackView | undefined;
  let bd = Infinity;
  for (const t of tracks) {
    if (!filter(t)) continue;
    const d = km(p, [t.lat, t.lon]);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** Skip orders that would not change what a unit is already doing. */
export function changes(u: UnitSummary, o: Order): boolean {
  if (u.task !== o.task) return true;
  if (o.target && o.target !== u.taskTarget) return true;
  if (o.point && (!u.taskPoint || km(u.taskPoint, o.point) > 15)) return true;
  return false;
}

/** Offset a point toward another by a distance in km. */
export function toward(from: [number, number], to: [number, number], kmDist: number): [number, number] {
  const d = km(from, to);
  if (d < 1e-6) return from;
  const t = Math.min(1, kmDist / d);
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

export const hoursWindow = (cop: CopForAgents, h: number): [number, number] => {
  const now = cop.simMs / 3_600_000;
  return [Math.round(now * 10) / 10, Math.round((now + h) * 10) / 10];
};
