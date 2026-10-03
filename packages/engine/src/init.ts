import { latLngToCell } from "h3-js";
import type { Domain, Faction, Scenario } from "@sentinel/protocol";
import { cruiseAltitude, getClass } from "@sentinel/catalog";
import { Rng, seedRng } from "./rng";
import { destination } from "./geo";
import { geoElements, propagate, walkerElements } from "./orbit";
import type { Entity, FactionState, WorldState } from "./types";
import type { WorldMap } from "./world";

export const H3_RES_OP = 5;

export function h3Of(lat: number, lon: number, res = H3_RES_OP): string {
  return latLngToCell(Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6, res);
}

const zeroDomains = (): Record<Domain, number> => ({ LAND: 0, SEA: 0, AIR: 0, DRONE: 0, SPACE: 0 });

function factionState(id: Faction, name: string, will: number, escalation: number): FactionState {
  return {
    id, name, will, escalation, roe: "WEAPONS_TIGHT",
    losses: zeroDomains(), kills: zeroDomains(), lossPoints: 0, killPoints: 0, civilianHarm: 0, seekingTerms: false,
    tracks: [], nextTrackId: 1, flows: [], shortfallHours: 0, c2Links: [], unreachable: [], meanLatencyMs: 0,
    hourLossPoints: 0, hourKillPoints: 0, hourHarm: 0, triggers: [],
  };
}

const READINESS = { low: 0.55, medium: 0.75, high: 0.95 } as const;

/** Medium of a drone class (air, sea surface, undersea, ground). */
export function droneMedium(cls: string): "AIR" | "SEA" | "SUB" | "LAND" {
  if (cls === "usv") return "SEA";
  if (cls === "uuv") return "SUB";
  if (cls === "ugv") return "LAND";
  return "AIR";
}

export function movesOn(e: { domain: Domain; cls: string }): "LAND" | "SEA" | "AIR" | "SPACE" {
  if (e.domain === "DRONE") {
    const m = droneMedium(e.cls);
    return m === "SUB" ? "SEA" : m;
  }
  if (e.domain === "LAND") return "LAND";
  if (e.domain === "SEA") return "SEA";
  return e.domain === "SPACE" ? (getClass(e.cls).tags.includes("ORBITAL") ? "SPACE" : "LAND") : "AIR";
}

