// Utility-AI fallback policies, one per role. Each scores a fixed menu of actions from COP features
// and returns an order batch with a short structured rationale (spec §3, impl. §5).
import { ESCALATION_LADDER, type CopForAgents, type Order, type OrderBatch, type Role, type UnitSummary } from "@sentinel/protocol";
import { changes, focusObjective, hostile, hoursWindow, km, nearestTrack, ownObjectives, toward, valueOf } from "./util";

export interface PolicyResult extends OrderBatch {
  coas?: { name: string; score: number; summary: string }[];
}

type Policy = (cop: CopForAgents) => PolicyResult;

const units = (cop: CopForAgents, pred: (u: UnitSummary) => boolean) => cop.units.filter(pred);
const push = (orders: Order[], u: UnitSummary, o: Omit<Order, "to">) => {
  const full = { ...o, to: u.id } as Order;
  if (changes(u, full) && orders.length < 24) orders.push(full);
};

const landPower: Record<string, number> = { armored_bde: 100, mech_inf_bde: 80, light_inf_bde: 50, artillery_bn: 40, engineer_bn: 20, ugv: 12 };

function forceRatio(cop: CopForAgents, p: [number, number], r: number) {
  const own = cop.units.filter((u) => (u.domain === "LAND" || u.cls === "ugv") && km(p, [u.lat, u.lon]) < r).reduce((s, u) => s + (landPower[u.cls] ?? 5) * u.health, 0);
  const enemy = hostile(cop).filter((t) => t.believedDomain === "LAND" && km(p, [t.lat, t.lon]) < r).reduce((s, t) => s + (t.believedClass ? landPower[t.believedClass] ?? 10 : 60), 0);
  return { own, enemy, ratio: enemy ? own / enemy : own > 0 ? 9 : 0 };
}

const nca: Policy = (cop) => {
  const held = ownObjectives(cop).filter((o) => o.holder === cop.faction).length;
  const total = ownObjectives(cop).length;
  const esc = cop.escalation;
  const options = [
    { name: "HOLD", score: 0.25 },
    {
      name: "ESCALATE",
      score: (cop.enemyEscalation > esc ? 0.45 : 0) + (held < total && cop.will > 55 && esc < 3 ? 0.35 : 0) - (esc >= 4 ? 0.6 : 0) - (cop.will < 40 ? 0.4 : 0) - (esc >= 5 ? 5 : 0),
    },
    {
      name: "DEESCALATE",
      score: (cop.will < 30 ? 0.5 : 0) + (cop.triggers.includes("ceasefire offer") && cop.will < 55 ? 0.35 : 0) - (cop.enemyEscalation > esc ? 0.4 : 0) - (esc <= 0 ? 5 : 0),
    },
  ].sort((a, b) => b.score - a.score);
  const pick = options[0];
  const orders: Order[] = [];
  if (pick.name === "ESCALATE") orders.push({ type: "ESCALATE", to: `${cop.faction.toLowerCase()}.nca` });
  if (pick.name === "DEESCALATE") orders.push({ type: "DEESCALATE", to: `${cop.faction.toLowerCase()}.nca` });
  const nextRung = esc + (pick.name === "ESCALATE" ? 1 : pick.name === "DEESCALATE" ? -1 : 0);
  orders.push({ type: "ROE", to: `${cop.faction.toLowerCase()}.jfc`, roe: nextRung >= 3 && cop.will > 45 ? "WEAPONS_FREE" : nextRung >= 1 ? "WEAPONS_TIGHT" : "WEAPONS_HOLD" });
  return {
    orders,
    rationale: `${pick.name} (utility ${pick.score.toFixed(2)}): will ${cop.will.toFixed(0)}, own rung ${esc} vs enemy ${cop.enemyEscalation}, ${held}/${total} objectives held. Rung ${nextRung}: ${ESCALATION_LADDER[Math.max(0, Math.min(6, nextRung))].allows}`,
    confidence: Math.min(0.9, 0.5 + Math.abs(pick.score - options[1].score)),
  };
};

