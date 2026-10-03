// Sustainment: units consume supply by activity; depots push supply along road, sea and air lines of
// communication; enemy forces near a route interdict it (spec §6 logistics).
import type { Faction } from "@sentinel/protocol";
import { getClass } from "@sentinel/catalog";
import type { Ctx } from "./ctx";
import { distKm, distToSegmentKm } from "./geo";
import { isAir } from "./tactical";
import { movesOn } from "./init";
import type { Entity, SupplyFlow } from "./types";

/** Per-tick consumption. */
export function consume(ctx: Ctx) {
  const days = ctx.s.tickMs / 86_400_000;
  for (const e of ctx.s.entities) {
    if (e.destroyed || e.domain === "SPACE" || e.faction === "GREEN") continue;
    const c = getClass(e.cls);
    if (c.tags.includes("HQ")) continue; // HQs are the rear depot
    let rate = 1;
    if (e.engagedMs !== undefined && ctx.s.simMs - e.engagedMs < 3_600_000) rate = 3;
    else if (e.posture === "MOVE" || e.sortie === "AIRBORNE") rate = 1.5;
    else if (e.sortie === "READY" || e.sortie === "REARMING") rate = 0.5;
    if (c.tags.includes("DEPOT")) rate *= 0.3;
    const before = e.supplyDays;
    e.supplyDays = Math.max(0, e.supplyDays - days * rate);
    if (before > 0 && e.supplyDays === 0) {
      ctx.emit({ type: "SUPPLY_EXHAUSTED", vis: ctx.vis(e.faction), entities: [e.id], text: `${e.callsign} is out of supply — speed, sortie rate and Pk degrade`, notable: c.combatPower >= 40 });
      ctx.s.factions[e.faction].triggers.push(`${e.callsign} out of supply`);
    }
  }
}

function interdicted(ctx: Ctx, f: Faction, a: Entity, b: Entity): boolean {
  for (const x of ctx.s.entities) {
    if (x.faction === f || x.faction === "GREEN" || x.destroyed || x.domain === "SPACE") continue;
    const c = getClass(x.cls);
    if (!c.effectors.length || (isAir(x) && x.sortie !== "AIRBORNE")) continue;
    if (Math.abs(x.lat - a.lat) > 6 && Math.abs(x.lat - b.lat) > 6) continue;
    if (distToSegmentKm(x.lat, x.lon, a.lat, a.lon, b.lat, b.lon) < 25) return true;
  }
  return false;
}

/** Hourly supply distribution. Returns flows for the Logistics Console Sankey. */
export function distribute(ctx: Ctx) {
  for (const f of ["BLUE", "RED"] as const) {
    const fs = ctx.s.factions[f];
    const flows: SupplyFlow[] = [];
    const own = ctx.s.entities.filter((e) => e.faction === f && !e.destroyed && e.domain !== "SPACE");
    const depots = own.filter((e) => getClass(e.cls).tags.includes("DEPOT"));
    const airbases = own.filter((e) => e.home && !e.home.carrier);
    let shortfall = 0;
    for (const u of own) {
      const c = getClass(u.cls);
      if (c.tags.includes("HQ")) continue;
      if (u.supplyDays === 0) shortfall++;
      if (u.supplyDays >= 8) continue;
      const medium = movesOn(u);
      let source: Entity | null = null;
      let kind: SupplyFlow["kind"] = "ROAD";
      let reach = 0;
      if (isAir(u)) {
        if (u.sortie === "AIRBORNE") continue;
        // Aircraft draw from their base; carriers supply their own air wing.
        const cv = u.home?.carrier ? ctx.byId.get(u.home.carrier) : null;
        source = cv && !cv.destroyed ? cv : depots.find((d) => d.cls === "hq") ?? null;
        kind = cv ? "SEA" : "AIR";
        reach = 1e9;
      } else if (medium === "SEA") {
        kind = "SEA";
        reach = 150;
        source = nearest(u, depots.filter((d) => d.cls === "oiler" || (d.cls === "hq" && !ctx.map.isLand(u.lat, u.lon) && distKm(u.lat, u.lon, d.lat, d.lon) < 80)));
      } else {
        kind = "ROAD";
        reach = 250;
        source = nearest(u, depots.filter((d) => d.domain === "LAND" && d.landmass === u.landmass && d.id !== u.id));
        if (!source && airbases.length) {
          kind = "AIR";
          const lifter = own.find((x) => x.cls === "airlifter" && x.sortie !== "REARMING");
          if (lifter) { source = lifter; reach = 1e9; }
        }
      }
      if (!source || source === u) continue;
      const d = distKm(u.lat, u.lon, source.lat, source.lon);
      if (d > reach) continue;
      const cut = kind !== "AIR" && interdicted(ctx, f, source, u);
      const amount = cut ? 0 : Math.min(8 - u.supplyDays, kind === "AIR" ? 0.5 : kind === "SEA" ? 2 : 1.5);
      if (amount > 0 && source.cls !== "hq") {
        // Forward depots spend their own stock; HQs are fed from the rear indefinitely.
        if (source.supplyDays < 1) continue;
        source.supplyDays = Math.max(0, source.supplyDays - amount * 0.25);
        ctx.touch(source);
      }
      if (amount > 0) {
        u.supplyDays = Math.round((u.supplyDays + amount) * 1000) / 1000;
        ctx.touch(u);
      }
      flows.push({ from: source.id, to: u.id, kind, amount: Math.round(amount * 100) / 100, interdicted: cut });
    }
    // Forward depots (convoys, oilers) are refilled from the HQ if in reach and uninterdicted.
    const hq = own.find((e) => e.cls === "hq");
    if (hq) {
      for (const d of depots) {
        if (d === hq || d.supplyDays >= 30) continue;
        const sea = d.cls === "oiler";
        if (!sea && d.landmass !== hq.landmass) continue;
        if (distKm(d.lat, d.lon, hq.lat, hq.lon) > (sea ? 900 : 400)) continue;
        const cut = interdicted(ctx, f, hq, d);
        const amount = cut ? 0 : sea ? 3 : 4;
        d.supplyDays += amount;
        flows.push({ from: hq.id, to: d.id, kind: sea ? "SEA" : "ROAD", amount, interdicted: cut });
      }
    }
    fs.flows = flows;
    fs.shortfallHours += shortfall;
    ctx.s.metrics.supplyShortfallHours += shortfall;
    const cutCount = flows.filter((x) => x.interdicted).length;
    if (cutCount > 0) fs.triggers.push(`${cutCount} supply routes interdicted`);
  }
  ctx.logisticsDirty = true;
}

function nearest(u: Entity, list: Entity[]): Entity | null {
  let best: Entity | null = null;
  let bd = Infinity;
  for (const d of list) {
    const dd = distKm(u.lat, u.lon, d.lat, d.lon);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}
