// Tactical controllers: deterministic behavior trees that execute orders with local autonomy
// (routes, sortie cycles, emissions posture, engagement timing inside the ROE), plus movement.
import type { Roe, Task } from "@sentinel/protocol";
import { BAND_FACTOR, RANGE_KM, SPEED_KMH, enduranceHours, cruiseAltitude, getClass, type AssetClass } from "@sentinel/catalog";
import type { Ctx } from "./ctx";
import { distKm, destination, stepToward, bearing } from "./geo";
import { h3Of, movesOn, droneMedium } from "./init";
import { planRoute } from "./routing";
import { weatherAt } from "./world";
import type { Entity, TaskState, Track } from "./types";
import { cellToLatLng } from "h3-js";

const FLIGHT_TASKS: Task[] = ["CAP", "PATROL", "STRIKE", "ISR", "ESCORT", "TANK", "MOVE", "ATTACK", "JAM"];

/** Minimum escalation rung at which a target may be engaged (spec §6 political model). */
export function rungRequired(targetCls: string | undefined, domain: string): number {
  if (domain === "SPACE") return 5;
  if (targetCls) {
    const tags = getClass(targetCls).tags;
    if (tags.includes("ORBITAL") || tags.includes("GROUND_STATION") || tags.includes("LAUNCH")) return 5;
    if (tags.includes("HQ") || tags.includes("LOGISTICS")) return 4;
  }
  if (domain === "LAND") return 3;
  return 2;
}

export function roeAllows(roe: Roe, tr: Track): boolean {
  if (roe === "WEAPONS_HOLD") return false;
  if (tr.affiliation !== "HOSTILE") return false;
  if (roe === "WEAPONS_TIGHT") return tr.quality === "IDENTIFIED" || tr.quality === "TRACKED";
  return tr.quality !== "DETECTED";
}

