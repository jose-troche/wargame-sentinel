// Sensing (spec §6): P_d = 1 - exp(-k · S·σ / R^4 · E · (1 - J)), passive sensors use R², satellites
// detect only inside their pass footprint and report after a ground-station downlink. J2 fuses detections.
import { OPPOSING, type Domain, type Faction, type TrackQuality } from "@sentinel/protocol";
import { BAND_FACTOR, RANGE_KM, getClass, type SensorSpec } from "@sentinel/catalog";
import type { Ctx } from "./ctx";
import { exp } from "./dmath";
import { distKm, radarHorizonKm } from "./geo";
import { footprintKm } from "./orbit";
import { c2Route } from "./c2";
import { weatherAt } from "./world";
import type { Entity, Track } from "./types";

const K = 0.7;
const SEA_STATE = { calm: 1, moderate: 0.85, rough: 0.6 } as const;

export interface PdFactors {
  sensor: string;
  S: number;
  sigma: number;
  R: number;
  E: number;
  J: number;
  law: "R4" | "R2";
  pd: number;
}

function signatureFor(sensor: SensorSpec, target: Entity): number {
  const c = getClass(target.cls);
  const sig = c.signatures;
  const emitting = c.emitsByDefault && !target.emcon;
  let v: number;
  switch (sensor.type) {
    case "RADAR":
    case "SAR":
      v = BAND_FACTOR[sig.radar];
      break;
    case "EOIR":
      v = Math.max(BAND_FACTOR[sig.ir], BAND_FACTOR[sig.visual]);
      break;
    case "SONAR":
      v = BAND_FACTOR[sig.acoustic];
      break;
    case "PASSIVE_RF":
    case "SIGINT":
      v = emitting ? 1.2 : 0;
      break;
  }
  // Air and drone targets moving fast are easier for IR; swarms add mass but stay small.
  if (target.domain === "LAND" && target.entrenchH > 6 && sensor.type !== "SIGINT") v *= 0.6;
  return v;
}

/** Can this sensor physically see this target (horizon, medium, terrain)? */
function lineOfSight(ctx: Ctx, s: Entity, sensor: SensorSpec, t: Entity, d: number): boolean {
  const submerged = t.alt < -20;
  if (sensor.type === "SONAR") {
    // Sonar needs both in water (sensor at or below surface, or a low MPA with sonobuoys).
    if (t.alt > 50) return false;
    if (s.alt > 1000) return false;
    return !ctx.map.isLand(t.lat, t.lon);
  }
  if (submerged) return false;
  if (sensor.type === "PASSIVE_RF" || sensor.type === "SIGINT") return d <= radarHorizonKm(Math.max(10, s.alt), Math.max(10, t.alt)) * 1.5;
  const horizon = radarHorizonKm(Math.max(10, s.alt), Math.max(5, t.alt));
  if (d > horizon) return false;
  // Terrain masking for surface-to-surface over rough ground.
  if (s.alt < 500 && t.alt < 500 && s.domain === "LAND") {
    const terr = ctx.map.terrainAt(t.lat, t.lon);
    if ((terr === "MOUNTAINS" || terr === "HILLS" || terr === "FOREST" || terr === "URBAN") && d > 8) return false;
  }
  return true;
}

function envFactor(ctx: Ctx, sensor: SensorSpec, s: Entity, t: Entity): number {
  const w = weatherAt(ctx.s.fronts, t.lat, t.lon);
  let e = 1;
  if (sensor.type === "EOIR") {
    e *= 1 - 0.8 * w;
    if (ctx.map.isNight(ctx.s.simMs, t.lon) && s.domain === "SPACE") e *= 0.15;
    else if (ctx.map.isNight(ctx.s.simMs, t.lon)) e *= 0.7;
  }
  if (sensor.type === "RADAR" && t.domain === "SEA") e *= SEA_STATE[ctx.scn.environment.seaState];
  if (sensor.type === "SONAR") e *= SEA_STATE[ctx.scn.environment.seaState] * (1 - 0.3 * w);
  if (sensor.type === "RADAR" && (t.domain === "AIR" || t.domain === "DRONE") && t.alt < 300) e *= 0.6; // clutter
  return Math.max(0.02, e);
}

