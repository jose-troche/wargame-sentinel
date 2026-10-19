// Plain-language places: "at Meridian Island", "40 km NE of Port Haldane". Reports that say where
// something happened in words are far easier to act on than coordinates.
import type { Scenario } from "@sentinel/protocol";

export interface Place {
  name: string;
  at: [number, number];
  radiusKm: number;
}

/** "Keep the Meridian Strait open" → "Meridian Strait"; "Control Brenn (Molokai)" → "Brenn". */
export function placeOf(objectiveName: string): string {
  return objectiveName
    .replace(/^(keep|deny|seize|control|hold|protect|destroy forces in|sea control of)\s+/i, "")
    .replace(/^the\s+/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+(open|to \w+)$/i, "")
    .trim();
}

export function km(a: [number, number], b: [number, number]): number {
  const dy = (b[0] - a[0]) * 111.2;
  const dx = (b[1] - a[1]) * 111.2 * Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function bearing(from: [number, number], to: [number, number]) {
  const dy = to[0] - from[0];
  const dx = (to[1] - from[1]) * Math.cos((from[0] * Math.PI) / 180);
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return DIRS[Math.round(deg / 45) % 8];
}

/**
 * The place an objective is about. Objective names that reduce to a generic word ("Deny the strait to
 * Aster" → "strait") take the name of the chokepoint, city or other objective at the same spot.
 */
export function placeName(scn: Scenario, o: { name: string; center: [number, number]; radiusKm: number }): string {
  const p = placeOf(o.name);
  if (/[A-Z]/.test(p)) return p;
  const word = p.toLowerCase();
  const candidates = [
    ...scn.map.chokepoints.map((c) => ({ name: c.name, at: c.at })),
    ...scn.factions.flatMap((f) => f.objectives.map((x) => ({ name: placeOf(x.name), at: x.center }))),
    ...scn.map.cities.map((c) => ({ name: c.name, at: c.at })),
  ].filter((c) => /[A-Z]/.test(c.name) && km(c.at, o.center) <= Math.max(o.radiusKm, 30));
  const hit = candidates.find((c) => c.name.toLowerCase().includes(word)) ?? candidates[0];
  return hit?.name ?? p.charAt(0).toUpperCase() + p.slice(1);
}

const cache = new WeakMap<Scenario, Place[]>();
export function places(scn: Scenario): Place[] {
  const hit = cache.get(scn);
  if (hit) return hit;
  const out: Place[] = [];
  const seen = new Set<string>();
  const add = (p: Place) => {
    const k = p.name.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };
  for (const f of scn.factions) for (const o of f.objectives) add({ name: placeName(scn, o), at: o.center, radiusKm: Math.max(15, Math.min(o.radiusKm, 120)) });
  for (const c of scn.map.chokepoints) add({ name: c.name, at: c.at, radiusKm: Math.min(c.radiusKm, 120) });
  for (const c of scn.map.cities) add({ name: c.name, at: c.at, radiusKm: 15 });
  cache.set(scn, out);
  return out;
}

/** Short description of where a point is, relative to the nearest named place. */
export function where(scn: Scenario | null, p: [number, number] | undefined): string {
  if (!scn || !p) return "";
  let best: Place | null = null;
  let bd = Infinity;
  for (const pl of places(scn)) {
    const d = km(pl.at, p) - pl.radiusKm;
    if (d < bd) {
      bd = d;
      best = pl;
    }
  }
  if (!best) return "";
  if (bd <= 0) return `at ${best.name}`;
  // Distances are given from the centre of the place, which is how a reader measures on the map.
  const d = km(best.at, p);
  if (bd < 250) return `${Math.max(5, Math.round(d / 5) * 5)} km ${bearing(best.at, p)} of ${best.name}`;
  return "far from the main theater";
}

/** Finds a named place (or objective) mentioned in free text. */
export function findPlace(scn: Scenario, text: string): Place | null {
  const t = text.toLowerCase();
  let best: Place | null = null;
  let bestLen = 0;
  for (const p of places(scn)) {
    const name = p.name.toLowerCase();
    const words = name.split(/\s+/).filter((w) => w.length > 3 && !["strait", "island", "channel", "passage", "corridor", "ground", "stations"].includes(w));
    const hitFull = t.includes(name);
    const hitWord = words.some((w) => t.includes(w));
    const generic = ["strait", "island", "channel", "passage", "corridor", "salient", "rise"].find((g) => name.endsWith(g) && t.includes(g));
    const score = hitFull ? name.length + 100 : hitWord ? name.length : generic ? 5 : 0;
    if (score > bestLen) {
      bestLen = score;
      best = p;
    }
  }
  return best;
}
