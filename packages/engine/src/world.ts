// Static world: land mask (Natural Earth 110m + scenario landmasses), terrain and weather fields.
import { feature } from "topojson-client";
import land110 from "world-atlas/land-110m.json";
import type { Scenario } from "@sentinel/protocol";
import { cos, DEG, exp } from "./dmath";
import { hash2 } from "./rng";
import { distKm } from "./geo";

interface Poly {
  bbox: [number, number, number, number];
  rings: [number, number][][];
  name?: string;
  owner?: string;
}

let worldPolys: Poly[] | null = null;

function ringsBbox(rings: [number, number][][]): [number, number, number, number] {
  let a = 180, b = 90, c = -180, d = -90;
  for (const r of rings) for (const [x, y] of r) {
    if (x < a) a = x;
    if (y < b) b = y;
    if (x > c) c = x;
    if (y > d) d = y;
  }
  return [a, b, c, d];
}

function loadWorld(): Poly[] {
  if (worldPolys) return worldPolys;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo = land110 as any;
  const fc = feature(topo, topo.objects.land) as unknown as { features: { geometry: { type: string; coordinates: unknown } }[] };
  const out: Poly[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates as [number, number][][]] : (g.coordinates as [number, number][][][]);
    for (const rings of polys) out.push({ rings, bbox: ringsBbox(rings) });
  }
  worldPolys = out;
  return out;
}

function inRings(lon: number, lat: number, rings: [number, number][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export type TerrainClass = "WATER" | "PLAINS" | "FOREST" | "HILLS" | "MOUNTAINS" | "URBAN" | "DESERT";

export const TERRAIN_MOVE_COST: Record<TerrainClass, number> = {
  WATER: 99, PLAINS: 1, FOREST: 1.6, HILLS: 1.9, MOUNTAINS: 3.2, URBAN: 2.0, DESERT: 1.2,
};
export const TERRAIN_DEFENSE: Record<TerrainClass, number> = {
  WATER: 1, PLAINS: 1, FOREST: 1.3, HILLS: 1.4, MOUNTAINS: 1.8, URBAN: 1.6, DESERT: 0.9,
};

export interface WeatherFront {
  lat: number;
  lon: number;
  radiusKm: number;
  /** 0..1 */
  intensity: number;
  vLat: number;
  vLon: number;
}

export class WorldMap {
  private scenarioPolys: Poly[];
  private landCache = new Map<number, boolean>();
  private terrainCache = new Map<number, TerrainClass>();

  constructor(public scenario: Scenario, public seed: number) {
    this.scenarioPolys = scenario.map.land.map((l) => ({ name: l.name, owner: l.owner, rings: [l.ring], bbox: ringsBbox([l.ring]) }));
  }

  /** Name of the fictional landmass at a point, if any (used to keep land units on their island). */
  landmassAt(lat: number, lon: number): string | null {
    for (const p of this.scenarioPolys) {
      if (lon < p.bbox[0] || lon > p.bbox[2] || lat < p.bbox[1] || lat > p.bbox[3]) continue;
      if (inRings(lon, lat, p.rings)) return p.name ?? "land";
    }
    return null;
  }

  isLand(lat: number, lon: number): boolean {
    // Cache on a ~1 km grid.
    const key = Math.round(lat * 100) * 100000 + Math.round(lon * 100);
    const hit = this.landCache.get(key);
    if (hit !== undefined) return hit;
    let land = this.landmassAt(lat, lon) !== null;
    if (!land) {
      for (const p of loadWorld()) {
        if (lon < p.bbox[0] || lon > p.bbox[2] || lat < p.bbox[1] || lat > p.bbox[3]) continue;
        if (inRings(lon, lat, p.rings)) {
          land = true;
          break;
        }
      }
    }
    if (this.landCache.size > 200_000) this.landCache.clear();
    this.landCache.set(key, land);
    return land;
  }

  /** Smooth value noise in [0,1) on a 0.2-degree lattice. */
  private noise(lat: number, lon: number, salt: number): number {
    const gx = lon / 0.2;
    const gy = lat / 0.2;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const s = this.seed + salt;
    const a = hash2(x0, y0, s), b = hash2(x0 + 1, y0, s), c = hash2(x0, y0 + 1, s), d = hash2(x0 + 1, y0 + 1, s);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  terrainAt(lat: number, lon: number): TerrainClass {
    const key = Math.round(lat * 20) * 100000 + Math.round(lon * 20);
    const hit = this.terrainCache.get(key);
    if (hit) return hit;
    let t: TerrainClass;
    if (!this.isLand(lat, lon)) t = "WATER";
    else {
      let urban = false;
      for (const c of this.scenario.map.cities) if (distKm(lat, lon, c.at[0], c.at[1]) < 12) urban = true;
      if (urban) t = "URBAN";
      else {
        const elev = this.noise(lat, lon, 11) * 0.7 + this.noise(lat * 2.3, lon * 2.3, 17) * 0.3;
        const veg = this.noise(lat, lon, 29);
        if (elev > 0.78) t = "MOUNTAINS";
        else if (elev > 0.62) t = "HILLS";
        else if (veg > 0.62) t = "FOREST";
        else if (veg < 0.15) t = "DESERT";
        else t = "PLAINS";
      }
    }
    if (this.terrainCache.size > 200_000) this.terrainCache.clear();
    this.terrainCache.set(key, t);
    return t;
  }

  /** Local solar hour at a longitude. */
  solarHour(simMs: number, lon: number): number {
    const h = this.scenario.environment.startHourUtc + simMs / 3_600_000 + lon / 15;
    return ((h % 24) + 24) % 24;
  }

  isNight(simMs: number, lon: number): boolean {
    const h = this.solarHour(simMs, lon);
    return h < 6 || h >= 18.5;
  }
}

/** Weather intensity (0..1) at a point from moving fronts. */
export function weatherAt(fronts: WeatherFront[], lat: number, lon: number): number {
  let w = 0;
  for (const f of fronts) {
    const dy = (lat - f.lat) * 111.2;
    const dx = (lon - f.lon) * 111.2 * cos(lat * DEG);
    const d2 = dx * dx + dy * dy;
    const v = f.intensity * exp(-d2 / (f.radiusKm * f.radiusKm));
    if (v > w) w = v;
  }
  return w;
}