function jamming(ctx: Ctx, s: Entity, sensor: SensorSpec): number {
  if (sensor.type === "SONAR" || sensor.type === "EOIR") return 0;
  let j = 0;
  for (const f of ctx.s.ew) {
    if (f.faction === s.faction || f.kind !== "JAM") continue;
    if (distKm(s.lat, s.lon, f.lat, f.lon) <= f.radiusKm) j = Math.max(j, f.strength * 0.8);
  }
  return j;
}

export function detectionProbability(ctx: Ctx, s: Entity, sensor: SensorSpec, t: Entity, d: number): PdFactors {
  const S = BAND_FACTOR[sensor.strength];
  const sigma = signatureFor(sensor, t);
  const rangeKm = s.domain === "SPACE" && s.orbit ? footprintKm((s.alt || 500_000) / 1000, 20) : RANGE_KM[sensor.range];
  const passive = sensor.type === "PASSIVE_RF" || sensor.type === "SIGINT";
  const r = Math.max(0.05, d / Math.max(1, rangeKm));
  const E = envFactor(ctx, sensor, s, t);
  const J = jamming(ctx, s, sensor);
  const rp = passive ? r * r : r * r * r * r;
  const pd = 1 - exp((-K * S * sigma * E * (1 - J)) / rp);
  return { sensor: sensor.type, S, sigma, R: Math.round(d * 10) / 10, E: Math.round(E * 100) / 100, J: Math.round(J * 100) / 100, law: passive ? "R2" : "R4", pd: Math.round(pd * 1000) / 1000 };
}

function posError(sensor: SensorSpec, r: number): number {
  switch (sensor.type) {
    case "RADAR": return 0.5 + 3 * r;
    case "SAR": return 0.3;
    case "EOIR": return 0.2 + r;
    case "SONAR": return 2 + 12 * r;
    default: return 8 + 25 * r;
  }
}

const candidates: Entity[] = [];

/** Sense phase work unit: one sensor-bearing entity. */
export function senseEntity(ctx: Ctx, s: Entity) {
  if (s.destroyed || s.decoy) return;
  const c = getClass(s.cls);
  if (!c.sensors.length) return;
  if (s.domain === "AIR" && s.sortie !== "AIRBORNE") return;
  const enemies = OPPOSING[s.faction];
  const orbital = s.domain === "SPACE" && !!s.orbit;
  const sp = orbital ? ctx.satPos.get(s.id) : undefined;
  const sLat = sp ? sp.lat : s.lat, sLon = sp ? sp.lon : s.lon;
  for (const sensor of c.sensors) {
    if (s.emcon && (sensor.type === "RADAR" || sensor.type === "SAR")) continue;
    if (c.tags.includes("MISSILE_WARNING")) continue; // launch detection is handled by engagement events
    const maxKm = orbital ? footprintKm((sp?.altKm ?? 500), 20) : RANGE_KM[sensor.range];
    candidates.length = 0;
    ctx.index.near(sLat, sLon, maxKm, candidates);
    for (const t of candidates) {
      if (t.faction === s.faction || t.destroyed) continue;
      if (!enemies.includes(t.faction) && t.faction !== "GREEN") continue;
      if (t.domain === "AIR" && t.sortie !== "AIRBORNE" && sensor.type === "RADAR" && !orbital) continue;
      const d = distKm(sLat, sLon, t.lat, t.lon);
      if (d > maxKm) continue;
      if (!orbital && !lineOfSight(ctx, s, sensor, t, d)) continue;
      if (orbital && t.alt < -20) continue;
      const f = detectionProbability(ctx, s, sensor, t, d);
      if (f.pd <= 0.001) continue;
      if (!ctx.rng.chance(f.pd)) continue;
      const err = posError(sensor, d / Math.max(1, maxKm));
      if (orbital) {
        s.pendingImagery!.push({ id: t.id, atMs: ctx.s.simMs, err });
      } else {
        ctx.s.detections.push({ faction: s.faction, truthId: t.id, sensor: s.id, errKm: err, strength: f.pd });
      }
    }
  }
  if (orbital && s.pendingImagery!.length) downlink(ctx, s);
}