const jfc: Policy = (cop) => {
  const land = focusObjective(cop, "LAND");
  const sea = focusObjective(cop, "SEA");
  const seaThreat = hostile(cop).filter((t) => t.believedDomain === "SEA").reduce((s, t) => s + valueOf(t), 0);
  const landThreat = hostile(cop).filter((t) => t.believedDomain === "LAND").reduce((s, t) => s + valueOf(t), 0);
  const supported = seaThreat > landThreat ? "MARITIME" : "LAND";
  const orders: Order[] = [{ type: "PRIORITY", to: `${cop.faction.toLowerCase()}.jfc`, note: `${supported} supported; focus ${supported === "MARITIME" ? sea?.name ?? "sea control" : land?.name ?? "land objectives"}` }];
  // Persistent ISR over the focus objective.
  const focus = (supported === "MARITIME" ? sea : land) ?? land ?? sea;
  if (focus) for (const u of units(cop, (x) => x.cls === "hale_isr" || x.cls === "aewc")) push(orders, u, { type: "FRAGO", task: "ISR", point: toward(cop.hq ?? focus.center, focus.center, Math.max(0, km(cop.hq ?? focus.center, focus.center) - 120)), window_sim_h: hoursWindow(cop, 10) });
  return { orders, rationale: `${supported} is the supported component: sea threat value ${seaThreat} vs land ${landThreat}. ISR assets cover ${focus?.name ?? "the theater"}.`, confidence: 0.6 };
};

const lcc: Policy = (cop) => {
  const orders: Order[] = [];
  const obj = focusObjective(cop, "LAND");
  const combat = units(cop, (u) => (u.domain === "LAND" || u.cls === "ugv") && landPower[u.cls] !== undefined && u.health >= 0.35);
  let note = "No land objective.";
  if (obj) {
    const fr = forceRatio(cop, obj.center, obj.radiusKm * 2.5);
    const attack = fr.ratio >= 1.5 && cop.escalation >= 3;
    const tgt = nearestTrack(hostile(cop), obj.center, (t) => t.believedDomain === "LAND");
    for (const u of combat) {
      if (u.cls === "artillery_bn") push(orders, u, { type: "FRAGO", task: "MOVE", point: toward(obj.center, [u.lat, u.lon], 35) });
      else if (attack && tgt) push(orders, u, { type: "FRAGO", task: "ATTACK", target: tgt.id, point: [tgt.lat, tgt.lon] });
      else push(orders, u, { type: "FRAGO", task: "DEFEND", point: toward(obj.center, [u.lat, u.lon], Math.min(obj.radiusKm * 0.5, 20)) });
    }
    note = `Force ratio at ${obj.name}: ${fr.ratio.toFixed(2)} (own ${fr.own.toFixed(0)} vs enemy ${fr.enemy.toFixed(0)}). ${attack ? "Attack" : "Defend and build combat power"}${cop.escalation < 3 ? " (rung below 3 forbids land attack)" : ""}.`;
  }
  // Convoys resupply the lowest-supplied combat unit; air defense covers the main effort.
  const needy = [...combat].sort((a, b) => a.supplyDays - b.supplyDays)[0];
  for (const c of units(cop, (u) => u.cls === "log_convoy")) if (needy && needy.supplyDays < 4) push(orders, c, { type: "FRAGO", task: "RESUPPLY", target: needy.id });
  for (const a of units(cop, (u) => u.cls === "shorad_bn")) if (obj) push(orders, a, { type: "FRAGO", task: "DEFEND", point: toward(obj.center, [a.lat, a.lon], 30) });
  return { orders, rationale: note + (needy ? ` Lowest supply: ${needy.callsign} (${needy.supplyDays} d).` : ""), confidence: 0.6 };
};

