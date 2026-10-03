// Abstract kill chain (F2T2EA), salvo-versus-layered-defense resolution, BDA, and stochastic
// Lanchester square-law land combat (spec §6).
import { KILL_CHAIN_STAGES, type Faction, type KillChainStage } from "@sentinel/protocol";
import { BAND_FACTOR, PK, RANGE_KM, getClass, type EffectorSpec } from "@sentinel/catalog";
import type { Ctx } from "./ctx";
import { distKm } from "./geo";
import { c2Route, sendReport } from "./c2";
import { destroy, roeAllows, rungRequired } from "./tactical";
import { TERRAIN_DEFENSE, weatherAt } from "./world";
import type { Entity, KillChain, Track } from "./types";
import { DEG, RAD } from "./dmath";

const WEAPON_KMH: Record<EffectorSpec["type"], number> = {
  DIRECT: 3000, INDIRECT: 2000, MISSILE_AA: 3500, MISSILE_AS: 2500, MISSILE_ASHM: 1000, MISSILE_LAND: 900,
  TORPEDO: 80, JAMMER: 0, CYBER: 0, ASAT: 20000, LOITER: 180,
};

function trackFor(ctx: Ctx, ch: KillChain): Track | undefined {
  return ctx.s.factions[ch.faction].tracks.find((t) => t.id === ch.track);
}

/** Turns engagement requests from tactical controllers into kill chains. */
export function startChains(ctx: Ctx) {
  for (const r of ctx.s.engageRequests) {
    const shooter = ctx.byId.get(r.shooter);
    if (!shooter || shooter.destroyed || shooter.faction === "GREEN") continue;
    const c = getClass(shooter.cls);
    const ef = c.effectors[r.effector];
    const space = ef.type === "ASAT";
    const tr = space ? undefined : ctx.s.factions[shooter.faction].tracks.find((t) => t.id === r.trackId);
    if (!space && !tr) continue;
    const ch: KillChain = {
      id: ctx.nextId("KC-"), faction: shooter.faction, shooter: shooter.id, track: r.trackId, truthId: tr ? tr.truthId : r.trackId,
      effector: r.effector, weapon: `${ef.type}`, stage: "FIND", stageStartMs: ctx.s.simMs,
      stages: [{ stage: "FIND", startMs: ctx.s.simMs }], status: "ACTIVE", c2LatencyMs: 0, startMs: ctx.s.simMs, readyAtMs: ctx.s.simMs,
    };
    ctx.s.chains.push(ch);
    ctx.dirtyChains.add(ch.id);
  }
  ctx.s.engageRequests = [];
}

function advance(ctx: Ctx, ch: KillChain, ok: boolean, reason?: string, durationMs = 0) {
  const now = ctx.s.simMs;
  const cur = ch.stages[ch.stages.length - 1];
  cur.endMs = now;
  cur.ok = ok;
  if (reason) cur.reason = reason;
  ctx.dirtyChains.add(ch.id);
  if (!ok) {
    ch.status = "BROKEN";
    ch.brokenAt = ch.stage;
    ch.endMs = now;
    ctx.s.metrics.chainsBroken[ch.stage] += 1;
    ctx.emit({
      type: "KILL_CHAIN_BROKEN", vis: ctx.vis(ch.faction), entities: [ch.shooter, ch.truthId],
      text: `Kill chain ${ch.id} broke at ${ch.stage}: ${reason}`, factors: { stage: ch.stage, reason: reason ?? "", c2LatencyMin: Math.round(ch.c2LatencyMs / 60000) },
    });
    return;
  }
  const idx = KILL_CHAIN_STAGES.indexOf(ch.stage);
  if (idx === KILL_CHAIN_STAGES.length - 1) {
    ch.status = "SUCCESS";
    ch.endMs = now;
    return;
  }
  const next = KILL_CHAIN_STAGES[idx + 1];
  ch.stage = next;
  ch.stageStartMs = now;
  ch.readyAtMs = now + durationMs;
  ch.stages.push({ stage: next, startMs: now });
}