/** Imagery reaches J2 only when the satellite passes a friendly ground station. */
function downlink(ctx: Ctx, sat: Entity) {
  const sp = ctx.satPos.get(sat.id);
  if (!sp) return;
  const foot = footprintKm(sp.altKm, 5);
  const gs = ctx.s.entities.find(
    (g) => g.faction === sat.faction && !g.destroyed && g.cls === "ground_station" && distKm(sp.lat, sp.lon, g.lat, g.lon) <= foot &&
      !ctx.s.ew.some((f) => f.faction !== sat.faction && f.kind === "SATCOM" && distKm(g.lat, g.lon, f.lat, f.lon) <= f.radiusKm),
  );
  if (!gs) return;
  for (const im of sat.pendingImagery!) {
    ctx.s.detections.push({ faction: sat.faction, truthId: im.id, sensor: sat.id, errKm: im.err + (ctx.s.simMs - im.atMs) / 3_600_000, strength: 0.9 });
  }
  if (sat.pendingImagery!.length >= 3) {
    ctx.emit({ type: "DOWNLINK", vis: ctx.vis(sat.faction), text: `${sat.callsign} downlinked ${sat.pendingImagery!.length} detections via ${gs.callsign}`, entities: [sat.id, gs.id] });
  }
  sat.pendingImagery = [];
}

const QUALITY_HITS: [TrackQuality, number][] = [["TRACKED", 8], ["IDENTIFIED", 5], ["CLASSIFIED", 2], ["DETECTED", 0]];

function believed(t: Entity, q: TrackQuality): { cls?: string; domain: Domain } {
  const shown = t.decoy ? "armored_bde" : t.cls;
  const domain = t.decoy ? "LAND" : t.domain;
  if (q === "DETECTED") return { domain };
  if (q === "CLASSIFIED") return { domain, cls: undefined };
  return { domain, cls: shown };
}

