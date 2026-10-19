// Commander's plays: a short menu of strategic actions a human commander can take in one step.
// Each play turns into an ordinary order batch from the commander's seat, so it travels the C2
// network and is validated by applyOrderBatch exactly like any agent or hand-written order.
import type { CopForAgents, ObjectiveView, Order, TrackView, UnitSummary } from "@sentinel/protocol";
import { hostile, hoursWindow, km, ownObjectives, toward, valueOf } from "./util";

export const PLAY_IDS = ["ISR_SURGE", "AIR_COVER", "REINFORCE", "SEA_CONTROL", "ASSAULT", "STRIKE_TOP", "JAM", "RESUPPLY", "PULL_BACK"] as const;
export type PlayId = (typeof PLAY_IDS)[number];

export type PlayCategory = "intel" | "air" | "land" | "sea" | "strike" | "cyber" | "logistics";

export interface PlayInfo {
  id: PlayId;
  title: string;
  /** One plain-language sentence: what the staff will do. */
  summary: string;
  /** What it costs or risks, so the trade-off is visible before the click. */
  tradeoff: string;
  category: PlayCategory;
  /** The play is aimed at one of your objectives (defaults to the main effort). */
  needsObjective: boolean;
}

export const PLAYS: Record<PlayId, PlayInfo> = {
  ISR_SURGE: {
    id: "ISR_SURGE", title: "Surge surveillance", category: "intel", needsObjective: true,
    summary: "Send drones, patrol aircraft, early-warning aircraft and satellites to watch the objective.",
    tradeoff: "Better, fresher enemy tracks there; other areas go unwatched for about 8 hours.",
  },
  AIR_COVER: {
    id: "AIR_COVER", title: "Air cover", category: "air", needsObjective: true,
    summary: "Put fighter patrols over the objective to shoot down enemy aircraft and drones.",
    tradeoff: "Protects forces below; burns fuel and needs tankers to stay on station.",
  },
  REINFORCE: {
    id: "REINFORCE", title: "Reinforce", category: "land", needsObjective: true,
    summary: "Move nearby ground forces and air defenses to defend the objective.",
    tradeoff: "Strengthens the defense; other sectors thin out. Ground units cannot cross water.",
  },
  SEA_CONTROL: {
    id: "SEA_CONTROL", title: "Push the fleet", category: "sea", needsObjective: true,
    summary: "Move surface ships to patrol the objective and send submarines after enemy ships.",
    tradeoff: "Contests the sea; ships inside enemy missile range will take losses.",
  },
  ASSAULT: {
    id: "ASSAULT", title: "Assault", category: "land", needsObjective: true,
    summary: "Attack enemy ground forces at the objective and land amphibious forces.",
    tradeoff: "The only way to take ground; attackers lose more than defenders. Needs escalation rung 3.",
  },
  STRIKE_TOP: {
    id: "STRIKE_TOP", title: "Strike top threat", category: "strike", needsObjective: false,
    summary: "Aim aircraft, drones, submarines and missiles at the most valuable enemy target you have identified.",
    tradeoff: "Can remove a key threat; uses scarce munitions, and a stale track means wasted shots.",
  },
  JAM: {
    id: "JAM", title: "Jam and hack", category: "cyber", needsObjective: true,
    summary: "Jam enemy radars and datalinks near the objective; cyber teams go after enemy command posts.",
    tradeoff: "Blinds and slows the enemy; jammers give away their own position.",
  },
  RESUPPLY: {
    id: "RESUPPLY", title: "Resupply", category: "logistics", needsObjective: false,
    summary: "Send convoys to the units lowest on supply and move oilers toward the fleet.",
    tradeoff: "Restores speed and firepower; convoys and oilers are soft targets.",
  },
  PULL_BACK: {
    id: "PULL_BACK", title: "Pull back damaged units", category: "logistics", needsObjective: false,
    summary: "Withdraw badly damaged units so they survive to recover.",
    tradeoff: "Saves units and national will; gives ground for now.",
  },
};

export interface PlayResult {
  ok: boolean;
  orders: Order[];
  rationale: string;
  /** Why nothing could be ordered (when ok is false). */
  reason?: string;
  units: string[];
}