/** Engage phase work unit: one active kill chain. */
export function progressChain(ctx: Ctx, ch: KillChain) {
  if (ch.status !== "ACTIVE") return;
  const now = ctx.s.simMs;
  if (now < ch.readyAtMs) return;
  const shooter = ctx.byId.get(ch.shooter);
  if (!shooter || shooter.destroyed) return advance(ctx, ch, false, "shooter lost");
  const c = getClass(shooter.cls);
  const ef = c.effectors[ch.effector];
  const space = ef.type === "ASAT";
  const tr = space ? undefined : trackFor(ctx, ch);
  const waited = now - ch.stageStartMs;
  switch (ch.stage) {
    case "FIND":
      if (!space && !tr) return advance(ctx, ch, false, "no track");
      return advance(ctx, ch, true, undefined, space ? 600_000 : 0);
    case "FIX": {
      if (space) return advance(ctx, ch, true, undefined, 300_000);
      if (!tr) return advance(ctx, ch, false, "track dropped before fix");
      if (tr.quality === "DETECTED") {
        if (waited > 1_800_000) return advance(ctx, ch, false, "track never classified");
        return;
      }
      return advance(ctx, ch, true, undefined, tr.quality === "CLASSIFIED" ? 300_000 : 120_000);
    }
    case "TRACK": {
      if (space) return advance(ctx, ch, true, undefined, 0);
      if (!tr) return advance(ctx, ch, false, "track lost");
      const stale = now - tr.lastSeenMs;
      const limit = tr.believedDomain === "LAND" || tr.believedDomain === "SEA" ? 1_800_000 : 600_000;
      if (stale > limit) {
        if (waited > 1_800_000) return advance(ctx, ch, false, `track stale (${Math.round(stale / 60000)} min old)`);
        return;
      }
      return advance(ctx, ch, true, undefined, 0);
    }
    case "TARGET": {
      // ROE approval travels over C2: STRICT needs a round trip, MISSION a notification, FULL none.
      const fs = ctx.s.factions[ch.faction];
      if (tr && !roeAllows(fs.roe, tr)) return advance(ctx, ch, false, `ROE ${fs.roe} forbids engagement`);
      if (tr && fs.escalation < rungRequired(tr.believedClass, tr.believedDomain)) return advance(ctx, ch, false, "escalation rung forbids target");
      const r = c2Route(ctx, ch.faction, shooter.id);
      if (!r && shooter.autonomy === "STRICT") return advance(ctx, ch, false, "no C2 path for approval");
      const lat = !r ? 0 : shooter.autonomy === "STRICT" ? 2 * r.latency : shooter.autonomy === "MISSION" ? Math.round(r.latency / 2) : 0;
      ch.c2LatencyMs = lat;
      const dest = tr ? [tr.lat, tr.lon] : (() => { const s = ctx.byId.get(ch.truthId); return s ? [s.lat, s.lon] : [shooter.lat, shooter.lon]; })();
      const d = distKm(shooter.lat, shooter.lon, dest[0], dest[1]);
      const fly = WEAPON_KMH[ef.type] > 0 ? Math.round((d / WEAPON_KMH[ef.type]) * 3_600_000) : 0;
      return advance(ctx, ch, true, undefined, lat + fly);
    }
    case "ENGAGE":
      return resolveEngagement(ctx, ch, shooter, ef, tr);
    case "ASSESS": {
      const truth = ctx.byId.get(ch.truthId);
      const before = ctx.rng.draws;
      const actual = !!truth?.destroyed;
      const hit = ch.actualKill !== undefined;
      const believe = actual ? ctx.rng.chance(0.85) : hit ? ctx.rng.chance(0.25) : ctx.rng.chance(0.05);
      ch.believedKill = believe;
      if (tr && believe) tr.believedDead = true;
      ctx.emit({
        type: "BDA", vis: ctx.vis(ch.faction), entities: [ch.shooter, ch.truthId],
        text: `${shooter.callsign} BDA on ${ch.track}: ${believe ? "assessed destroyed" : "not destroyed"}`,
        factors: { believed: believe ? 1 : 0, actual: actual ? 1 : 0 },
      }, before);
      sendReport(ctx, ch.faction, shooter, "BDA", { chain: ch.id, track: ch.track, assessed: believe ? "DESTROYED" : "SURVIVED" });
      ctx.s.metrics.chainsSucceeded += 1;
      ctx.s.metrics.sensorToShooterMs.push(ch.stages.find((s) => s.stage === "ENGAGE")?.endMs ?? now - ch.startMs);
      const eng = ch.stages.find((s) => s.stage === "ENGAGE");
      if (eng?.endMs !== undefined) ctx.s.metrics.sensorToShooterMs[ctx.s.metrics.sensorToShooterMs.length - 1] = eng.endMs - ch.startMs;
      return advance(ctx, ch, true);
    }
  }
}

function inGnssDenial(ctx: Ctx, f: Faction, lat: number, lon: number): boolean {
  return ctx.s.ew.some((x) => x.kind === "GNSS" && x.faction !== f && distKm(lat, lon, x.lat, x.lon) <= x.radiusKm);
}

