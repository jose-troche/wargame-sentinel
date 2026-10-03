// Two-body Keplerian propagation with J2 secular drift of RAAN and argument of perigee.
// Shared by the engine (adjudication) and the Orbital Console (smooth client-side motion).
import type { OrbitElements } from "@sentinel/protocol";
import { acos, atan2, cos, DEG, RAD, sin, TWO_PI, wrapLon, asin } from "./dmath";
import { EARTH_R_KM } from "./geo";

export const MU = 398600.4418; // km^3/s^2
export const J2 = 1.08263e-3;
export const RE = 6378.137;
const OMEGA_E = 7.2921159e-5; // rad/s

export function meanMotion(a: number): number {
  return Math.sqrt(MU / (a * a * a));
}

export function periodMin(a: number): number {
  return TWO_PI / meanMotion(a) / 60;
}

function mod2pi(x: number): number {
  const k = Math.floor(x / TWO_PI);
  return x - k * TWO_PI;
}

export interface SubPoint {
  lat: number;
  lon: number;
  altKm: number;
}

export function propagate(el: OrbitElements, simMs: number): SubPoint {
  const dt = (simMs - el.epochMs) / 1000;
  const n = meanMotion(el.a);
  const p = el.a * (1 - el.e * el.e);
  const k = (1.5 * J2 * RE * RE * n) / (p * p);
  const ci = cos(el.i);
  const raan = el.raan - k * ci * dt;
  const argp = el.argp + k * (2 - 2.5 * sin(el.i) * sin(el.i)) * dt;
  const M = mod2pi(el.m0 + n * dt);
  // Kepler's equation by Newton iteration (fixed count for determinism).
  let E = M;
  for (let it = 0; it < 8; it++) E = E - (E - el.e * sin(E) - M) / (1 - el.e * cos(E));
  const nu = 2 * atan2(Math.sqrt(1 + el.e) * sin(E / 2), Math.sqrt(1 - el.e) * cos(E / 2));
  const r = el.a * (1 - el.e * cos(E));
  const u = argp + nu;
  const cu = cos(u), su = sin(u), cO = cos(raan), sO = sin(raan), si = sin(el.i);
  const x = r * (cO * cu - sO * su * ci);
  const y = r * (sO * cu + cO * su * ci);
  const z = r * (su * si);
  // Earth rotation (GMST at epoch 0 taken as 0 for the game world).
  const theta = mod2pi(OMEGA_E * (simMs / 1000));
  const ct = cos(theta), st = sin(theta);
  const xe = ct * x + st * y;
  const ye = -st * x + ct * y;
  const lat = atan2(z, Math.sqrt(xe * xe + ye * ye)) * RAD;
  const lon = wrapLon(atan2(ye, xe) * RAD);
  return { lat, lon, altKm: r - EARTH_R_KM };
}

/** Ground radius (km) a sensor or comms payload can see from altitude, at a minimum elevation angle. */
export function footprintKm(altKm: number, minElevDeg = 15): number {
  const eps = minElevDeg * DEG;
  const lambda = acos((EARTH_R_KM / (EARTH_R_KM + altKm)) * cos(eps)) - eps;
  return Math.max(0, lambda * EARTH_R_KM);
}

/** Builds elements for a Walker-like constellation slot. */
export function walkerElements(altKm: number, incDeg: number, raanDeg: number, plane: number, planes: number, slot: number, perPlane: number): OrbitElements {
  const geo = altKm > 35000;
  return {
    a: EARTH_R_KM + altKm,
    e: 0.0005,
    i: incDeg * DEG,
    raan: (raanDeg + (geo ? 0 : (360 / planes) * plane)) * DEG,
    argp: 0,
    m0: (((360 / perPlane) * slot + (geo ? (360 / perPlane) * plane : (180 / perPlane) * (plane % 2))) % 360) * DEG,
    epochMs: 0,
  };
}

/** GEO satellites: set m0 so the subpoint sits at the requested longitude at t=0. */
export function geoElements(lonDeg: number): OrbitElements {
  return { a: 42164, e: 0, i: 0.0001, raan: 0, argp: 0, m0: lonDeg * DEG, epochMs: 0 };
}

/** Elevation-free check: is a ground point inside the footprint of a satellite at a subpoint? */
export function inFootprint(sp: SubPoint, lat: number, lon: number, footKm: number): boolean {
  // central angle via haversine using deterministic math
  const p1 = sp.lat * DEG, p2 = lat * DEG;
  const dp = p2 - p1, dl = wrapLon(lon - sp.lon) * DEG;
  const s1 = sin(dp / 2), s2 = sin(dl / 2);
  const a = s1 * s1 + cos(p1) * cos(p2) * s2 * s2;
  return 2 * EARTH_R_KM * asin(Math.sqrt(Math.min(1, a))) <= footKm;
}