const mcc: Policy = (cop) => {
  const orders: Order[] = [];
  const obj = focusObjective(cop, "SEA") ?? focusObjective(cop);
  if (!obj) return { orders, rationale: "No maritime objective.", confidence: 0.4 };
  const home = cop.hq ?? obj.center;
  const ships = hostile(cop).filter((t) => t.believedDomain === "SEA");
  for (const u of units(cop, (x) => x.domain === "SEA" || x.cls === "usv" || x.cls === "uuv")) {
    switch (u.cls) {
      case "csg": push(orders, u, { type: "OPORD", task: "PATROL", point: toward(obj.center, home, 220) }); break;
      case "destroyer": case "frigate": case "usv": push(orders, u, { type: "OPORD", task: "PATROL", point: toward(obj.center, home, u.cls === "destroyer" ? 60 : 20) }); break;
      case "ssn": case "ssk": {
        const t = [...ships].sort((a, b) => valueOf(b) - valueOf(a))[0];
        if (t && cop.escalation >= 2 && (t.quality === "IDENTIFIED" || t.quality === "TRACKED")) push(orders, u, { type: "FRAGO", task: "STRIKE", target: t.id, point: [t.lat, t.lon] });
        else push(orders, u, { type: "OPORD", task: "PATROL", point: toward(obj.center, home, -60) });
        break;
      }
      case "oiler": {
        const fleet = cop.units.filter((x) => x.domain === "SEA" && x.cls !== "oiler");
        if (fleet.length) {
          const c: [number, number] = [fleet.reduce((s, x) => s + x.lat, 0) / fleet.length, fleet.reduce((s, x) => s + x.lon, 0) / fleet.length];
          push(orders, u, { type: "FRAGO", task: "MOVE", point: toward(c, home, 60) });
        }
        break;
      }
      case "arg": {
        const land = focusObjective(cop, "LAND");
        // Amphibious assault once the rung permits land operations and the landing area is not held by superior enemy forces.
        if (land && cop.escalation >= 3 && forceRatio(cop, land.center, land.radiusKm * 2).enemy < 120) push(orders, u, { type: "FRAGO", task: "MOVE", point: toward(land.center, home, land.radiusKm * 0.5) });
        break;
      }
      case "mcm_group": case "uuv": push(orders, u, { type: "OPORD", task: "PATROL", point: obj.center }); break;
    }
  }
  return { orders, rationale: `Sea control around ${obj.name}: ${ships.length} hostile surface/subsurface tracks; screen forward, carrier held back ${220} km.`, confidence: 0.6 };
};

