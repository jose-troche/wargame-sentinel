// "Ask your staff": answers plain-language questions and turns spoken or typed commands into actions.
// It runs locally on the commander's own picture (no server, no ground truth). Commands that change
// the game are returned as a proposed action the player confirms; time controls and map moves apply
// at once.
import { ESCALATION_LADDER, type EntityView, type Posture, type Scenario, type TrackView } from "@sentinel/protocol";
import { getClass, hasClass } from "@sentinel/catalog";
import { PLAYS, buildPlay, valueOf, type PlayId } from "@sentinel/agents-rules";
import { copFromView, type ViewState } from "./cop";
import { findPlace, km, placeName, where } from "./places";
import { POSTURE_INFO } from "./levels";
import type { Action, Brief, DecisionCard, Drill, Severity, Side } from "./types";

export interface AskContext extends ViewState {
  side: Side;
  scenario: Scenario;
  brief: Brief | null;
  cards: DecisionCard[];
  unreachable: string[];
}

export interface Reply {
  text: string;
  bullets?: string[];
  tone?: Severity;
  /** Move the map here. */
  focus?: { center: [number, number]; zoom?: number };
  select?: string;
  /** A game-changing command, applied only when the player confirms. */
  action?: { label: string; action: Action };
  /** Applied at once. */
  control?: "pause" | "play" | "faster" | "slower";
  drill?: Drill;
}

export const SUGGESTIONS = [
  "How are we doing?",
  "What should I do?",
  "Where is the enemy fleet?",
  "Biggest threat?",
  "Who is low on supply?",
  "What is escalation?",
];

const GLOSSARY: [RegExp, string, string][] = [
  [/escalat|rung|ladder/, "Escalation ladder", "A 0–6 scale of how far the conflict has gone. Each rung unlocks more targets: 2 allows fighting at sea and in the air, 3 ground forces, 4 logistics and command posts, 5 space and homeland. Climbing costs national will and provokes the enemy. Rung 6 ends the game in catastrophe."],
  [/\broe\b|rules of engagement|weapons (free|tight|hold)/, "Rules of engagement", "When forces may fire. Weapons free: at any classified hostile. Weapons tight: only at identified hostiles. Weapons hold: only in self-defense. Your posture sets it for you."],
  [/posture/, "Posture", "How much risk your staff accept. Aggressive attacks at modest odds and pushes forward; balanced attacks with a clear edge; defensive holds ground and only strikes threats near your objectives."],
  [/main effort|intent/, "Commander's intent", "Your main effort and posture. The staff concentrate surveillance, ships and aircraft on the main effort and plan within the posture at their next cycle."],
  [/objective/, "Objectives", "Places each side must control, deny or clear. An objective counts as held when your combat power there clearly exceeds the enemy's. Each held hour earns victory points and national will."],
  [/victory point|score/, "Victory points", "Hours each objective was held times its weight, plus national will. If neither side breaks, the higher score wins when time runs out."],
  [/\bwill\b|morale|public support/, "National will", "Public support for the war, 0–100. Losses and civilian harm lower it; held objectives and enemy losses raise it. A side at zero seeks terms and loses."],
  [/fog of war|fog/, "Fog of war", "You see only what your sensors report. Enemy forces appear as contacts that may be wrong, late or fake (decoys)."],
  [/track|contact|identified|classified|detected/, "Contacts and tracks", "Sensor reports of possible enemies. They improve from detected to classified, identified and tracked as sensors keep watching, and fade when contact is lost. Only identified contacts can be struck."],
  [/\bisr\b|surveillance|recon/, "ISR", "Intelligence, surveillance and reconnaissance: drones, patrol aircraft, early-warning aircraft and satellites that find the enemy."],
  [/kill chain|f2t2ea/, "Kill chain", "The steps of a strike: find, fix, track, target, engage, assess. If any step fails (a stale track, a slow order, an empty magazine) the strike is called off."],
  [/\bc2\b|command and control|network|latency/, "Command and control", "How orders reach units: radio, satellite and datalinks. Jamming, cyber attacks and lost relays delay orders or cut units off; cut-off units keep their last order."],
  [/jam|electronic warfare|\bew\b/, "Electronic warfare", "Jamming blinds radars and slows datalinks inside a zone. Jammers also reveal where they are."],
  [/cyber/, "Cyber", "Attacks on command posts and ground stations that delay, deny or deceive. Each attempt risks exposing the attacker."],
  [/supply|logistic|fuel|munition/, "Supply", "Fuel, munitions and spares. Units consume supply by activity; at zero they move slower, fly fewer sorties and hit less. Convoys and oilers resupply them."],
  [/a2\/?ad|anti-access|area denial/, "A2/AD", "Anti-access/area denial: layers of missiles, air defenses and sensors that make an area costly to enter."],
  [/\bcap\b|combat air patrol/, "Combat air patrol", "Fighters orbiting an area to intercept enemy aircraft and drones."],
  [/civilian/, "Civilian harm", "Strikes near cities or neutral shipping harm civilians. It is never rewarded: it costs national will and is reported in the review."],
  [/held|direct order/, "Direct orders", "Units you order yourself follow that order for at least 12 hours; your AI staff will not re-task them until then."],
  [/satellite|space|orbit/, "Space", "Satellites see the battlefield only when passing overhead, relay communications and warn of missile launches. Destroying one creates debris that threatens everyone."],
];