/** J2 fusion: detections become tracks; unseen tracks age, grow uncertain and are dropped. */
export function fuse(ctx: Ctx) {
  const now = ctx.s.simMs;
  const byFaction: Record<string, Map<string, Track>> = {};
  for (const f of ["BLUE", "RED"] as const) {
    const m = new Map<string, Track>();
    for (const t of ctx.s.factions[f].tracks) m.set(t.truthId, t);
    byFaction[f] = m;
  }
  const seenThisTick = new Set<string>();
  for (const d of ctx.s.detections) {
    if (d.faction === "GREEN") continue;
    const fs = ctx.s.factions[d.faction];
    const truth = ctx.byId.get(d.truthId);
    if (!truth || truth.destroyed) continue;
    // Detections travel to J2 over the C2 network; a cut-off sensor contributes nothing to the COP.
    const sensor = ctx.byId.get(d.sensor);
    if (sensor && sensor.domain !== "SPACE" && sensor.comms === "CUT") {
      const r = c2Route(ctx, d.faction, sensor.id);
      if (!r) continue;
    }
    const key = `${d.faction}:${d.truthId}`;
    let tr = byFaction[d.faction].get(d.truthId);
    const errKm = d.errKm;
    const nLat = truth.lat + (ctx.rng.normal() * errKm) / 111.2;
    const nLon = truth.lon + (ctx.rng.normal() * errKm) / 111.2;
    if (!tr) {
      tr = {
        id: `T${d.faction[0]}-${String(fs.nextTrackId++).padStart(4, "0")}`, owner: d.faction, truthId: d.truthId,
        believedDomain: truth.decoy ? "LAND" : truth.domain, affiliation: "UNKNOWN", quality: "DETECTED", hits: 0,
        lat: nLat, lon: nLon, alt: truth.alt, errKm, lastSeenMs: now, firstSeenMs: now, sources: [],
      };
      fs.tracks.push(tr);
      byFaction[d.faction].set(d.truthId, tr);
      if (truth.faction !== "GREEN" && ["CARRIER", "AIR_DEFENSE", "HQ"].some((x) => getClass(truth.cls).tags.includes(x as never))) {
        fs.triggers.push(`new contact ${tr.id}`);
      }
    }
    if (!seenThisTick.has(key)) {
      tr.hits = Math.min(99, tr.hits + 1);
      seenThisTick.add(key);
    }
    const w = errKm < tr.errKm ? 0.7 : 0.4;
    tr.lat = tr.lat + (nLat - tr.lat) * w;
    tr.lon = tr.lon + (nLon - tr.lon) * w;
    tr.alt = truth.alt;
    tr.errKm = Math.max(0.1, Math.min(tr.errKm * 0.7 + errKm * 0.3, errKm));
    tr.lastSeenMs = now;
    if (!tr.sources.includes(d.sensor)) {
      tr.sources.push(d.sensor);
      if (tr.sources.length > 4) tr.sources.shift();
    }
    const prevQ = tr.quality;
    tr.quality = QUALITY_HITS.find(([, h]) => tr!.hits >= h)![0];
    const b = believed(truth, tr.quality);
    tr.believedClass = b.cls;
    tr.believedDomain = b.domain;
    tr.affiliation = tr.quality === "DETECTED" ? "UNKNOWN" : truth.faction === "GREEN" ? (tr.quality === "CLASSIFIED" ? "UNKNOWN" : "NEUTRAL") : "HOSTILE";
    tr.believedDead = false;
    if (prevQ !== "IDENTIFIED" && tr.quality === "IDENTIFIED") {
      ctx.emit({
        type: "TRACK_IDENTIFIED", vis: ctx.vis(d.faction), entities: [d.truthId, d.sensor],
        text: `${d.faction} J2 identified ${tr.id} as ${tr.believedClass ?? tr.believedDomain}`, factors: { sensor: d.sensor, hits: tr.hits },
      });
    }
  }
  ctx.s.detections = [];

  // Decay: tracks not seen grow uncertain, lose quality and are eventually dropped.
  for (const f of ["BLUE", "RED"] as const) {
    const fs = ctx.s.factions[f];
    const keep: Track[] = [];
    for (const tr of fs.tracks) {
      const age = now - tr.lastSeenMs;
      if (age > 0) {
        const truth = ctx.byId.get(tr.truthId);
        const speedKmh = truth ? (truth.domain === "AIR" ? 600 : truth.domain === "SEA" ? 30 : 20) : 20;
        tr.errKm = Math.min(500, tr.errKm + (speedKmh * ctx.s.tickMs) / 3_600_000 / 2);
        if (age > 1_800_000) tr.hits = Math.max(0, tr.hits - 1);
        if (tr.hits < 5 && tr.quality === "TRACKED") tr.quality = "IDENTIFIED";
      }
      const limit = tr.believedDomain === "SEA" || tr.believedDomain === "LAND" ? 6 * 3_600_000 : 2 * 3_600_000;
      if (age > limit || (tr.believedDead && age > 3_600_000)) {
        ctx.emit({ type: "TRACK_LOST", vis: ctx.vis(f), text: `${f} lost track ${tr.id}`, entities: [tr.truthId] });
        continue;
      }
      keep.push(tr);
    }
    fs.tracks = keep;
  }
}

/** Deception: cyber DECEIVE effects and decoys can inject false tracks into a victim's COP. */
export function injectFalseTrack(ctx: Ctx, victim: Faction, lat: number, lon: number, reason: string) {
  const fs = ctx.s.factions[victim];
  const id = `T${victim[0]}-${String(fs.nextTrackId++).padStart(4, "0")}`;
  fs.tracks.push({
    id, owner: victim, truthId: `FALSE-${id}`, believedDomain: "SEA", believedClass: "destroyer", affiliation: "HOSTILE", quality: "CLASSIFIED",
    hits: 3, lat, lon, alt: 0, errKm: 5, lastSeenMs: ctx.s.simMs, firstSeenMs: ctx.s.simMs, sources: ["CYBER"], false: true,
  });
  ctx.emit({ type: "FALSE_TRACK", vis: ["WHITE"], text: `False track ${id} injected into ${victim} COP (${reason})` });
}