export function createWorld(scn: Scenario, seed: number, map: WorldMap): WorldState {
  const rngState = seedRng(seed);
  const rng = new Rng(rngState);
  const entities: Entity[] = [];
  const hqByFaction = new Map<Faction, string>();

  for (const u of scn.orbat) {
    const c = getClass(u.cls);
    for (let i = 0; i < u.count; i++) {
      const id = `${u.faction[0]}-${u.callsign}-${i + 1}`;
      const medium = movesOn({ domain: c.domain, cls: c.id });
      let lat = u.at[0], lon = u.at[1];
      if (u.count > 1 || u.spreadKm > 0) {
        for (let tries = 0; tries < 12; tries++) {
          const [pl, po] = destination(u.at[0], u.at[1], rng.range(0, 360), rng.range(0, u.spreadKm));
          const land = map.isLand(pl, po);
          if ((medium === "LAND" && land) || (medium === "SEA" && !land) || medium === "AIR" || medium === "SPACE") {
            lat = pl;
            lon = po;
            break;
          }
        }
      }
      const isAir = c.domain === "AIR" || (c.domain === "DRONE" && droneMedium(c.id) === "AIR");
      const sub = c.tags.includes("SUBMARINE") || c.id === "uuv";
      const e: Entity = {
        id, faction: u.faction, cls: c.id, domain: c.domain, callsign: `${u.callsign}-${i + 1}`,
        lat, lon, alt: isAir ? 0 : cruiseAltitude(c.domain, c.kinematics.ceiling, sub), heading: 0, h3: h3Of(lat, lon),
        task: { kind: u.task, issuedMs: 0 },
        health: 1, readiness: READINESS[u.readiness], morale: 1, strength: 1, supplyDays: u.supplyDays, fuel: 1,
        ammo: c.effectors.map((x) => x.magazine), emcon: false, comms: "OK", autonomy: u.autonomy,
        destroyed: false, decoy: u.decoy || c.id === "decoy_group", members: c.members ?? 1,
        sortie: isAir ? "READY" : "NA", posture: "DEFEND", entrenchH: 0, kills: 0,
      };
      if (isAir) e.home = { lat, lon };
      if (medium === "LAND") e.landmass = map.landmassAt(lat, lon);
      if (c.tags.includes("HQ") && !hqByFaction.has(u.faction)) hqByFaction.set(u.faction, id);
      entities.push(e);
    }
  }
  // Carrier basing: aircraft that start within 40 km of a friendly carrier operate from it.
  for (const e of entities) {
    if (!e.home) continue;
    const cv = entities.find((x) => x.faction === e.faction && x.cls === "csg" && Math.abs(x.lat - e.lat) < 0.4 && Math.abs(x.lon - e.lon) < 0.5);
    if (cv) e.home = { lat: cv.lat, lon: cv.lon, carrier: cv.id };
  }
  for (const e of entities) {
    const hq = hqByFaction.get(e.faction);
    if (hq && hq !== e.id) e.parent = hq;
  }

  for (const c of scn.space) {
    const cls = getClass(c.cls);
    for (let p = 0; p < c.planes; p++) {
      for (let k = 0; k < c.perPlane; k++) {
        const n = p * c.perPlane + k + 1;
        const el = c.altKm > 35000 ? geoElements(c.raanDeg + (360 / Math.max(1, c.perPlane * c.planes)) * (n - 1) * 0.25) : walkerElements(c.altKm, c.incDeg, c.raanDeg, p, c.planes, k, c.perPlane);
        const sp = propagate(el, 0);
        entities.push({
          id: `${c.faction[0]}-${c.callsign}-${n}`, faction: c.faction, cls: cls.id, domain: "SPACE", callsign: `${c.callsign}-${n}`,
          lat: sp.lat, lon: sp.lon, alt: sp.altKm * 1000, heading: 0, h3: h3Of(sp.lat, sp.lon),
          task: { kind: "ISR", issuedMs: 0 }, health: 1, readiness: 1, morale: 1, strength: 1, supplyDays: 999, fuel: 1,
          ammo: [], emcon: false, comms: "OK", autonomy: "FULL", destroyed: false, decoy: false, members: 1,
          sortie: "NA", posture: "MOVE", entrenchH: 0, orbit: el, pendingImagery: [], kills: 0,
          parent: hqByFaction.get(c.faction),
        });
      }
    }
  }

  const fac = (id: Faction) => scn.factions.find((f) => f.id === id);
  const esc = scn.rules.startEscalation;
  const factions = {
    BLUE: factionState("BLUE", fac("BLUE")?.name ?? "Blue", fac("BLUE")?.will ?? 70, esc),
    RED: factionState("RED", fac("RED")?.name ?? "Red", fac("RED")?.will ?? 70, esc),
    GREEN: factionState("GREEN", fac("GREEN")?.name ?? "Neutral shipping", fac("GREEN")?.will ?? 50, 0),
  };

  const [w, s, e, n] = scn.map.bbox;
  const fronts = [];
  for (let i = 0; i < scn.environment.fronts; i++) {
    fronts.push({
      lat: rng.range(s, n), lon: rng.range(w, e), radiusKm: rng.range(150, 400), intensity: rng.range(0.3, 0.9),
      vLat: rng.range(-0.15, 0.15), vLon: rng.range(0.1, 0.4),
    });
  }

  const objectives = scn.factions.flatMap((f) =>
    f.objectives.map((o) => ({ id: o.id, name: o.name, owner: f.id, kind: o.kind, domain: o.domain, center: o.center, radiusKm: o.radiusKm, weight: o.weight, holder: "NONE" as const, heldHours: 0 })),
  );

  const z = () => ({ LAND: 0, SEA: 0, AIR: 0, DRONE: 0, SPACE: 0 });
  return {
    version: 1, scenarioId: scn.id, seed, tick: 0, simMs: 0, tickMs: scn.rules.tickMs,
    rng: rng.s, rngDraws: rng.draws, entities, factions, messages: [], chains: [], missions: [], ew: [], cyber: [], debris: [],
    objectives, fronts, eventSeq: 0, events: [], history: [], injectsFired: 0, pendingOrders: [], orderLog: [], engageRequests: [], detections: [],
    nextId: 0, launches: [], cursor: { phase: 0, offset: 0 }, ended: false,
    metrics: {
      chainsSucceeded: 0, chainsBroken: { FIND: 0, FIX: 0, TRACK: 0, TARGET: 0, ENGAGE: 0, ASSESS: 0 }, sensorToShooterMs: [],
      escalationPeak: esc, supplyShortfallHours: 0, lossesByDomain: { BLUE: z(), RED: z(), GREEN: z() }, costLost: { BLUE: 0, RED: 0, GREEN: 0 },
    },
  };
}