const acc: Policy = (cop) => {
  const orders: Order[] = [];
  const obj = focusObjective(cop) ;
  const home = cop.hq ?? obj?.center ?? [0, 0];
  const center = obj?.center ?? home;
  const win = hoursWindow(cop, 8);
  const threats = hostile(cop);
  const strikeTargets = threats
    .filter((t) => (t.believedDomain === "SEA" && cop.escalation >= 2) || (t.believedDomain === "LAND" && cop.escalation >= 3))
    .filter((t) => t.quality === "IDENTIFIED" || t.quality === "TRACKED" || t.quality === "CLASSIFIED")
    .sort((a, b) => valueOf(b) - valueOf(a));
  const hv = cop.units.find((u) => u.cls === "csg") ?? cop.units.find((u) => u.cls === "hq");
  let s = 0;
  for (const u of units(cop, (x) => x.domain === "AIR" || (x.domain === "DRONE" && !["usv", "uuv", "ugv"].includes(x.cls)))) {
    switch (u.cls) {
      case "fighter_as": case "cca": push(orders, u, { type: "ATO", task: "CAP", point: toward(center, home, 120), window_sim_h: win }); break;
      case "fighter_mr": case "bomber": case "loitering_munition": case "male_drone": case "helo": {
        const t = strikeTargets[s % Math.max(1, strikeTargets.length)];
        if (t && km([u.lat, u.lon], [t.lat, t.lon]) < (u.cls === "bomber" ? 3000 : u.cls === "helo" ? 250 : u.cls === "loitering_munition" ? 200 : 1200)) {
          push(orders, u, { type: "ATO", task: "STRIKE", target: t.id, point: [t.lat, t.lon], window_sim_h: win });
          s++;
        } else if (u.cls === "fighter_mr") push(orders, u, { type: "ATO", task: "CAP", point: hv ? [hv.lat, hv.lon] : toward(center, home, 160), window_sim_h: win });
        else if (u.cls === "male_drone") push(orders, u, { type: "ATO", task: "ISR", point: center, window_sim_h: win });
        break;
      }
      case "aewc": case "hale_isr": push(orders, u, { type: "ATO", task: "ISR", point: toward(center, home, 150), window_sim_h: win }); break;
      case "mpa": push(orders, u, { type: "ATO", task: "ISR", point: (focusObjective(cop, "SEA") ?? obj)?.center ?? center, window_sim_h: win }); break;
      case "tanker": push(orders, u, { type: "ATO", task: "TANK", point: toward(home, center, km(home, center) / 2), window_sim_h: win }); break;
      case "quad_swarm": {
        const t = nearestTrack(threats, [u.lat, u.lon], (x) => x.believedDomain === "LAND");
        if (t && cop.escalation >= 3 && km([u.lat, u.lon], [t.lat, t.lon]) < 40) push(orders, u, { type: "FRAGO", task: "ATTACK", target: t.id, point: [t.lat, t.lon] });
        break;
      }
    }
  }
  return {
    orders,
    rationale: `ATO: CAP ${Math.round(km(center, home) > 120 ? 120 : 0)} km short of ${obj?.name ?? "the front"}; ${strikeTargets.length} strike-eligible tracks (top value ${strikeTargets[0] ? valueOf(strikeTargets[0]) : 0}); tanker track at the midpoint.`,
    confidence: 0.6,
  };
};

const scc: Policy = (cop) => {
  const orders: Order[] = [];
  const obj = focusObjective(cop);
  for (const g of units(cop, (u) => u.cls === "ground_station")) {
    if (cop.escalation >= 1 && obj) push(orders, g, { type: "STO", task: "JAM", point: obj.center });
  }
  if (cop.escalation >= 5) {
    const target = cop.enemySpace.find((x) => x.cls === "leo_imaging" || x.cls === "leo_sar");
    for (const l of units(cop, (u) => u.cls === "launch_site")) if (target) push(orders, l, { type: "STO", task: "STRIKE", target: target.id });
  }
  for (const s of units(cop, (u) => u.cls === "leo_imaging" || u.cls === "leo_sar")) if (obj) push(orders, s, { type: "STO", task: "ISR", point: obj.center });
  return {
    orders,
    rationale: `Imaging tasked on ${obj?.name ?? "theater"}; ${cop.escalation >= 1 ? "jamming enemy SATCOM downlinks" : "no counter-space at rung 0"}${cop.escalation >= 5 ? "; counter-space strike authorized" : ""}.`,
    confidence: 0.55,
  };
};

const cyber: Policy = (cop) => {
  const orders: Order[] = [];
  if (cop.escalation < 1) return { orders, rationale: "Rung 0: no EW or cyber effects authorized.", confidence: 0.8 };
  const obj = focusObjective(cop);
  for (const u of units(cop, (x) => x.cls === "ew_bn")) {
    const t = nearestTrack(hostile(cop), [u.lat, u.lon], () => true);
    const p: [number, number] = t && km([u.lat, u.lon], [t.lat, t.lon]) < 80 ? [t.lat, t.lon] : obj ? toward([u.lat, u.lon], obj.center, 60) : [u.lat, u.lon];
    push(orders, u, { type: "FRAGO", task: "JAM", point: p });
  }
  const hq = hostile(cop).find((t) => t.believedClass === "hq" || t.believedClass === "ground_station");
  for (const u of units(cop, (x) => x.cls === "cyber_unit")) push(orders, u, { type: "FRAGO", task: "CYBER", target: hq?.id });
  for (const u of units(cop, (x) => x.cls === "decoy_group")) if (obj) push(orders, u, { type: "FRAGO", task: "MOVE", point: toward(obj.center, cop.hq ?? obj.center, 40) });
  return { orders, rationale: `Jam the nearest threat axis; cyber against ${hq ? `${hq.id} (${hq.believedClass})` : "enemy C2 once located"}; decoys feint toward ${obj?.name ?? "the front"}.`, confidence: 0.55 };
};