const CLASS_WORDS: [RegExp, (e: { cls: string; domain: string }) => boolean, string][] = [
  [/carrier/, (e) => e.cls === "csg", "carrier groups"],
  [/destroyer/, (e) => e.cls === "destroyer", "destroyers"],
  [/frigate/, (e) => e.cls === "frigate", "frigates"],
  [/submarine|\bsubs?\b/, (e) => e.cls === "ssn" || e.cls === "ssk", "submarines"],
  [/amphib/, (e) => e.cls === "arg", "amphibious groups"],
  [/fighter|jets?\b/, (e) => ["fighter_as", "fighter_mr", "cca"].includes(e.cls), "fighters"],
  [/bomber/, (e) => e.cls === "bomber", "bombers"],
  [/drone|uav|swarm/, (e) => e.domain === "DRONE", "drones"],
  [/tank|armou?r/, (e) => e.cls === "armored_bde", "armored brigades"],
  [/infantry|troops|soldiers/, (e) => ["mech_inf_bde", "light_inf_bde"].includes(e.cls), "infantry"],
  [/artillery|rocket/, (e) => e.cls === "artillery_bn", "artillery"],
  [/air defen[cs]e|sam\b/, (e) => e.cls === "shorad_bn" || e.cls === "lrad_bn", "air defenses"],
  [/convoy|truck/, (e) => e.cls === "log_convoy", "convoys"],
  [/oiler|tanker ship/, (e) => e.cls === "oiler", "oilers"],
  [/satellite/, (e) => e.domain === "SPACE", "satellites"],
  [/fleet|navy|ships?\b|naval/, (e) => e.domain === "SEA", "ships"],
  [/army|ground forces|land forces|ground units/, (e) => e.domain === "LAND", "ground forces"],
  [/aircraft|planes?\b|air force|air\b/, (e) => e.domain === "AIR", "aircraft"],
];

const QUESTION = /^(what|where|how|who|when|why|which|is|are|do|does|can|could|should|any|tell me|show me what)\b/;

const clsLabel = (cls?: string) => (cls && hasClass(cls) ? getClass(cls).name.toLowerCase() : "unknown contact");
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

function centroid(pts: [number, number][]): [number, number] | undefined {
  if (!pts.length) return undefined;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/** Groups points by the place they are nearest to: "3 near Meridian Strait, 1 at Velmora". */
function groupByPlace(scn: Scenario, pts: { p: [number, number]; label: string }[]): string[] {
  const groups = new Map<string, string[]>();
  for (const x of pts) {
    const w = where(scn, x.p) || "in the theater";
    const g = groups.get(w) ?? [];
    g.push(x.label);
    groups.set(w, g);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5).map(([w, labels]) => `${summarize(labels)} ${w}`);
}

function summarize(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()].map(([l, c]) => (c > 1 ? `${c} ${l}s` : `1 ${l}`)).join(", ");
}

