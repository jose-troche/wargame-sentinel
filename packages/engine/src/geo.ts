import { asin, atan2, clamp, cos, DEG, RAD, sin, wrapLon } from "./dmath";

export const EARTH_R_KM = 6371;

export function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dp = (lat2 - lat1) * DEG;
  const dl = wrapLon(lon2 - lon1) * DEG;
  const sdp = sin(dp / 2);
  const sdl = sin(dl / 2);
  const a = sdp * sdp + cos(p1) * cos(p2) * sdl * sdl;
  return 2 * EARTH_R_KM * asin(Math.sqrt(clamp(a, 0, 1)));
}

/** Fast flat-earth approximation for pre-filtering only (never for outcomes). */
export function approxDistKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dy = (lat2 - lat1) * 111.2;
  const dx = wrapLon(lon2 - lon1) * 111.2 * cos(((lat1 + lat2) / 2) * DEG);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Initial bearing in degrees [0, 360). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dl = wrapLon(lon2 - lon1) * DEG;
  const y = sin(dl) * cos(p2);
  const x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl);
  const b = atan2(y, x) * RAD;
  return (b + 360) % 360;
}

export function destination(lat: number, lon: number, brgDeg: number, dKm: number): [number, number] {
  const d = dKm / EARTH_R_KM;
  const p1 = lat * DEG;
  const l1 = lon * DEG;
  const b = brgDeg * DEG;
  const sp2 = sin(p1) * cos(d) + cos(p1) * sin(d) * cos(b);
  const p2 = asin(sp2);
  const l2 = l1 + atan2(sin(b) * sin(d) * cos(p1), cos(d) - sin(p1) * sp2);
  return [p2 * RAD, wrapLon(l2 * RAD)];
}

/** Moves along the great circle toward a target; returns new position, heading and whether it arrived. */
export function stepToward(lat: number, lon: number, tLat: number, tLon: number, stepKm: number): { lat: number; lon: number; heading: number; arrived: boolean } {
  const d = distKm(lat, lon, tLat, tLon);
  const heading = d > 0.001 ? bearing(lat, lon, tLat, tLon) : 0;
  if (d <= stepKm) return { lat: tLat, lon: tLon, heading, arrived: true };
  const [nLat, nLon] = destination(lat, lon, heading, stepKm);
  return { lat: nLat, lon: nLon, heading, arrived: false };
}

/** Radar horizon (km) between two altitudes in metres (4/3 earth model). */
export function radarHorizonKm(h1m: number, h2m: number): number {
  return 4.12 * (Math.sqrt(Math.max(0, h1m)) + Math.sqrt(Math.max(0, h2m)));
}

/** Distance from point P to segment AB, approximately, in km (for interdiction checks). */
export function distToSegmentKm(pLat: number, pLon: number, aLat: number, aLon: number, bLat: number, bLon: number): number {
  const kx = 111.2 * cos(((aLat + bLat) / 2) * DEG);
  const ax = aLon * kx, ay = aLat * 111.2, bx = bLon * kx, by = bLat * 111.2, px = pLon * kx, py = pLat * 111.2;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}