const ISR = ["hale_isr", "male_drone", "mpa", "aewc", "uuv"];
const SATS = ["leo_imaging", "leo_sar"];
const FIGHTERS = ["fighter_as", "fighter_mr", "cca"];
const GROUND_COMBAT = ["armored_bde", "mech_inf_bde", "light_inf_bde", "ugv", "engineer_bn"];
const SURFACE = ["destroyer", "frigate", "usv", "csg", "mcm_group"];
const SUBS = ["ssn", "ssk"];
/** Rough reach (km) of each shooter against a target domain, for picking who can strike. */
const STRIKE_REACH: Record<string, Partial<Record<"LAND" | "SEA", number>>> = {
  bomber: { LAND: 3000, SEA: 3000 }, fighter_mr: { LAND: 1200, SEA: 1200 }, male_drone: { LAND: 900, SEA: 900 }, helo: { LAND: 250, SEA: 250 },
  loitering_munition: { LAND: 200, SEA: 200 }, destroyer: { LAND: 1500, SEA: 400 }, frigate: { SEA: 400 }, ssn: { LAND: 1500, SEA: 120 },
  ssk: { SEA: 200 }, artillery_bn: { LAND: 280 }, coastal_ashm: { SEA: 400 }, mpa: { SEA: 600 }, csg: { SEA: 400 },
};

const at = (u: UnitSummary): [number, number] => [u.lat, u.lon];
const free = (cop: CopForAgents, pred: (u: UnitSummary) => boolean) => cop.units.filter((u) => pred(u) && u.comms !== "CUT");

function objectiveFor(cop: CopForAgents, id?: string): ObjectiveView | undefined {
  const own = ownObjectives(cop);
  return own.find((o) => o.id === id) ?? own.find((o) => o.id === cop.mainEffort) ?? own[0];
}

function result(orders: Order[], rationale: string, reason: string): PlayResult {
  const units = [...new Set(orders.map((o) => o.to))];
  return orders.length ? { ok: true, orders: orders.slice(0, 24), rationale, units } : { ok: false, orders: [], rationale, reason, units: [] };
}