export function answer(raw: string, ctx: AskContext): Reply {
  const q = raw.toLowerCase().replace(/[!?.,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return { text: "Ask me anything about the situation, or give an order." };
  const question = QUESTION.test(q);
  const scn = ctx.scenario;
  const own = [...ctx.entities.values()].filter((e) => e.faction === ctx.side && !e.destroyed);
  const hostile = ctx.tracks.filter((t) => t.owner === ctx.side && t.affiliation === "HOSTILE");
  const cop = copFromView(ctx.side, ctx);
  const brief = ctx.brief;

  // ---- time controls (immediate)
  // Short words like "go" or "stop" count as time controls only on their own ("go defensive" is an order).
  if (/^(pause|freeze|hold on|wait)\b|^stop( (the )?(clock|time|game))?$/.test(q)) return { text: "Paused. Take your time.", control: "pause" };
  if (/^(resume|unpause|continue|play)( (the )?game)?$|^(go|start)( now)?$/.test(q)) return { text: "Resuming.", control: "play" };
  if (/\b(faster|speed up|hurry)\b/.test(q)) return { text: "Speeding up.", control: "faster" };
  if (/\b(slower|slow down)\b/.test(q)) return { text: "Slowing down.", control: "slower" };

  if (/^(help|commands)\b|what can (i|you) (ask|say|do)/.test(q)) {
    return {
      text: "Ask about the situation, or give orders in plain words.",
      bullets: [
        "Questions: “how are we doing?”, “where is the enemy fleet?”, “biggest threat?”, “who is low on supply?”, “what is a kill chain?”",
        "Orders: “strike the top threat”, “surge surveillance over the strait”, “reinforce the island”, “go defensive”, “focus on the strait”, “escalate”",
        "Map: “show me Meridian Island”, “where is VALIANT-1?”",
        "Time: “pause”, “resume”, “faster”, “slower”",
      ],
    };
  }

  // ---- glossary
  const def = q.match(/^(what is|what's|whats|what are|define|explain|meaning of|what does)\s+(an? |the )?(.+?)( mean)?$/);
  if (def) {
    const term = def[3];
    const g = GLOSSARY.find(([re]) => re.test(term));
    if (g) return { text: `${g[1]}: ${g[2]}` };
  }

  // ---- commands (imperative)
  if (!question) {
    const cmd = command(q, ctx, cop);
    if (cmd) return cmd;
  }

  // ---- recommendations
  if (/(what should (i|we) do|recommend|advice|advise|suggest|next step|what now|what do you think)/.test(q)) return recommend(ctx, cop);

  // ---- situation
  if (/(status|sitrep|situation|how (are|is) (we|it|things|the war)|are we winning|who('s| is) winning|overview|summary|brief me|update)/.test(q) && brief) {
    const top = brief.alerts.filter((a) => a.severity === "critical" || a.severity === "warning").slice(0, 3).map((a) => a.title);
    return {
      text: brief.headline, tone: brief.tone,
      bullets: [
        `Victory points: us ${brief.score.own}, enemy about ${brief.score.enemy}. ${Math.round(brief.score.hoursLeft)} hours left.`,
        ...brief.objectives.filter((o) => o.mine).map((o) => `${o.place}: ${o.stateText.toLowerCase()}.`),
        ...top.map((t) => `${t}.`),
      ],
    };
  }

  if (/(objective|mission|goal|how (do|can) (i|we) win|what (do|must) (i|we) (need to )?(do|achieve|hold))/.test(q) && brief) {
    const mine = brief.objectives.filter((o) => o.mine);
    const theirs = brief.objectives.filter((o) => !o.mine);
    return {
      text: `Hold your objectives, break the enemy's will, and avoid catastrophe.`,
      bullets: [
        ...mine.map((o, i) => `${i + 1}. ${o.name}${o.weight > 1 ? " (most important)" : ""}: ${o.stateText.toLowerCase()}.`),
        `The enemy wants to: ${theirs.map((o) => o.name.toLowerCase()).join("; ") || "unknown"}.`,
        "You win if the enemy's national will reaches zero, or if you lead on victory points when time runs out.",
      ],
      focus: mine[0] ? { center: mine[0].center } : undefined,
    };
  }

  if (/(score|points)/.test(q) && brief) return { text: `Victory points: us ${brief.score.own}, enemy about ${brief.score.enemy}. They grow with each hour an objective is held, plus national will.` };
  if (/(time left|how long|how much time|when does (it|the game) end)/.test(q) && brief) return { text: `${Math.round(brief.score.hoursLeft)} simulated hours left of ${brief.score.durationH}.` };

  // ---- threats
  if (/(threat|danger|risk|worr|enemy (doing|plan|intent))/.test(q)) {
    const objs = (ctx.politics?.objectives ?? []).filter((o) => o.owner === ctx.side);
    const scored = hostile
      .map((t) => ({ t, d: Math.min(...objs.map((o) => km(o.center, [t.lat, t.lon]) - o.radiusKm), 9999) }))
      .sort((a, b) => valueOf(b.t) / Math.max(20, b.d) - valueOf(a.t) / Math.max(20, a.d));
    if (!scored.length) return { text: "No hostile contacts on our picture right now. That does not mean they are not there: surge surveillance to find them." };
    // Same kind of threat in the same place reads as one line ("3 destroyers at Meridian Strait").
    const lines = new Map<string, { n: number; cls: string; w: string }>();
    for (const { t } of scored) {
      const w = where(scn, [t.lat, t.lon]);
      const k = `${t.believedClass ?? t.believedDomain}|${w}`;
      const x = lines.get(k) ?? { n: 0, cls: clsLabel(t.believedClass), w };
      x.n++;
      lines.set(k, x);
      if (lines.size >= 5) break;
    }
    return {
      text: `Top threats on our picture, most dangerous first:`,
      bullets: [...lines.values()].slice(0, 4).map((x) => `${x.n > 1 ? `${x.n} ${x.cls}s` : x.cls.charAt(0).toUpperCase() + x.cls.slice(1)} ${x.w}.`),
      focus: { center: [scored[0].t.lat, scored[0].t.lon] }, select: scored[0].t.id,
    };
  }

  // ---- losses
  if (/(loss|lost|casualt|destroyed|kills?\b|damage)/.test(q)) {
    const dead = [...ctx.entities.values()].filter((e) => e.faction === ctx.side && e.destroyed);
    const me = ctx.politics?.factions.find((f) => f.faction === ctx.side);
    const them = ctx.politics?.factions.find((f) => f.faction !== ctx.side);
    return {
      text: `We have lost ${n(dead.length, "unit")} (${me?.lossPoints ?? 0} points). The enemy has lost ${them?.lossPoints ?? 0} points.`,
      bullets: dead.slice(-5).map((e) => `${e.callsign}, ${clsLabel(e.cls)}`),
      drill: "forces",
    };
  }

  // ---- supply
  if (/(supply|fuel|ammo|munition|logistic|resupply)/.test(q)) {
    const low = own.filter((e) => e.supplyDays < 2 && e.domain !== "SPACE" && hasClass(e.cls) && getClass(e.cls).combatPower > 0).sort((a, b) => a.supplyDays - b.supplyDays);
    if (!low.length) return { text: "Supply is adequate: no combat unit is below two days." };
    return { text: `${n(low.length, "combat unit")} below two days of supply:`, bullets: low.slice(0, 6).map((e) => `${e.callsign} (${clsLabel(e.cls)}): ${e.supplyDays.toFixed(1)} days, ${where(scn, [e.lat, e.lon])}`), action: buildPlay("RESUPPLY", cop).ok ? { label: "Order resupply", action: { kind: "play", play: "RESUPPLY" } } : undefined, drill: "logistics" };
  }

  // ---- comms
  if (/(comm|network|out of contact|unreachable|cut off|reach)/.test(q)) {
    if (!ctx.unreachable.length) return { text: "All our units are reachable." , drill: "c2" };
    const names = ctx.unreachable.map((id) => ctx.entities.get(id)?.callsign ?? id);
    return { text: `${n(names.length, "unit")} cannot receive orders right now; they keep doing their last task.`, bullets: names.slice(0, 8), drill: "c2" };
  }

  // ---- escalation question
  if (/(escalat|rung|ladder)/.test(q)) {
    const me = cop.escalation, them = cop.enemyEscalation;
    return { text: `We are at rung ${me} (${ESCALATION_LADDER[me].name}); the enemy is at rung ${them}. ${ESCALATION_LADDER[me].allows}` };
  }

  // ---- where is …
  if (/(where|location|position|find|show|zoom|go to|fly to|center)/.test(q)) {
    const enemyAsked = /(enemy|hostile|their|opponent|red\b|blue\b)/.test(q) && !/\b(our|my|we)\b/.test(q);
    const cls = CLASS_WORDS.find(([re]) => re.test(q));
    // A specific unit of ours by callsign.
    const unit = own.find((e) => q.includes(e.callsign.toLowerCase()) || q.includes(e.callsign.toLowerCase().replace(/-\d+$/, "")));
    if (unit && !enemyAsked) return { text: `${unit.callsign} (${clsLabel(unit.cls)}) is ${where(scn, [unit.lat, unit.lon])}, doing ${unit.task.toLowerCase()}. Strength ${Math.round((unit.strength ?? unit.health) * 100)}%, supply ${unit.supplyDays.toFixed(1)} days.`, focus: { center: [unit.lat, unit.lon], zoom: 8 }, select: unit.id };
    if (enemyAsked || (cls && !/\b(our|my)\b/.test(q) && /enemy|hostile/.test(q))) {
      const list = hostile.filter((t) => !cls || cls[1]({ cls: t.believedClass ?? "", domain: t.believedDomain }));
      if (!list.length) return { text: `We have no ${cls ? cls[2] : "enemy forces"} on our picture. Surge surveillance to look.`, action: cop.mainEffort && buildPlay("ISR_SURGE", cop).ok ? { label: "Surge surveillance", action: { kind: "play", play: "ISR_SURGE" } } : undefined };
      const c = centroid(list.map((t) => [t.lat, t.lon] as [number, number]))!;
      return { text: `We see ${n(list.length, cls ? cls[2].replace(/s$/, "") : "enemy contact")}:`, bullets: groupByPlace(scn, list.map((t) => ({ p: [t.lat, t.lon], label: clsLabel(t.believedClass) }))), focus: { center: c } };
    }
    if (cls) {
      const list = own.filter((e) => cls[1](e));
      if (!list.length) return { text: `We have no ${cls[2]}.` };
      const c = centroid(list.map((e) => [e.lat, e.lon] as [number, number]))!;
      return { text: `Our ${cls[2]}:`, bullets: groupByPlace(scn, list.map((e) => ({ p: [e.lat, e.lon], label: clsLabel(e.cls) }))), focus: { center: c } };
    }
    const place = findPlace(scn, q);
    if (place) return { text: `${place.name}.`, focus: { center: place.at, zoom: 7.5 } };
  }

  // A bare unit or place name.
  const unit = own.find((e) => q.includes(e.callsign.toLowerCase()));
  if (unit) return { text: `${unit.callsign} (${clsLabel(unit.cls)}) is ${where(scn, [unit.lat, unit.lon])}, doing ${unit.task.toLowerCase()}.`, focus: { center: [unit.lat, unit.lon], zoom: 8 }, select: unit.id };
  const g = GLOSSARY.find(([re]) => re.test(q));
  if (g) return { text: `${g[1]}: ${g[2]}` };
  if (question) {
    const cmd = command(q, ctx, cop);
    if (cmd) return cmd;
  }
  return { text: "I didn't catch that. Try “how are we doing?”, “where is the enemy fleet?” or “strike the top threat”. Say “help” for more." };
}

function proposePlay(play: PlayId, cop: ReturnType<typeof copFromView>, objective: string | undefined, placeName?: string): Reply {
  const r = buildPlay(play, cop, objective);
  if (!r.ok) return { text: `Can't do that: ${r.reason}`, tone: "warning" };
  return { text: `${PLAYS[play].summary}${placeName ? ` Target: ${placeName}.` : ""} ${PLAYS[play].tradeoff}`, action: { label: `${PLAYS[play].title}${placeName ? ` · ${placeName}` : ""}`, action: { kind: "play", play, objective } } };
}

function command(q: string, ctx: AskContext, cop: ReturnType<typeof copFromView>): Reply | null {
  const scn = ctx.scenario;
  const objs = (ctx.politics?.objectives ?? []).filter((o) => o.owner === ctx.side);
  const place = findPlace(scn, q);
  const obj = place ? objs.find((o) => placeName(scn, o).toLowerCase() === place.name.toLowerCase()) ?? objs.find((o) => km(o.center, place.at) < o.radiusKm) : undefined;
  const objName = obj ? placeName(scn, obj) : undefined;

  if (/^(de-?escalate|step down|lower (the )?escalation|calm)/.test(q)) {
    if (cop.escalation <= 0) return { text: "We are already at rung 0." };
    return { text: `Step down to rung ${cop.escalation - 1} (${ESCALATION_LADDER[cop.escalation - 1].name}). Signals restraint and recovers a little will; fewer targets are allowed.`, action: { label: "De-escalate one rung", action: { kind: "escalate", steps: -1 } } };
  }
  if (/match (their|the enemy'?s?) escalation/.test(q)) {
    const steps = cop.enemyEscalation - cop.escalation;
    if (steps <= 0) return { text: `We are already at or above the enemy's rung (${cop.escalation} vs ${cop.enemyEscalation}).` };
    return { text: `Escalate to rung ${cop.enemyEscalation}: ${ESCALATION_LADDER[cop.enemyEscalation].allows}`, action: { label: `Escalate to rung ${cop.enemyEscalation}`, action: { kind: "escalate", steps } } };
  }
  if (/^(escalate|go up|raise (the )?escalation|climb)/.test(q)) {
    if (cop.escalation >= 5) return { text: "Rung 6 is catastrophe; your staff will not take that step.", tone: "critical" };
    const next = ESCALATION_LADDER[cop.escalation + 1];
    return { text: `Escalate to rung ${next.rung} (${next.name}): ${next.allows} Costs national will and will alarm the enemy.`, action: { label: `Escalate to rung ${next.rung}`, action: { kind: "escalate", steps: 1 } } };
  }
  const posture: Posture | null = /(aggressive|offensive|attack mode|go on the attack|take more risk)/.test(q) ? "AGGRESSIVE" : /(defensive|cautious|careful|hold back|dig in|conserve)/.test(q) ? "DEFENSIVE" : /(balanced|normal posture)/.test(q) ? "BALANCED" : null;
  if (posture && /(be|go|get|switch|set|change|more|posture|stay)/.test(q)) {
    return { text: `${POSTURE_INFO[posture].title} posture: ${POSTURE_INFO[posture].text}`, action: { label: `Set ${POSTURE_INFO[posture].title.toLowerCase()} posture`, action: { kind: "intent", posture } } };
  }
  if (/(focus on|main effort|prioriti[sz]e|concentrate on)/.test(q)) {
    if (!obj) return { text: `Which objective? ${objs.map((o) => placeName(scn, o)).join(" or ")}.` };
    return { text: `Make ${objName} the main effort: the staff shift surveillance, ships and aircraft there at their next planning cycle.`, action: { label: `Main effort: ${objName}`, action: { kind: "intent", objective: obj.id } } };
  }
  if (/(strike|hit|take out|destroy|attack) (the )?(top|biggest|best|main|highest)|strike (it|now|them)\b|^strike\b/.test(q)) return proposePlay("STRIKE_TOP", cop, undefined);
  if (/(surge|more|send) (isr|surveillance|recon|intel|eyes|drones)|^(watch|scout|recon|look at|search)\b/.test(q)) return proposePlay("ISR_SURGE", cop, obj?.id, objName);
  if (/(air cover|fighters? (over|to)|\bcap\b|air patrol|protect .* from (the )?air)/.test(q)) return proposePlay("AIR_COVER", cop, obj?.id, objName);
  if (/(push|send|move) (the )?(fleet|navy|ships)|sea control/.test(q)) return proposePlay("SEA_CONTROL", cop, obj?.id, objName);
  if (/(assault|counter-?attack|seize|take back|retake|invade)|^attack\b/.test(q)) return proposePlay("ASSAULT", cop, obj?.id, objName);
  if (/(reinforce|defend|protect|send (troops|forces|units) to|hold)\b/.test(q)) return proposePlay("REINFORCE", cop, obj?.id, objName);
  if (/(^jam|jam (the|their|enemy)|hack|cyber|electronic attack)/.test(q)) return proposePlay("JAM", cop, obj?.id, objName);
  if (/(^resupply|send (convoys|supplies|fuel)|refuel|resupply)/.test(q)) return proposePlay("RESUPPLY", cop, undefined);
  if (/(pull back|retreat|withdraw|fall back|regroup)/.test(q)) return proposePlay("PULL_BACK", cop, undefined);
  return null;
}

function recommend(ctx: AskContext, cop: ReturnType<typeof copFromView>): Reply {
  const card = ctx.cards[0];
  if (card) {
    const o = card.options[card.recommended];
    return { text: `${card.title}. Your staff recommend: ${o.label}. ${o.detail}`, action: o.action.kind === "none" ? undefined : { label: o.label, action: o.action }, tone: card.severity };
  }
  const brief = ctx.brief;
  const mine = brief?.objectives.filter((o) => o.mine) ?? [];
  const weak = mine.find((o) => o.state === "lost") ?? mine.find((o) => o.state === "contested");
  if (!cop.mainEffort && mine[0]) return { text: `Set your intent first: make ${mine[0].place} the main effort.`, action: { label: `Main effort: ${mine[0].place}`, action: { kind: "intent", objective: mine[0].id } } };
  const identified = ctx.tracks.filter((t: TrackView) => t.owner === ctx.side && t.affiliation === "HOSTILE" && (t.quality === "IDENTIFIED" || t.quality === "TRACKED")).length;
  if (weak) {
    for (const p of ["REINFORCE", "SEA_CONTROL", "ASSAULT", "AIR_COVER"] as PlayId[]) {
      if (buildPlay(p, cop, weak.id).ok) return { ...proposePlay(p, cop, weak.id, weak.place), text: `${weak.place} is ${weak.stateText.toLowerCase()}. ${PLAYS[p].summary}` };
    }
  }
  if (identified === 0 && cop.mainEffort && buildPlay("ISR_SURGE", cop).ok) return { ...proposePlay("ISR_SURGE", cop, cop.mainEffort), text: "We cannot strike what we cannot see. Surge surveillance over the main effort to find targets." };
  if (buildPlay("STRIKE_TOP", cop).ok) return { ...proposePlay("STRIKE_TOP", cop, undefined), text: "We have an identified target in range. Striking it now removes a threat before it moves." };
  const dry = ([...ctx.entities.values()] as EntityView[]).filter((e) => e.faction === ctx.side && !e.destroyed && e.supplyDays < 1).length;
  if (dry >= 2 && buildPlay("RESUPPLY", cop).ok) return { ...proposePlay("RESUPPLY", cop, undefined), text: `${dry} units are nearly out of supply.` };
  return { text: "The plan is working. Hold your objectives, keep surveillance on the enemy, and watch for decision cards from your staff." };
}