export function resolvePoint(task: TaskState, area?: string): [number, number] | undefined {
  if (task.point) return task.point;
  if (area) {
    try {
      const [la, lo] = cellToLatLng(area);
      return [Math.round(la * 1e6) / 1e6, Math.round(lo * 1e6) / 1e6];
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function applyTask(ctx: Ctx, u: Entity, task: TaskState) {
  u.task = { ...task, path: undefined, pathIdx: 0 };
  if (task.kind === "EMCON") u.emcon = true;
  else if (task.kind !== "HOLD" && u.emcon && task.kind !== "STRIKE") u.emcon = false;
  const c = getClass(u.cls);
  const air = isAir(u);
  if (air && (c.domain === "AIR" || c.domain === "DRONE")) {
    const id = ctx.nextId("M-");
    const win = task.window ?? [ctx.s.simMs, ctx.s.simMs + 6 * 3_600_000];
    ctx.s.missions.push({ id, unit: u.id, faction: u.faction, task: task.kind, startMs: win[0], endMs: win[1], status: "PLANNED" });
    if (ctx.s.missions.length > 400) ctx.s.missions.splice(0, ctx.s.missions.length - 400);
    u.missionId = id;
  }
  ctx.touch(u);
}

export function isAir(e: Entity): boolean {
  return e.domain === "AIR" || (e.domain === "DRONE" && droneMedium(e.cls) === "AIR");
}

function speedKmh(ctx: Ctx, e: Entity, c: AssetClass): number {
  let v = SPEED_KMH[c.kinematics.speed];
  const medium = movesOn(e);
  const w = weatherAt(ctx.s.fronts, e.lat, e.lon);
  if (medium === "LAND") v = v / 1 * (1 - 0.5 * w);
  if (medium === "SEA") v *= 1 - 0.3 * w;
  if (e.supplyDays <= 0 && !isAir(e)) v *= 0.5;
  if (e.domain === "LAND" && e.strength < 0.5) v *= 0.7;
  return v;
}

function moveTo(ctx: Ctx, e: Entity, c: AssetClass, target: [number, number], replanMs = 0): boolean {
  const medium = movesOn(e);
  const tickH = ctx.s.tickMs / 3_600_000;
  let budget = speedKmh(ctx, e, c) * tickH;
  if (budget <= 0) return false;
  const t = e.task;
  if (medium === "AIR" || medium === "SPACE") {
    t.path = [target];
    t.pathIdx = 0;
  } else {
    const last = t.planFor;
    const moved = !last || Math.abs(last[0] - target[0]) > 0.05 || Math.abs(last[1] - target[1]) > 0.05;
    const stale = ctx.s.simMs - t.issuedMs > replanMs;
    if (!t.path || (moved && (replanMs === 0 || stale))) {
      t.path = planRoute(ctx.map, medium, [e.lat, e.lon], target, e.landmass);
      t.planFor = target;
      t.pathIdx = 0;
      if (replanMs > 0) t.issuedMs = ctx.s.simMs;
    }
  }
  let arrived = false;
  let guard = 0;
  while (budget > 0.0001 && guard++ < 50) {
    const wp = t.path[t.pathIdx ?? 0];
    if (!wp) { arrived = true; break; }
    const cost = medium === "LAND" ? (ctx.map.terrainAt(e.lat, e.lon) === "PLAINS" ? 1 : 1.5) : 1;
    const step = stepToward(e.lat, e.lon, wp[0], wp[1], budget / cost);
    const moved = distKm(e.lat, e.lon, step.lat, step.lon);
    if (medium === "SEA" && ctx.map.isLand(step.lat, step.lon) && !ctx.map.isLand(e.lat, e.lon)) {
      t.path = undefined; // blocked: replan next tick
      break;
    }
    e.lat = step.lat;
    e.lon = step.lon;
    e.heading = Math.round(step.heading);
    budget -= moved * cost;
    if (step.arrived) {
      t.pathIdx = (t.pathIdx ?? 0) + 1;
      if ((t.pathIdx ?? 0) >= t.path.length) { arrived = true; break; }
    } else break;
  }
  e.h3 = h3Of(e.lat, e.lon);
  ctx.touch(e);
  return arrived;
}

/** Orbit a point (CAP, ISR, tanker tracks, patrol boxes). */
function orbitPoint(ctx: Ctx, e: Entity, c: AssetClass, p: [number, number], radiusKm: number) {
  const d = distKm(e.lat, e.lon, p[0], p[1]);
  if (d > radiusKm * 1.5) {
    moveTo(ctx, e, c, p);
    return;
  }
  const brg = (bearing(p[0], p[1], e.lat, e.lon) + 25) % 360;
  const next = destination(p[0], p[1], brg, radiusKm);
  e.task.path = [next];
  e.task.pathIdx = 0;
  moveTo(ctx, e, c, next);
}

function findTrack(ctx: Ctx, e: Entity, id?: string): Track | undefined {
  if (!id) return undefined;
  return ctx.s.factions[e.faction === "GREEN" ? "BLUE" : e.faction].tracks.find((t) => t.id === id);
}

function homePos(ctx: Ctx, e: Entity): [number, number] | null {
  if (!e.home) return null;
  if (e.home.carrier) {
    const cv = ctx.byId.get(e.home.carrier);
    if (cv && !cv.destroyed) return [cv.lat, cv.lon];
    return null;
  }
  return [e.home.lat, e.home.lon];
}

function nearestFriendlyBase(ctx: Ctx, e: Entity): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (const x of ctx.s.entities) {
    if (x.faction !== e.faction || x.destroyed || !x.home || x.home.carrier || x.domain !== "AIR") continue;
    const d = distKm(e.lat, e.lon, x.home.lat, x.home.lon);
    if (d < bd) { bd = d; best = [x.home.lat, x.home.lon]; }
  }
  return best;
}

function airLogic(ctx: Ctx, e: Entity, c: AssetClass) {
  const now = ctx.s.simMs;
  const t = e.task;
  const tickH = ctx.s.tickMs / 3_600_000;
  const mission = e.missionId ? ctx.s.missions.find((m) => m.id === e.missionId) : undefined;
  if (e.sortie === "REARMING") {
    if (now >= (e.rearmUntil ?? 0)) {
      e.sortie = "READY";
      e.ammo = c.effectors.map((x) => x.magazine);
      e.fuel = 1;
      ctx.touch(e);
    }
    const hp = homePos(ctx, e);
    if (hp) { e.lat = hp[0]; e.lon = hp[1]; }
    return;
  }
  if (e.sortie === "READY") {
    const hp = homePos(ctx, e);
    if (hp) { e.lat = hp[0]; e.lon = hp[1]; e.h3 = h3Of(e.lat, e.lon); }
    const wantsFlight = FLIGHT_TASKS.includes(t.kind) && (!t.window || (now >= t.window[0] && now < t.window[1]));
    if (!wantsFlight) return;
    // Sortie generation: readiness, weather and supply limit how fast aircraft get airborne.
    const w = weatherAt(ctx.s.fronts, e.lat, e.lon);
    const p = e.readiness * (1 - 0.6 * w) * (e.supplyDays > 0 ? 1 : 0.5) * Math.min(1, tickH * 6);
    if (!ctx.rng.chance(p)) return;
    e.sortie = "AIRBORNE";
    e.alt = cruiseAltitude(c.domain, c.kinematics.ceiling, false);
    if (mission) mission.status = "ACTIVE";
    ctx.emit({ type: "SORTIE", vis: ctx.vis(e.faction), text: `${e.callsign} airborne for ${t.kind}`, entities: [e.id] });
    ctx.touch(e);
    return;
  }
  // AIRBORNE
  const endurance = enduranceHours(c.endurance.fuel, c.endurance.burn, c.domain);
  e.fuel = Math.max(0, e.fuel - tickH / endurance);
  const oneWay = c.tags.includes("SWARM") || c.effectors.some((x) => x.type === "LOITER");
  if (e.fuel <= 0 && !oneWay) {
    destroy(ctx, e, "fuel exhaustion");
    return;
  }
  if (oneWay && e.fuel <= 0) {
    destroy(ctx, e, "endurance spent");
    return;
  }
  const rtb = () => {
    const hp = homePos(ctx, e) ?? nearestFriendlyBase(ctx, e);
    if (!hp) { if (e.task.kind !== "RTB") e.task = { kind: "RTB", issuedMs: now }; return; }
    if (moveTo(ctx, e, c, hp)) {
      e.sortie = oneWay ? "READY" : "REARMING";
      e.alt = 0;
      e.rearmUntil = now + Math.round((2 * 3_600_000) / Math.max(0.3, e.readiness));
      if (mission) mission.status = "DONE";
      if (t.kind === "RTB" || (t.window && now >= t.window[1])) e.task = { kind: "HOLD", issuedMs: now };
      ctx.emit({ type: "RECOVERED", vis: ctx.vis(e.faction), text: `${e.callsign} recovered to base`, entities: [e.id] });
    }
  };
  if (!oneWay && e.fuel < 0.35 && c.endurance.refuelable && t.kind !== "RTB") {
    const tanker = ctx.s.entities.find((x) => x.faction === e.faction && !x.destroyed && x.cls === "tanker" && x.sortie === "AIRBORNE" && distKm(e.lat, e.lon, x.lat, x.lon) < 600);
    if (tanker) {
      if (moveTo(ctx, e, c, [tanker.lat, tanker.lon]) || distKm(e.lat, e.lon, tanker.lat, tanker.lon) < 25) {
        e.fuel = 1;
        tanker.fuel = Math.max(0.2, tanker.fuel - 0.08);
        ctx.emit({ type: "AIR_REFUEL", vis: ctx.vis(e.faction), text: `${e.callsign} refueled from ${tanker.callsign}`, entities: [e.id, tanker.id] });
      }
      return;
    }
  }
  const hpNow = homePos(ctx, e) ?? nearestFriendlyBase(ctx, e);
  const fuelHome = hpNow ? distKm(e.lat, e.lon, hpNow[0], hpNow[1]) / Math.max(1, SPEED_KMH[c.kinematics.speed]) / endurance : 0;
  if (!oneWay && (e.fuel < fuelHome * 1.25 + 0.08 || t.kind === "RTB" || t.kind === "HOLD" || (t.window && now >= t.window[1]) || (t.kind === "STRIKE" && e.ammo.every((a) => a <= 0)))) {
    rtb();
    return;
  }
  const p = t.point;
  switch (t.kind) {
    case "CAP": if (p) orbitPoint(ctx, e, c, p, 30); break;
    case "ISR": case "PATROL": case "JAM": if (p) orbitPoint(ctx, e, c, p, 50); break;
    case "TANK": if (p) orbitPoint(ctx, e, c, p, 20); break;
    case "ESCORT": {
      const f = t.target ? ctx.byId.get(t.target) : undefined;
      if (f && !f.destroyed) moveTo(ctx, e, c, [f.lat, f.lon]);
      else if (p) orbitPoint(ctx, e, c, p, 30);
      break;
    }
    case "STRIKE": case "ATTACK": {
      const tr = findTrack(ctx, e, t.target);
      const dest: [number, number] | undefined = tr ? [tr.lat, tr.lon] : p;
      if (!dest) { rtb(); break; }
      const strikeRange = Math.max(0, ...c.effectors.filter((x, i) => e.ammo[i] > 0 && !x.targets.includes("AIR")).map((x) => RANGE_KM[x.range]));
      if (distKm(e.lat, e.lon, dest[0], dest[1]) > strikeRange * 0.8) moveTo(ctx, e, c, dest);
      else if (!tr && oneWay) destroy(ctx, e, "expended on area target");
      break;
    }
    case "MOVE": if (p) moveTo(ctx, e, c, p); break;
    default: break;
  }
}

/** Movement and autonomous behavior for one entity (the "move" phase work unit). */
export function tacticalEntity(ctx: Ctx, e: Entity) {
  if (e.destroyed) return;
  const c = getClass(e.cls);
  if (e.domain === "SPACE" && e.orbit) {
    const sp = ctx.satPos.get(e.id);
    if (sp) {
      e.lat = sp.lat;
      e.lon = sp.lon;
      e.alt = sp.altKm * 1000;
      if (ctx.s.tick % 5 === 0) { e.h3 = h3Of(e.lat, e.lon); ctx.touch(e); }
    }
    return;
  }
  const now = ctx.s.simMs;
  const tickH = ctx.s.tickMs / 3_600_000;

  // Survival rules (autonomy): combat-ineffective formations withdraw toward their HQ.
  if (e.ineffectiveMs !== undefined && e.strength >= 0.5) e.ineffectiveMs = undefined;
  if (e.ineffectiveMs !== undefined && e.task.kind === "HOLD" && e.supplyDays > 0) {
    e.strength = Math.min(1, e.strength + 0.01 * tickH); // slow reconstitution in the rear
    e.health = e.strength;
  }
  if (c.combatPower > 0 && e.domain === "LAND" && e.strength < 0.3 && e.ineffectiveMs === undefined) {
    e.ineffectiveMs = now;
    const hq = e.parent ? ctx.byId.get(e.parent) : undefined;
    e.task = { kind: "WITHDRAW", issuedMs: now, point: hq && !hq.destroyed ? [hq.lat, hq.lon] : undefined };
    ctx.emit({ type: "COMBAT_INEFFECTIVE", vis: ctx.vis(e.faction), text: `${e.callsign} below 30% strength — withdrawing`, entities: [e.id], factors: { strength: Math.round(e.strength * 100) / 100 }, notable: true });
    ctx.s.factions[e.faction as "BLUE"].triggers.push(`unit ${e.id} combat ineffective`);
  }

  // Engagement opportunities inside ROE (requests are adjudicated in the engage phase).
  if (c.effectors.length && !e.decoy && (!isAir(e) || e.sortie === "AIRBORNE")) scanTargets(ctx, e, c);

  // EW and cyber tasks.
  if (e.task.kind === "JAM") jamTask(ctx, e, c);
  if (e.task.kind === "CYBER") cyberTask(ctx, e, c);

  if (isAir(e)) {
    airLogic(ctx, e, c);
    return;
  }
  if (SPEED_KMH[c.kinematics.speed] === 0) return;

  const t = e.task;
  const p = t.point;
  switch (t.kind) {
    case "MOVE":
    case "RESUPPLY": {
      const tgt = t.target ? ctx.byId.get(t.target) : undefined;
      const dest = tgt && !tgt.destroyed ? ([tgt.lat, tgt.lon] as [number, number]) : p;
      if (dest && moveTo(ctx, e, c, dest, tgt ? 1_800_000 : 0)) {
        if (t.kind === "MOVE") e.task = { kind: "HOLD", issuedMs: now };
      }
      e.posture = "MOVE";
      e.entrenchH = 0;
      break;
    }
    case "WITHDRAW": {
      const dest = p ?? (e.parent ? (() => { const h = ctx.byId.get(e.parent!); return h ? ([h.lat, h.lon] as [number, number]) : undefined; })() : undefined);
      if (dest && moveTo(ctx, e, c, dest)) e.task = { kind: "HOLD", issuedMs: now };
      e.posture = "MOVE";
      e.entrenchH = 0;
      break;
    }
    case "ATTACK": {
      const tr = findTrack(ctx, e, t.target);
      const dest: [number, number] | undefined = tr ? [tr.lat, tr.lon] : p;
      e.posture = "ATTACK";
      e.entrenchH = 0;
      if (dest && distKm(e.lat, e.lon, dest[0], dest[1]) > 4) moveTo(ctx, e, c, dest, 1_800_000);
      break;
    }
    case "DEFEND":
    case "PATROL":
    case "ESCORT":
    case "ISR":
    case "STRIKE": {
      let dest = p;
      if (t.kind === "ESCORT" && t.target) {
        const f = ctx.byId.get(t.target);
        if (f && !f.destroyed) dest = [f.lat, f.lon];
      }
      if (t.kind === "STRIKE") {
        const tr = findTrack(ctx, e, t.target);
        const rng = Math.max(0, ...c.effectors.map((x) => RANGE_KM[x.range]));
        if (tr && distKm(e.lat, e.lon, tr.lat, tr.lon) > rng * 0.8) dest = [tr.lat, tr.lon];
        else dest = undefined;
      }
      if (dest && distKm(e.lat, e.lon, dest[0], dest[1]) > (t.kind === "PATROL" ? 15 : 3)) {
        moveTo(ctx, e, c, dest, 1_800_000);
        e.posture = "MOVE";
        e.entrenchH = 0;
      } else if (t.kind === "PATROL" && dest && movesOn(e) === "SEA") {
        const brg = (bearing(dest[0], dest[1], e.lat, e.lon) + 30) % 360;
        e.task.path = [destination(dest[0], dest[1], brg, 12)];
        e.task.pathIdx = 0;
        moveTo(ctx, e, c, e.task.path[0]);
      } else {
        dig(e, tickH);
      }
      break;
    }
    default:
      dig(e, tickH);
  }
}

function dig(e: Entity, tickH: number) {
  if (e.domain !== "LAND") return;
  e.entrenchH += tickH;
  e.posture = e.entrenchH > 6 ? "ENTRENCHED" : "DEFEND";
}

function scanTargets(ctx: Ctx, e: Entity, c: AssetClass) {
  if (e.faction === "GREEN") return;
  const fs = ctx.s.factions[e.faction];
  const now = ctx.s.simMs;
  if (e.lastFireMs !== undefined && now - e.lastFireMs < 10 * 60_000) return;
  if (e.domain === "LAND" && e.strength < 0.3) return;
  const roe = fs.roe;
  const rung = fs.escalation;
  const explicit = e.task.kind === "STRIKE" ? e.task.target : undefined;
  let best: { tr: Track; eff: number; score: number } | null = null;
  for (let i = 0; i < c.effectors.length; i++) {
    const ef = c.effectors[i];
    if (e.ammo[i] <= 0 || ef.type === "JAMMER" || ef.type === "CYBER") continue;
    const pending = ctx.s.chains.filter((k) => k.status === "ACTIVE" && k.shooter === e.id && k.effector === i).length;
    if (e.ammo[i] < (pending + 1) * ef.salvo) continue;
    if (ef.type === "DIRECT" && ef.targets.includes("LAND")) continue; // direct-fire land combat is Lanchester
    const rangeKm = RANGE_KM[ef.range];
    if (ef.type === "ASAT") {
      // Counter-space: the target must be named explicitly (a space-catalog entity id).
      if (!explicit || rung < 5) continue;
      const sat = ctx.byId.get(explicit);
      if (sat && !sat.destroyed && sat.domain === "SPACE" && sat.faction !== e.faction) {
        ctx.s.engageRequests.push({ shooter: e.id, trackId: explicit, effector: i });
        e.lastFireMs = now;
      }
      return;
    }
    for (const tr of fs.tracks) {
      if (tr.believedDead) continue;
      if (explicit && tr.id !== explicit && !ef.targets.includes("AIR")) continue;
      if (!ef.targets.includes(tr.believedDomain)) continue;
      if (!roeAllows(roe, tr)) continue;
      if (rung < rungRequired(tr.believedClass, tr.believedDomain)) continue;
      if (tr.alt < -20 && ef.type !== "TORPEDO") continue;
      const fresh = tr.believedDomain === "AIR" || tr.believedDomain === "DRONE" ? 15 * 60_000 : 45 * 60_000;
      if (now - tr.lastSeenMs > fresh) continue;
      const d = distKm(e.lat, e.lon, tr.lat, tr.lon);
      if (d > rangeKm) continue;
      const active = ctx.s.chains.filter((k) => k.status === "ACTIVE" && k.track === tr.id && k.faction === e.faction).length;
      if (active >= 2) continue;
      const value = tr.believedClass ? getClass(tr.believedClass).cost.points : 10;
      const score = value * (tr.id === explicit ? 5 : 1) * (1 - d / (rangeKm + 1)) * BAND_FACTOR[ef.pk];
      if (!best || score > best.score) best = { tr, eff: i, score };
    }
  }
  if (best) {
    ctx.s.engageRequests.push({ shooter: e.id, trackId: best.tr.id, effector: best.eff });
    e.lastFireMs = now;
  }
}

function jamTask(ctx: Ctx, e: Entity, c: AssetClass) {
  const idx = c.effectors.findIndex((x) => x.type === "JAMMER");
  if (idx < 0) return;
  const ef = c.effectors[idx];
  const ground = c.tags.includes("GROUND_STATION");
  const p = e.task.point ?? [e.lat, e.lon];
  const reach = RANGE_KM[ef.range];
  if (distKm(e.lat, e.lon, p[0], p[1]) > reach && !ground) return;
  const id = `EW-${e.id}`;
  let f = ctx.s.ew.find((x) => x.id === id);
  const kind = ground ? "SATCOM" : "JAM";
  if (!f) {
    f = { id, faction: e.faction, source: e.id, lat: p[0], lon: p[1], radiusKm: ground ? 400 : Math.min(120, reach), strength: BAND_FACTOR[ef.pk] * 0.8, kind, untilMs: 0 };
    ctx.s.ew.push(f);
    ctx.c2Dirty = true;
    ctx.emit({ type: "JAMMING_ON", vis: ["WHITE", "BLUE", "RED"], text: `${kind === "SATCOM" ? "SATCOM downlink" : "Radar/datalink"} jamming detected near ${p[0].toFixed(1)}, ${p[1].toFixed(1)}`, entities: [e.id], factors: { radiusKm: f.radiusKm, strength: f.strength } });
  }
  f.lat = p[0];
  f.lon = p[1];
  f.untilMs = ctx.s.simMs + 30 * 60_000;
  e.emcon = false;
}

function cyberTask(ctx: Ctx, e: Entity, c: AssetClass) {
  const now = ctx.s.simMs;
  if (e.faction === "GREEN" || (e.lastFireMs !== undefined && now - e.lastFireMs < 6 * 3_600_000)) return;
  const fs = ctx.s.factions[e.faction];
  if (fs.escalation < 1) return;
  const tr = fs.tracks.find((t) => t.id === e.task.target) ?? fs.tracks.find((t) => t.believedClass === "hq" || t.believedClass === "ground_station");
  if (!tr) return;
  const victimEntity = ctx.byId.get(tr.truthId);
  if (!victimEntity || victimEntity.faction === e.faction || victimEntity.faction === "GREEN") return;
  e.lastFireMs = now;
  const before = ctx.rng.draws;
  const success = ctx.rng.chance(0.6 * BAND_FACTOR["medium"] / Math.max(0.3, BAND_FACTOR[getClass(victimEntity.cls).defenses.hardening]));
  const kind = victimEntity.cls === "hq" ? "DENY" : victimEntity.cls === "ground_station" ? "DELAY" : "DECEIVE";
  const detected = ctx.rng.chance(0.3);
  if (success) {
    ctx.s.cyber.push({ id: ctx.nextId("CY-"), attacker: e.faction, victim: victimEntity.faction, node: victimEntity.id, kind, untilMs: now + 2 * 3_600_000, detected });
    ctx.c2Dirty = true;
  }
  ctx.emit({
    type: "CYBER_EFFECT", vis: ctx.vis(e.faction), entities: [e.id, victimEntity.id], notable: success,
    text: success ? `Cyber ${kind} effect on ${victimEntity.callsign} (2 h)` : `Cyber attempt on ${victimEntity.callsign} failed`,
    factors: { hardening: getClass(victimEntity.cls).defenses.hardening, success: success ? 1 : 0 },
  }, before);
  if (detected) {
    ctx.emit({ type: "CYBER_DETECTED", vis: ctx.vis(victimEntity.faction), entities: [victimEntity.id], text: `${victimEntity.faction} detected a ${e.faction} cyber intrusion against ${victimEntity.callsign}`, notable: true });
    ctx.s.factions[victimEntity.faction].triggers.push("cyber intrusion detected");
  }
}

/** Marks an entity destroyed and books the loss. */
export function destroy(ctx: Ctx, e: Entity, why: string, killer?: Entity) {
  if (e.destroyed) return;
  e.destroyed = true;
  e.destroyedMs = ctx.s.simMs;
  e.health = 0;
  ctx.touch(e);
  ctx.c2Dirty = true;
  const c = getClass(e.cls);
  const fs = ctx.s.factions[e.faction];
  fs.losses[e.domain] += 1;
  fs.lossPoints += c.cost.points;
  fs.hourLossPoints += c.cost.points;
  ctx.s.metrics.lossesByDomain[e.faction][e.domain] += 1;
  ctx.s.metrics.costLost[e.faction] += c.cost.points;
  if (killer && killer.faction !== e.faction) {
    const kf = ctx.s.factions[killer.faction];
    kf.kills[e.domain] += 1;
    kf.killPoints += c.cost.points;
    kf.hourKillPoints += c.cost.points;
    killer.kills += 1;
  }
  if (e.faction !== "GREEN") fs.triggers.push(`lost ${e.callsign}`);
  ctx.emit({
    type: "ENTITY_DESTROYED", vis: ["WHITE", ...(e.faction !== "GREEN" ? [e.faction] : []), ...(killer && killer.faction !== "GREEN" && killer.faction !== e.faction ? [killer.faction] : [])] as ("WHITE" | "BLUE" | "RED")[],
    text: `${e.callsign} (${c.name}) destroyed — ${why}`, entities: killer ? [e.id, killer.id] : [e.id], notable: c.cost.points >= 30,
    factors: { cost: c.cost.points },
  });
  // Lost satellites can be replaced from a surviving launch site (rapid reconstitution, game-balanced).
  if (e.domain === "SPACE" && e.orbit && ctx.s.entities.some((x) => x.faction === e.faction && x.cls === "launch_site" && !x.destroyed)) {
    if (c.tags.includes("BROADBAND") || c.tags.includes("ISR")) {
      ctx.s.launches.push({ faction: e.faction, cls: e.cls, callsign: `${e.callsign}R`, atMs: ctx.s.simMs + 72 * 3_600_000, orbit: { ...e.orbit, epochMs: e.orbit.epochMs } });
    }
  }
  if (e.missionId) {
    const m = ctx.s.missions.find((x) => x.id === e.missionId);
    if (m && m.status !== "DONE") m.status = "ABORTED";
  }
}