function resolveEngagement(ctx: Ctx, ch: KillChain, shooter: Entity, ef: EffectorSpec, tr: Track | undefined) {
  const now = ctx.s.simMs;
  const before = ctx.rng.draws;
  const target = ctx.byId.get(ch.truthId);
  const salvo = Math.min(ef.salvo, shooter.ammo[ch.effector]);
  if (salvo <= 0) return advance(ctx, ch, false, "magazine empty");
  shooter.ammo[ch.effector] -= salvo;
  ctx.touch(shooter);
  const enemyF = target?.faction;
  // Missile warning satellites see long-range launches and cue the victim.
  if (enemyF && enemyF !== "GREEN" && (ef.range === "long" || ef.range === "very_long" || ef.type === "ASAT")) {
    const mw = ctx.s.entities.some((x) => x.faction === enemyF && x.cls === "missile_warning" && !x.destroyed);
    const fsV = ctx.s.factions[enemyF];
    if (mw && (fsV.lastWarnMs === undefined || now - fsV.lastWarnMs >= 1_800_000)) {
      fsV.lastWarnMs = now;
      ctx.emit({ type: "LAUNCH_WARNING", vis: ctx.vis(enemyF), entities: [target!.id], text: `${enemyF} missile warning: launch detected toward ${target!.callsign}` });
      ctx.s.factions[enemyF].triggers.push("launch warning");
    }
  }
  if (!target || target.destroyed) {
    ctx.emit({
      type: "ENGAGEMENT", vis: ctx.vis(ch.faction), entities: [shooter.id],
      text: `${shooter.callsign} fired ${salvo}× ${ef.type} at ${ch.track} — ${target ? "target already destroyed" : "no real target (decoy or false track)"}`,
      factors: { salvo, hits: 0 },
    }, before);
    ch.actualKill = undefined;
    return advance(ctx, ch, true, undefined, 900_000);
  }
  const tc = getClass(target.cls);
  // Layered defense: the target and nearby friendly air defenses each get interceptor shots.
  let interceptors = 0;
  let intercepted = 0;
  const missile = ef.type.startsWith("MISSILE") || ef.type === "LOITER" || ef.type === "ASAT";
  let incoming = salvo * (target.members > 1 && ef.type === "LOITER" ? 1 : 1);
  if (missile && ef.type !== "ASAT") {
    const defenders: { e: Entity; pk: number; shots: number; idx: number }[] = [];
    const self = BAND_FACTOR[tc.defenses.hardKill];
    if (self > 0) defenders.push({ e: target, pk: PK[tc.defenses.hardKill], shots: 1 + Math.round(self * 2), idx: -1 });
    const near = ctx.index.near(target.lat, target.lon, 120);
    for (const d of near) {
      if (d === target || d.faction !== target.faction || d.destroyed) continue;
      const dc = getClass(d.cls);
      if (!dc.tags.includes("AIR_DEFENSE")) continue;
      const idx = dc.effectors.findIndex((x) => x.type === "MISSILE_AA");
      if (idx < 0 || d.ammo[idx] <= 0) continue;
      if (distKm(d.lat, d.lon, target.lat, target.lon) > RANGE_KM[dc.effectors[idx].range]) continue;
      defenders.push({ e: d, pk: PK[dc.effectors[idx].pk], shots: Math.min(d.ammo[idx], 1 + Math.round(BAND_FACTOR[dc.defenses.hardKill] * 2)), idx });
    }
    for (const d of defenders) {
      for (let s = 0; s < d.shots && incoming > 0; s++) {
        interceptors++;
        if (d.idx >= 0) { d.e.ammo[d.idx] = Math.max(0, d.e.ammo[d.idx] - 1); ctx.touch(d.e); }
        if (ctx.rng.chance(d.pk * (ef.type === "MISSILE_AA" ? 0.5 : 1))) { intercepted++; incoming--; }
      }
    }
  }
  const soft = BAND_FACTOR[tc.defenses.softKill];
  const gnss = (ef.type.startsWith("MISSILE") && ef.type !== "MISSILE_AA") || ef.type === "LOITER" ? (inGnssDenial(ctx, shooter.faction, target.lat, target.lon) ? 0.6 : 1) : 1;
  const supply = shooter.supplyDays > 0 ? 1 : 0.7;
  const wx = ef.type === "LOITER" ? 1 - 0.3 * weatherAt(ctx.s.fronts, target.lat, target.lon) : 1;
  const pk = PK[ef.pk] * (1 - 0.3 * soft) * gnss * supply * wx;
  let hits = 0;
  for (let i = 0; i < incoming; i++) if (ctx.rng.chance(pk)) hits++;
  const armor = BAND_FACTOR[tc.defenses.armor];
  const formation = tc.echelon === "formation" || tc.combatPower >= 40;
  if (hits > 0) {
    if (target.members > 1 && (target.domain === "AIR" || target.domain === "DRONE")) {
      target.members = Math.max(0, target.members - hits);
      target.health = Math.round((target.members / (tc.members ?? 1)) * 1000) / 1000;
    } else if (formation && target.domain === "LAND") {
      target.strength = Math.max(0, target.strength - (0.08 * hits) / (1 + armor));
      target.health = target.strength;
    } else if (formation) {
      target.health = Math.max(0, target.health - (0.12 * hits) / (1 + armor));
    } else {
      target.health = Math.max(0, target.health - (0.45 * hits) / (1 + armor));
    }
    target.morale = Math.max(0.2, target.morale - 0.05 * hits);
    ctx.touch(target);
    if (target.faction !== "GREEN") ctx.s.factions[target.faction].triggers.push(`${target.callsign} hit`);
  }
  // Civilian harm: strikes near cities and on neutral shipping are costs, never rewards.
  let harm = 0;
  if (target.faction === "GREEN") harm += 5 * Math.max(1, hits);
  else if (target.domain === "LAND" && hits > 0) for (const city of ctx.scn.map.cities) if (distKm(target.lat, target.lon, city.at[0], city.at[1]) < 15) harm += hits;
  if (harm > 0 && shooter.faction !== "GREEN") {
    const fs = ctx.s.factions[shooter.faction];
    fs.civilianHarm += harm;
    fs.hourHarm += harm;
    ctx.emit({ type: "CIVILIAN_HARM", vis: ["WHITE", "BLUE", "RED"], entities: [shooter.id, target.id], text: `Civilian harm reported after ${shooter.callsign}'s strike (${harm})`, notable: true, factors: { harm } });
  }
  const killed = target.health <= 0.05 || (target.domain === "LAND" && target.strength <= 0.05) || target.members <= 0;
  ctx.emit({
    type: "ENGAGEMENT", vis: ctx.vis(ch.faction, target.faction === "GREEN" ? undefined : target.faction), entities: [shooter.id, target.id],
    text: `${shooter.callsign} → ${target.callsign}: ${salvo}× ${ef.type}, ${intercepted} intercepted, ${hits} hit${killed ? " — destroyed" : ""}`,
    factors: { weapon: ef.type, salvo, interceptors, intercepted, leakers: incoming, pk: Math.round(pk * 100) / 100, pkBand: ef.pk, softKill: tc.defenses.softKill, gnss, hits, armor: tc.defenses.armor },
    notable: killed,
  }, before);
  ch.actualKill = killed;
  if (killed) {
    destroy(ctx, target, `${ef.type} from ${shooter.callsign}`, shooter);
    if (ef.type === "ASAT" && target.orbit) {
      ctx.s.debris.push({ id: ctx.nextId("DB-"), altKm: Math.round((target.alt / 1000) * 10) / 10, incDeg: Math.round(target.orbit.i * RAD * 10) / 10, createdMs: now, risk: 0.02 });
      ctx.emit({ type: "DEBRIS", vis: ["WHITE", "BLUE", "RED"], entities: [target.id], text: `Debris field created at ${Math.round(target.alt / 1000)} km — raises collision risk for every faction in that shell`, notable: true });
    }
  }
  if (ef.type === "ASAT" || (target.domain === "SPACE" && target.faction !== "GREEN")) {
    const victim = ctx.s.factions[target.faction];
    const atk = ctx.s.factions[ch.faction];
    if (victim.escalation < atk.escalation - 1) {
      victim.escalation = atk.escalation - 1;
      ctx.emit({ type: "ESCALATION", vis: ["WHITE", "BLUE", "RED"], text: `${victim.id} escalates to rung ${victim.escalation} after attack on space assets`, notable: true });
    }
  }
  return advance(ctx, ch, true, undefined, 900_000);
}