/** Builds the order batch for a play from the faction's own picture. STRIKE_TOP takes an optional track to strike. */
export function buildPlay(id: PlayId, cop: CopForAgents, objectiveId?: string, targetId?: string): PlayResult {
  const obj = objectiveFor(cop, objectiveId);
  const home = cop.hq ?? obj?.center ?? [0, 0];
  const win = hoursWindow(cop, 8);
  const orders: Order[] = [];
  const name = obj?.name ?? "the theater";
  switch (id) {
    case "ISR_SURGE": {
      if (!obj) return result([], "", "You have no objective to watch.");
      for (const u of free(cop, (x) => ISR.includes(x.cls))) orders.push({ type: u.domain === "AIR" || u.domain === "DRONE" ? "ATO" : "FRAGO", to: u.id, task: "ISR", point: obj.center, window_sim_h: win });
      for (const u of free(cop, (x) => SATS.includes(x.cls))) orders.push({ type: "STO", to: u.id, task: "ISR", point: obj.center });
      return result(orders, `Surge ISR over ${name} for 8 hours.`, "No surveillance assets are available or reachable.");
    }
    case "AIR_COVER": {
      if (!obj) return result([], "", "You have no objective to cover.");
      for (const u of free(cop, (x) => FIGHTERS.includes(x.cls))) orders.push({ type: "ATO", to: u.id, task: "CAP", point: obj.center, window_sim_h: win });
      for (const u of free(cop, (x) => x.cls === "tanker")) orders.push({ type: "ATO", to: u.id, task: "TANK", point: toward(home, obj.center, km(home, obj.center) / 2), window_sim_h: win });
      return result(orders, `Combat air patrol over ${name}, tanker track halfway.`, "No fighters are available or reachable.");
    }
    case "REINFORCE": {
      if (!obj) return result([], "", "You have no objective to reinforce.");
      const reach = obj.radiusKm + 150;
      for (const u of free(cop, (x) => (GROUND_COMBAT.includes(x.cls) || x.cls === "shorad_bn" || x.cls === "lrad_bn") && km(at(x), obj.center) < reach && x.health >= 0.35)) {
        orders.push({ type: "FRAGO", to: u.id, task: "DEFEND", point: toward(obj.center, at(u), Math.min(obj.radiusKm * 0.5, 20)) });
      }
      if (obj.domain !== "LAND") for (const u of free(cop, (x) => SURFACE.includes(x.cls) && x.cls !== "csg")) orders.push({ type: "OPORD", to: u.id, task: "PATROL", point: toward(obj.center, home, 15) });
      return result(orders, `Reinforce ${name}: nearby forces move to defend it.`, `No ground forces are close enough to reach ${name} by land.`);
    }
    case "SEA_CONTROL": {
      if (!obj) return result([], "", "You have no objective to contest.");
      for (const u of free(cop, (x) => SURFACE.includes(x.cls))) orders.push({ type: "OPORD", to: u.id, task: "PATROL", point: toward(obj.center, home, u.cls === "csg" ? 120 : 10) });
      const ships = hostile(cop).filter((t) => t.believedDomain === "SEA" && t.quality !== "DETECTED");
      for (const u of free(cop, (x) => SUBS.includes(x.cls))) {
        const t = nearest(ships, obj.center);
        if (t && cop.escalation >= 2) orders.push({ type: "FRAGO", to: u.id, task: "STRIKE", target: t.id, point: [t.lat, t.lon] });
        else orders.push({ type: "OPORD", to: u.id, task: "PATROL", point: obj.center });
      }
      return result(orders, `Push the fleet to ${name}; submarines hunt enemy ships.`, "No ships are available.");
    }
    case "ASSAULT": {
      if (!obj) return result([], "", "You have no objective to assault.");
      if (cop.escalation < 3) return result([], "", `Escalation rung ${cop.escalation} does not allow attacks on ground forces. Rung 3 is needed.`);
      const enemy = hostile(cop).filter((t) => t.believedDomain === "LAND" && km([t.lat, t.lon], obj.center) < obj.radiusKm * 2);
      const reach = obj.radiusKm + 200;
      for (const u of free(cop, (x) => GROUND_COMBAT.includes(x.cls) && km(at(x), obj.center) < reach && x.health >= 0.5)) {
        const t = nearest(enemy, at(u));
        orders.push(t ? { type: "FRAGO", to: u.id, task: "ATTACK", target: t.id, point: [t.lat, t.lon] } : { type: "FRAGO", to: u.id, task: "MOVE", point: obj.center });
      }
      for (const u of free(cop, (x) => x.cls === "artillery_bn")) orders.push({ type: "FRAGO", to: u.id, task: "MOVE", point: toward(obj.center, at(u), 35) });
      for (const u of free(cop, (x) => x.cls === "arg")) orders.push({ type: "FRAGO", to: u.id, task: "MOVE", point: toward(obj.center, home, obj.radiusKm * 0.5) });
      return result(orders, `Assault ${name}${enemy.length ? ` against ${enemy.length} known enemy formations` : ""}.`, `No ground or amphibious forces can reach ${name}.`);
    }
    case "STRIKE_TOP": {
      const eligible = hostile(cop)
        .filter((t) => !targetId || t.id === targetId)
        .filter((t) => t.quality === "IDENTIFIED" || t.quality === "TRACKED")
        .filter((t) => (t.believedDomain === "SEA" && cop.escalation >= 2) || (t.believedDomain === "LAND" && cop.escalation >= 3))
        .sort((a, b) => valueOf(b) - valueOf(a));
      const t = eligible[0];
      if (!t) {
        const pool = hostile(cop).filter((x) => !targetId || x.id === targetId);
        const any = pool.some((x) => x.quality === "IDENTIFIED" || x.quality === "TRACKED");
        if (targetId && pool.length && !any) return result([], "", "That contact is not identified well enough to strike. Keep sensors on it first.");
        if (targetId && any && pool[0].believedDomain !== "SEA" && pool[0].believedDomain !== "LAND") return result([], "", "Aircraft and drones are engaged by fighters and air defenses automatically; order air cover instead.");
        return result([], "", any ? `No identified target is allowed at escalation rung ${cop.escalation} (sea targets need rung 2, land targets rung 3).` : "No enemy target is identified well enough to strike. Surge surveillance first.");
      }
      const dom = t.believedDomain as "LAND" | "SEA";
      const shooters = free(cop, (x) => (STRIKE_REACH[x.cls]?.[dom] ?? 0) > km(at(x), [t.lat, t.lon]))
        .sort((a, b) => km(at(a), [t.lat, t.lon]) - km(at(b), [t.lat, t.lon]))
        .slice(0, 4);
      for (const u of shooters) orders.push({ type: u.domain === "AIR" || u.domain === "DRONE" ? "ATO" : "FRAGO", to: u.id, task: "STRIKE", target: t.id, point: [t.lat, t.lon], ...(u.domain === "AIR" || u.domain === "DRONE" ? { window_sim_h: hoursWindow(cop, 6) } : {}) });
      return result(orders, `Strike ${t.id} (${t.believedClass ?? t.believedDomain.toLowerCase()}), the top identified threat.`, `Nothing in range can reach ${t.id}.`);
    }
    case "JAM": {
      if (cop.escalation < 1) return result([], "", "Escalation rung 0 does not allow jamming or cyber attacks.");
      const p = obj?.center ?? home;
      for (const u of free(cop, (x) => x.cls === "ew_bn")) orders.push({ type: "FRAGO", to: u.id, task: "JAM", point: toward(at(u), p, 60) });
      for (const u of free(cop, (x) => x.cls === "ground_station")) orders.push({ type: "STO", to: u.id, task: "JAM", point: p });
      const c2 = hostile(cop).find((x) => x.believedClass === "hq" || x.believedClass === "ground_station");
      for (const u of free(cop, (x) => x.cls === "cyber_unit")) if (c2) orders.push({ type: "FRAGO", to: u.id, task: "CYBER", target: c2.id });
      return result(orders, `Jam enemy sensors and links near ${name}${c2 ? `; cyber attack on ${c2.id}` : ""}.`, "No jammers or cyber units are available.");
    }
    case "RESUPPLY": {
      const needy = cop.units.filter((u) => u.domain === "LAND" && u.cls !== "log_convoy" && u.cls !== "hq").sort((a, b) => a.supplyDays - b.supplyDays);
      const convoys = free(cop, (x) => x.cls === "log_convoy");
      convoys.forEach((c, i) => {
        const n = needy[i % Math.max(1, needy.length)];
        if (n) orders.push({ type: "FRAGO", to: c.id, task: "RESUPPLY", target: n.id });
      });
      const fleet = cop.units.filter((x) => x.domain === "SEA" && x.cls !== "oiler");
      if (fleet.length) {
        const c: [number, number] = [fleet.reduce((s, x) => s + x.lat, 0) / fleet.length, fleet.reduce((s, x) => s + x.lon, 0) / fleet.length];
        for (const o of free(cop, (x) => x.cls === "oiler")) orders.push({ type: "FRAGO", to: o.id, task: "MOVE", point: toward(c, home, 40) });
      }
      return result(orders, `Resupply: convoys to ${needy.slice(0, 3).map((u) => u.callsign).join(", ") || "the front"}; oilers close on the fleet.`, "No convoys or oilers are available.");
    }
    case "PULL_BACK": {
      for (const u of free(cop, (x) => x.health < 0.5 && x.domain !== "SPACE" && x.cls !== "hq")) {
        if (u.domain === "LAND") orders.push({ type: "FRAGO", to: u.id, task: "WITHDRAW", point: toward(at(u), home, 60) });
        else if (u.domain === "AIR" || u.domain === "DRONE") orders.push({ type: "FRAGO", to: u.id, task: "RTB" });
        else orders.push({ type: "FRAGO", to: u.id, task: "MOVE", point: toward(at(u), home, 120) });
      }
      return result(orders, "Pull back units below half strength so they can recover.", "No units are below half strength.");
    }
  }
}

function nearest(tracks: TrackView[], p: [number, number]): TrackView | undefined {
  let best: TrackView | undefined;
  let bd = Infinity;
  for (const t of tracks) {
    const d = km(p, [t.lat, t.lon]);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}