const j2: Policy = (cop) => {
  const h = hostile(cop);
  const byDomain = ["LAND", "SEA", "AIR", "DRONE"].map((d) => `${d.toLowerCase()} ${h.filter((t) => t.believedDomain === d).length}`).join(", ");
  const top = [...h].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 3).map((t) => `${t.id} ${t.believedClass ?? t.believedDomain} (${t.quality.toLowerCase()})`);
  const conf = h.length ? h.filter((t) => t.quality === "IDENTIFIED" || t.quality === "TRACKED").length / h.length : 0;
  return { orders: [], rationale: `INTSUM: ${h.length} hostile tracks (${byDomain}). Top threats: ${top.join("; ") || "none"}. ${Math.round(conf * 100)}% identified.`, confidence: Math.max(0.2, conf) };
};

const j4: Policy = (cop) => {
  const low = cop.units.filter((u) => u.supplyDays < 2 && u.domain !== "SPACE");
  return { orders: [], rationale: `LOGSTAT: ${cop.shortfallUnits} units out of supply, ${low.length} below 2 days${low.length ? ` (${low.slice(0, 4).map((u) => u.callsign).join(", ")})` : ""}. ${low.length > 3 ? "Plans beyond current reach exceed sustainment." : "Sustainment adequate."}`, confidence: 0.7 };
};

const j5: Policy = (cop) => {
  const land = focusObjective(cop, "LAND");
  const sea = focusObjective(cop, "SEA");
  const fr = land ? forceRatio(cop, land.center, land.radiusKm * 2.5).ratio : 0;
  const seaTracks = hostile(cop).filter((t) => t.believedDomain === "SEA").length;
  const coas = [
    { name: "COA 1 — Land main effort", score: Math.min(1, fr / 2) * (cop.escalation >= 3 ? 1 : 0.4), summary: `Attack toward ${land?.name ?? "n/a"} (force ratio ${fr.toFixed(2)}).` },
    { name: "COA 2 — Maritime main effort", score: (sea ? 0.5 : 0.1) + Math.min(0.4, seaTracks / 20), summary: `Win sea control at ${sea?.name ?? "n/a"} first (${seaTracks} hostile ships tracked).` },
    { name: "COA 3 — Defend and attrit", score: 0.35 + (cop.will < 50 ? 0.2 : 0), summary: "Hold objectives, attrit with fires and drones, preserve will." },
  ].sort((a, b) => b.score - a.score);
  return { orders: [{ type: "PRIORITY", to: `${cop.faction.toLowerCase()}.jfc`, note: coas[0].name }], rationale: `Recommend ${coas[0].name}: ${coas[0].summary}`, confidence: Math.min(0.9, coas[0].score), coas: coas.map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 })) };
};

const j6: Policy = (cop) => {
  const pct = cop.units.length ? Math.round((cop.unreachable.length / cop.units.length) * 100) : 0;
  return { orders: [], rationale: `Network: mean order latency ${Math.round(cop.meanLatencyMs / 60000)} min; ${cop.unreachable.length} units unreachable (${pct}%)${cop.unreachable.length ? `: ${cop.unreachable.slice(0, 4).join(", ")}` : ""}.`, confidence: 0.8 };
};

export const POLICIES: Record<Role, Policy> = { nca, jfc, lcc, mcc, acc, scc, cyber, j2, j4, j5, j6 };

export function rulePolicy(role: Role, cop: CopForAgents): PolicyResult {
  const r = POLICIES[role](cop);
  return { ...r, rationale: r.rationale.slice(0, 590), orders: r.orders.slice(0, 24) };
}