/** Lanchester square-law land combat between formations in contact. */
export function landCombat(ctx: Ctx) {
  const tickH = ctx.s.tickMs / 3_600_000;
  const hourly = ctx.s.simMs % 3_600_000 === 0;
  const fighters = ctx.s.entities.filter((e) => !e.destroyed && (e.domain === "LAND" || e.cls === "ugv") && getClass(e.cls).combatPower > 0 && e.faction !== "GREEN");
  const power = (e: Entity) => {
    const c = getClass(e.cls);
    const terr = TERRAIN_DEFENSE[ctx.map.terrainAt(e.lat, e.lon)];
    const posture = e.posture === "ATTACK" ? 1 : e.posture === "MOVE" ? 0.8 : e.posture === "DEFEND" ? 1.2 * terr : 1.5 * terr;
    const supply = e.supplyDays > 0 ? 1 : 0.6;
    const cohesion = e.strength < 0.5 ? 0.7 : 1;
    return c.combatPower * e.strength * e.morale * supply * posture * cohesion;
  };
  const losses = new Map<string, { loss: number; enemies: Entity[]; ep: number }>();
  for (const a of fighters) {
    if (a.strength < 0.05) continue;
    const near = ctx.index.near(a.lat, a.lon, 10);
    const enemies: Entity[] = [];
    for (const b of near) {
      if (b.faction === a.faction || b.faction === "GREEN" || b.destroyed) continue;
      if (!fighters.includes(b)) continue;
      if (distKm(a.lat, a.lon, b.lat, b.lon) > 8) continue;
      // Combat starts only when some side in contact is permitted (rung >= 3) and is attacking or both are hostile at rung >= 3.
      const fa = ctx.s.factions[a.faction], fb = ctx.s.factions[b.faction];
      const attackerOk = (b.posture === "ATTACK" && fb.escalation >= 3) || (a.posture === "ATTACK" && fa.escalation >= 3) || (fa.escalation >= 3 && fb.escalation >= 3);
      if (!attackerOk) continue;
      enemies.push(b);
    }
    if (!enemies.length) continue;
    const ep = enemies.reduce((s, x) => s + power(x), 0);
    const c = getClass(a.cls);
    const noise = 0.7 + 0.6 * ctx.rng.next();
    const loss = (0.04 * ep * tickH * noise) / Math.max(10, c.combatPower);
    losses.set(a.id, { loss, enemies, ep });
  }
  for (const [id, l] of losses) {
    const a = ctx.byId.get(id)!;
    const before = a.strength;
    a.strength = Math.max(0, a.strength - l.loss);
    a.health = a.strength;
    a.morale = Math.max(0.2, a.morale - l.loss * 0.5);
    a.engagedMs = ctx.s.simMs;
    ctx.touch(a);
    if (before >= 0.5 && a.strength < 0.5) {
      ctx.emit({ type: "COHESION_LOST", vis: ctx.vis(a.faction), entities: [a.id], text: `${a.callsign} below 50% strength — cohesion lost`, notable: true });
    }
    if (hourly) {
      ctx.emit({
        type: "LAND_COMBAT", vis: ctx.vis(a.faction, l.enemies[0].faction), entities: [a.id, ...l.enemies.map((x) => x.id)],
        text: `${a.callsign} in contact with ${l.enemies.length} enemy formation(s); strength ${Math.round(a.strength * 100)}%`,
        factors: { ownPower: Math.round(power(a)), enemyPower: Math.round(l.ep), lossPerHour: Math.round((l.loss / tickH) * 1000) / 1000, terrain: ctx.map.terrainAt(a.lat, a.lon), posture: a.posture, supplyDays: Math.round(a.supplyDays * 10) / 10 },
      });
    }
    if (a.strength <= 0.05) {
      const killer = l.enemies.reduce((m, x) => (power(x) > power(m) ? x : m), l.enemies[0]);
      destroy(ctx, a, "overrun in land combat", killer);
    }
  }
}

/** Debris raises collision risk for every satellite in the same shell. Runs hourly. */
export function debrisCollisions(ctx: Ctx) {
  for (const d of ctx.s.debris) {
    for (const s of ctx.s.entities) {
      if (s.destroyed || !s.orbit) continue;
      if (Math.abs(s.alt / 1000 - d.altKm) > 60) continue;
      if (Math.abs(s.orbit.i * RAD - d.incDeg) > 20 && Math.abs(180 - s.orbit.i * RAD - d.incDeg) > 20) continue;
      if (ctx.rng.chance(d.risk)) {
        destroy(ctx, s, `collision with debris field ${d.id}`);
        ctx.emit({ type: "DEBRIS_COLLISION", vis: ["WHITE", "BLUE", "RED"], entities: [s.id], text: `${s.callsign} lost to debris in the ${Math.round(d.altKm)} km shell`, notable: true });
      }
    }
    d.risk = Math.max(0.002, d.risk * 0.98);
  }
}

export const KC_STAGES: readonly KillChainStage[] = KILL_CHAIN_STAGES;
void DEG;
