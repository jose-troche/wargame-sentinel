// The staff briefing: turns the raw event stream and the faction picture into a short, ranked,
// plain-language summary for the commander. Repeated reports of the same kind in the same place are
// merged ("3 strikes near Meridian Island"), routine traffic is dropped, and state the commander must
// know about (enemies inside an objective, units out of supply, lost comms) is raised even when no
// single event announced it. Pure logic over one faction's view, so it is fog-of-war safe.
import { ESCALATION_LADDER, HOUR_MS, type C2View, type EntityView, type EventView, type LogisticsView, type PoliticsView, type Scenario, type TrackView } from "@sentinel/protocol";
import { getClass, hasClass } from "@sentinel/catalog";
import { km, placeName, where } from "./places";
import { SEVERITY_RANK, type Alert, type Brief, type Category, type Drill, type ObjectiveStatus, type Severity, type Side, type StatusTile } from "./types";

export interface BriefInput {
  side: Side;
  scenario: Scenario;
  simMs: number;
  entities: Map<string, EntityView>;
  tracks: TrackView[];
  politics: PoliticsView | null;
  c2: C2View[];
  logistics: LogisticsView[];
  events: EventView[];
}

/** Reports of the same kind in the same place within this window are merged into one. */
const MERGE_MS = 3 * HOUR_MS;
/** Reports older than this drop off the briefing (they stay in the event log). */
const KEEP_MS: Record<Severity, number> = { critical: 18 * HOUR_MS, warning: 10 * HOUR_MS, good: 8 * HOUR_MS, info: 4 * HOUR_MS };
const MAX_ALERTS = 40;

/** Enemy classes worth telling the commander about by name. */
const HIGH_VALUE = new Set(["csg", "arg", "ssn", "bomber", "lrad_bn", "hq", "launch_site", "armored_bde", "mech_inf_bde", "coastal_ashm", "destroyer", "aewc", "ground_station"]);

const points = (cls: string) => (hasClass(cls) ? getClass(cls).cost.points : 10);
const nameOf = (cls?: string) => (cls && hasClass(cls) ? getClass(cls).name.toLowerCase() : "unknown contact");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const CATEGORY_OF_DOMAIN: Record<string, Category> = { LAND: "land", SEA: "sea", AIR: "air", DRONE: "air", SPACE: "space" };

interface Draft {
  group: string;
  severity: Severity;
  category: Category;
  title: (n: number) => string;
  detail?: string;
  where?: [number, number];
  entity?: string;
  drill?: Drill;
}

export class Briefer {
  private lastSeq = 0;
  private alerts = new Map<string, Alert>();
  private nameCache = new Map<string, EntityView>();

  constructor(private side: Side) {}

  reset() {
    this.lastSeq = 0;
    this.alerts.clear();
  }

  update(inp: BriefInput): Brief {
    if (inp.events.length && inp.events[inp.events.length - 1].seq < this.lastSeq) this.reset(); // rewound
    this.indexCallsigns(inp.entities);
    for (const e of inp.events) {
      if (e.seq <= this.lastSeq) continue;
      this.lastSeq = e.seq;
      const d = this.classify(e, inp);
      if (d) this.add(d, e, inp);
    }
    const live = new Set<string>();
    for (const d of this.stateAlerts(inp)) live.add(this.upsertState(d, inp.simMs));
    for (const k of this.alerts.keys()) if (k.startsWith("state|") && !live.has(k)) this.alerts.delete(k);
    // Expire old reports, keep the newest within the cap.
    for (const [k, a] of this.alerts) if (!k.startsWith("state|") && inp.simMs - a.simMs > KEEP_MS[a.severity]) this.alerts.delete(k);
    const alerts = [...this.alerts.values()].sort(rankAlerts).slice(0, MAX_ALERTS);
    const objectives = objectiveStatus(inp);
    const score = scoreOf(inp);
    const tiles = statusTiles(inp, objectives, score);
    const outcome = outcomeOf(inp);
    const { headline, tone } = headlineOf(inp, objectives, score, alerts, outcome);
    return { headline, tone, score, objectives, tiles, alerts, outcome };
  }

  private indexCallsigns(entities: Map<string, EntityView>) {
    if (this.nameCache.size === entities.size) return;
    this.nameCache.clear();
    for (const e of entities.values()) this.nameCache.set(e.callsign, e);
  }

  private add(d: Draft, e: EventView, inp: BriefInput) {
    const place = d.where ? where(inp.scenario, d.where) : "";
    const key = `${d.group}|${place}`;
    const prev = this.alerts.get(key);
    if (prev && e.simMs - prev.simMs <= MERGE_MS) {
      prev.count += 1;
      prev.simMs = e.simMs;
      prev.title = withPlace(d.title(prev.count), place);
      prev.detail = d.detail ?? prev.detail;
      if (SEVERITY_RANK[d.severity] < SEVERITY_RANK[prev.severity]) prev.severity = d.severity;
      prev.seqs = [...prev.seqs.slice(-11), e.seq];
      if (d.where) prev.where = d.where;
      return;
    }
    this.alerts.set(key, {
      key, severity: d.severity, category: d.category, title: withPlace(d.title(1), place), detail: d.detail, simMs: e.simMs, firstMs: e.simMs, count: 1,
      where: d.where, entity: d.entity, drill: d.drill, seqs: [e.seq],
    });
  }

  /** State-derived reports keep one entry per key and refresh in place (no event announced them). */
  private upsertState(d: Draft, now: number): string {
    const key = `state|${d.group}`;
    const prev = this.alerts.get(key);
    const title = d.title(1);
    if (prev) {
      // Only a real change moves the report up the list; an unchanged condition keeps its place.
      if (prev.title !== title || prev.severity !== d.severity) prev.simMs = now;
      prev.title = title;
      prev.detail = d.detail;
      prev.severity = d.severity;
      prev.where = d.where;
      return key;
    }
    this.alerts.set(key, { key, severity: d.severity, category: d.category, title, detail: d.detail, simMs: now, firstMs: now, count: 1, where: d.where, entity: d.entity, drill: d.drill, seqs: [] });
    return key;
  }

  /** Maps one event to a staff report, or null for routine traffic the commander need not see. */
  private classify(e: EventView, inp: BriefInput): Draft | null {
    const side = this.side;
    const ownName = inp.politics?.factions.find((f) => f.faction === side)?.name ?? side;
    const posOf = (id?: string): [number, number] | undefined => {
      const x = id ? inp.entities.get(id) : undefined;
      return x ? [x.lat, x.lon] : undefined;
    };
    const ownEntity = e.entities?.map((id) => inp.entities.get(id)).find((x) => x && x.faction === side);
    switch (e.type) {
      case "ENTITY_DESTROYED": {
        const m = e.text.match(/^(\S+) \(([^)]+)\) destroyed — (.*)$/);
        const callsign = m?.[1] ?? "";
        const victim = this.nameCache.get(callsign);
        const cost = Number(e.factors?.cost ?? 10);
        if (victim && victim.faction === side) {
          return {
            group: `lost-${cost >= 30 ? "major" : "minor"}`, severity: cost >= 30 ? "critical" : "warning", category: CATEGORY_OF_DOMAIN[victim.domain] ?? "land",
            title: (n) => (n === 1 ? `We lost ${callsign} (${m?.[2].toLowerCase() ?? "unit"})` : `We lost ${n} units`), detail: m ? `Cause: ${m[3]}.` : undefined,
            where: [victim.lat, victim.lon], entity: victim.id, drill: "forces",
          };
        }
        if (!m) return null;
        return {
          group: `kill-${cost >= 30 ? "major" : "minor"}`, severity: "good", category: "strategy",
          title: (n) => (n === 1 ? `Enemy ${m[2].toLowerCase()} destroyed` : `${n} enemy units destroyed`), detail: `${callsign}: ${m[3]}.`,
          where: posOf(ownEntity?.id), drill: "killchain",
        };
      }
      case "OBJECTIVE": {
        const m = e.text.match(/^Objective "(.+)" \((BLUE|RED)\): (\S+) → (\S+)$/);
        if (!m) return null;
        const [, name, owner, , to] = m;
        const o = inp.politics?.objectives.find((x) => x.name === name && x.owner === owner);
        const place = o ? placeName(inp.scenario, o) : name;
        if (owner === side) {
          const sev: Severity = to === side ? "good" : to === "CONTESTED" ? "warning" : to === "NONE" ? "info" : "critical";
          const verb = to === side ? "secured" : to === "CONTESTED" ? "contested" : to === "NONE" ? "empty — no forces present" : "lost to the enemy";
          return { group: `obj-${o?.id ?? name}`, severity: sev, category: "strategy", title: () => `Our objective ${place}: ${verb}`, detail: `"${name}". Holding objectives earns victory points every hour.`, where: o?.center, drill: "strategic" };
        }
        const sev: Severity = to === owner ? "critical" : to === "CONTESTED" ? "warning" : "good";
        const verb = to === owner ? "the enemy now holds it" : to === "CONTESTED" ? "the enemy is contesting it" : "the enemy has been pushed out";
        return { group: `eobj-${o?.id ?? name}`, severity: sev, category: "strategy", title: () => `Enemy aim at ${place}: ${verb}`, detail: `The enemy wants to "${name.toLowerCase()}".`, where: o?.center, drill: "strategic" };
      }
      case "ESCALATION": {
        const mine = e.text.startsWith(ownName);
        const to = Number(e.factors?.to ?? NaN);
        const rung = Number.isFinite(to) ? ESCALATION_LADDER[Math.max(0, Math.min(6, to))] : null;
        return {
          group: `esc-${mine ? "own" : "enemy"}`, severity: mine ? "info" : "critical", category: "strategy",
          title: () => (mine ? `We moved to escalation rung ${to}${rung ? ` (${rung.name})` : ""}` : `Enemy escalated${rung ? ` to rung ${to}: ${rung.name}` : ""}`),
          detail: rung ? `Now allowed: ${rung.allows}` : e.text, drill: "strategic",
        };
      }
      case "WILL": {
        const m = e.text.match(/national will (\d+) → (\d+)/);
        if (!m || !e.text.startsWith(ownName)) return null;
        const down = Number(m[2]) < Number(m[1]);
        return { group: "will", severity: down ? "warning" : "good", category: "strategy", title: () => `National will ${down ? "fell" : "rose"} to ${m[2]}`, detail: down ? "Losses, lost objectives and civilian harm drain will. At zero we must seek terms." : "Holding objectives and destroying enemy forces build will.", drill: "strategic" };
      }
      case "SEEKS_TERMS":
        return { group: "terms", severity: e.text.startsWith(ownName) ? "critical" : "good", category: "strategy", title: () => e.text, drill: "strategic" };
      case "SESSION_END":
        return { group: "end", severity: "critical", category: "strategy", title: () => e.text.replace(/^Scenario ended: /, "Game over: "), drill: "strategic" };
      case "KILL_CHAIN_BROKEN": {
        const reason = String(e.factors?.reason ?? "").toLowerCase();
        return { group: "chain-broken", severity: "info", category: "intel", title: (n) => (n === 1 ? "A strike was called off" : `${n} strikes were called off`), detail: `Latest reason: ${reason || "unknown"}. Fresh, identified tracks and a fast network make strikes succeed.`, where: posOf(ownEntity?.id), drill: "killchain" };
      }
      case "ENGAGEMENT": {
        if (!ownEntity) return null;
        const attacked = !e.text.startsWith(ownEntity.callsign);
        const hits = Number(e.factors?.hits ?? 0);
        if (attacked) return { group: "under-fire", severity: hits > 0 ? "warning" : "info", category: CATEGORY_OF_DOMAIN[ownEntity.domain] ?? "land", title: (n) => (n === 1 ? `${ownEntity.callsign} came under fire` : `Our forces came under fire ${n} times`), detail: hits > 0 ? "Some weapons got through the defenses." : "Defenses held.", where: [ownEntity.lat, ownEntity.lon], entity: ownEntity.id, drill: "killchain" };
        return { group: "strikes", severity: "info", category: CATEGORY_OF_DOMAIN[ownEntity.domain] ?? "air", title: (n) => (n === 1 ? "We struck an enemy target" : `We struck enemy targets ${n} times`), detail: e.text, where: [ownEntity.lat, ownEntity.lon], drill: "killchain" };
      }
      case "LAND_COMBAT":
        if (!ownEntity) return null;
        return { group: "land-combat", severity: (ownEntity.strength ?? 1) < 0.5 ? "warning" : "info", category: "land", title: (n) => (n === 1 ? `${ownEntity.callsign} is in ground combat` : `Ground fighting continues (${n} reports)`), detail: `${ownEntity.callsign} at ${Math.round((ownEntity.strength ?? ownEntity.health) * 100)}% strength.`, where: [ownEntity.lat, ownEntity.lon], entity: ownEntity.id, drill: "forces" };
      case "COHESION_LOST":
      case "COMBAT_INEFFECTIVE":
        if (!ownEntity) return null;
        return { group: "ineffective", severity: "warning", category: "land", title: (n) => (n === 1 ? `${ownEntity.callsign} is badly hurt and ${e.type === "COMBAT_INEFFECTIVE" ? "withdrawing" : "losing cohesion"}` : `${n} ground units are badly hurt`), detail: "Units below 50% lose cohesion; below 30% they withdraw to recover.", where: [ownEntity.lat, ownEntity.lon], entity: ownEntity.id, drill: "forces" };
      case "SUPPLY_EXHAUSTED":
        if (!ownEntity) return null;
        return { group: "supply", severity: "warning", category: "logistics", title: (n) => (n === 1 ? `${ownEntity.callsign} is out of supply` : `${n} units are out of supply`), detail: "Out-of-supply units move slower and hit less. Send convoys or pull them back.", where: [ownEntity.lat, ownEntity.lon], entity: ownEntity.id, drill: "logistics" };
      case "JAMMING_ON": {
        const enemyJam = !ownEntity;
        if (!enemyJam) return null;
        const m = e.text.match(/near (-?[\d.]+), (-?[\d.]+)/);
        return { group: "jam", severity: "warning", category: "cyber", title: () => "Enemy jamming detected", detail: "Radars see less and orders take longer inside the jamming zone.", where: m ? [Number(m[1]), Number(m[2])] : undefined, drill: "c2" };
      }
      case "CYBER_DETECTED":
        return { group: "cyber-in", severity: "warning", category: "cyber", title: () => `Cyber intrusion against ${ownEntity?.callsign ?? "our network"}`, detail: "Command messages through that node are delayed or lost for a while.", where: posOf(ownEntity?.id), drill: "c2" };
      case "CYBER_EFFECT":
        return Number(e.factors?.success ?? 0) ? { group: "cyber-out", severity: "good", category: "cyber", title: () => "Our cyber attack hit an enemy command node", drill: "c2" } : null;
      case "CIVILIAN_HARM": {
        const ours = !!ownEntity;
        return { group: `harm-${ours ? "own" : "enemy"}`, severity: ours ? "critical" : "info", category: "strategy", title: () => (ours ? "Our strike harmed civilians" : "Enemy strike harmed civilians"), detail: ours ? "Civilian harm costs us national will and is reported in the review. Strike away from cities." : "This costs the enemy national will.", drill: "strategic" };
      }
      case "LAUNCH_WARNING":
        return { group: "launch", severity: "critical", category: "space", title: () => `Missile launch detected toward ${ownEntity?.callsign ?? "our forces"}`, detail: "Space-based warning bought time for air defenses.", where: posOf(ownEntity?.id), entity: ownEntity?.id, drill: "orbital" };
      case "TRACK_IDENTIFIED": {
        const m = e.text.match(/identified (\S+) as (\S+)/);
        const cls = m?.[2];
        const tr = m ? inp.tracks.find((t) => t.id === m[1]) : undefined;
        if (cls && HIGH_VALUE.has(cls)) return { group: `hv-${cls}`, severity: "warning", category: "intel", title: (n) => (n === 1 ? `Intel: enemy ${nameOf(cls)} identified` : `Intel: ${n} enemy ${nameOf(cls)}s identified`), detail: "Identified targets can be struck. It stays identified only while our sensors keep watching.", where: tr ? [tr.lat, tr.lon] : undefined, drill: "intel" };
        return { group: "contacts", severity: "info", category: "intel", title: (n) => (n === 1 ? "Intel: new enemy contact identified" : `Intel: ${n} enemy contacts identified`), where: tr ? [tr.lat, tr.lon] : undefined, drill: "intel" };
      }
      case "INJECT": {
        const kind = String(e.factors?.kind ?? "");
        return { group: `inject-${kind}`, severity: kind === "CEASEFIRE_OFFER" || kind === "SAT_FAILURE" || kind === "CYBER_OUTAGE" ? "warning" : "info", category: kind === "SAT_FAILURE" ? "space" : kind === "CYBER_OUTAGE" ? "cyber" : "strategy", title: () => e.text.replace(/^White cell inject: /, "World event: "), drill: "events" };
      }
      case "DEBRIS":
        return { group: "debris", severity: "warning", category: "space", title: () => "Debris field in orbit", detail: "Debris threatens every satellite in that orbit, including ours.", drill: "orbital" };
      case "INTENT":
        return { group: "intent", severity: "info", category: "strategy", title: () => e.text.replace(/^.*commander's intent: /, "Intent issued: "), drill: "agents" };
      default:
        return null; // routine: sorties, deliveries, downlinks, BDA, track loss, metrics
    }
  }

  /** Conditions worth reporting even when no single event announced them. */
  private stateAlerts(inp: BriefInput): Draft[] {
    const out: Draft[] = [];
    const side = this.side;
    const own = [...inp.entities.values()].filter((e) => e.faction === side && !e.destroyed);
    const hostile = inp.tracks.filter((t) => t.owner === side && t.affiliation === "HOSTILE");
    // Enemy forces inside or closing on our objectives.
    for (const o of inp.politics?.objectives ?? []) {
      if (o.owner !== side) continue;
      const near = hostile.filter((t) => (o.domain === "ANY" || t.believedDomain === o.domain || (o.domain === "SEA" && t.believedDomain === "SEA")) && km(o.center, [t.lat, t.lon]) < o.radiusKm * 1.6);
      if (!near.length) continue;
      const inside = near.filter((t) => km(o.center, [t.lat, t.lon]) < o.radiusKm).length;
      out.push({
        group: `threat-${o.id}`, severity: inside ? "critical" : "warning", category: "intel",
        title: () => `${plural(near.length, "enemy contact")} ${inside ? "inside" : "closing on"} ${placeName(inp.scenario, o)}`,
        detail: `${near.slice(0, 3).map((t) => nameOf(t.believedClass)).join(", ")}${near.length > 3 ? "…" : ""}. ${inside ? "This objective is at risk." : "Consider reinforcing or striking first."}`,
        where: o.center, drill: "intel",
      });
    }
    const dry = own.filter((e) => e.supplyDays < 1 && e.domain !== "SPACE" && hasClass(e.cls) && getClass(e.cls).combatPower > 0);
    if (dry.length >= 2) out.push({ group: "low-supply", severity: dry.length >= 5 ? "critical" : "warning", category: "logistics", title: () => `${plural(dry.length, "combat unit")} below one day of supply`, detail: `${dry.slice(0, 4).map((e) => e.callsign).join(", ")}${dry.length > 4 ? "…" : ""}. Resupply or pull back.`, drill: "logistics" });
    const c2 = inp.c2.find((c) => c.faction === side);
    if (c2 && own.length) {
      const pct = c2.unreachable.length / own.length;
      if (pct >= 0.15) out.push({ group: "comms", severity: pct >= 0.3 ? "critical" : "warning", category: "comms", title: () => `${Math.round(pct * 100)}% of our units are out of contact`, detail: "Units we cannot reach keep doing their last order. Jamming and lost relays cause this.", drill: "c2" });
    }
    return out;
  }
}

function withPlace(title: string, place: string) {
  return place && !title.includes(place.replace(/^at /, "")) ? `${title} ${place}` : title;
}

function rankAlerts(a: Alert, b: Alert) {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.simMs - a.simMs || a.key.localeCompare(b.key);
}

function objectiveStatus(inp: BriefInput): ObjectiveStatus[] {
  const side = inp.side;
  return (inp.politics?.objectives ?? []).map((o) => {
    const mine = o.owner === side;
    const enemy = o.owner === "BLUE" ? "RED" : "BLUE";
    const state: ObjectiveStatus["state"] = o.holder === o.owner ? "held" : o.holder === "CONTESTED" ? "contested" : o.holder === enemy ? "lost" : "open";
    const stateText = mine
      ? { held: "Held", contested: "Contested", lost: "Enemy holds", open: "Not yet held" }[state]
      : { held: "Enemy achieved it", contested: "Contested", lost: "Denied to enemy", open: "Enemy not there yet" }[state];
    return { id: o.id, name: o.name, place: placeName(inp.scenario, o), owner: o.owner as Side, mine, kind: o.kind, state, stateText, weight: o.weight, heldHours: o.heldHours, center: o.center, radiusKm: o.radiusKm };
  }).sort((a, b) => Number(b.mine) - Number(a.mine) || b.weight - a.weight);
}

/** Victory points as the engine scores a time-limit finish: objective-hours × weight + national will. */
function scoreOf(inp: BriefInput) {
  const side = inp.side;
  const pol = inp.politics;
  const f = (s: string) => pol?.factions.find((x) => x.faction === s);
  const objPts = (s: string) => (pol?.objectives ?? []).filter((o) => o.owner === s).reduce((t, o) => t + o.heldHours * o.weight, 0);
  const enemySide = side === "BLUE" ? "RED" : "BLUE";
  const durationH = inp.scenario.durationH;
  return {
    own: Math.round(objPts(side) + (f(side)?.will ?? 0)), enemy: Math.round(objPts(enemySide) + (f(enemySide)?.will ?? 0)),
    ownName: f(side)?.name ?? side, enemyName: f(enemySide)?.name ?? enemySide,
    hoursLeft: Math.max(0, durationH - inp.simMs / HOUR_MS), durationH,
  };
}

function statusTiles(inp: BriefInput, objectives: ObjectiveStatus[], score: Brief["score"]): StatusTile[] {
  const side = inp.side;
  const pol = inp.politics;
  const ownF = pol?.factions.find((f) => f.faction === side);
  const enF = pol?.factions.find((f) => f.faction !== side);
  const mine = objectives.filter((o) => o.mine);
  const held = mine.filter((o) => o.state === "held").length;
  const lost = mine.some((o) => o.state === "lost");
  const all = [...inp.entities.values()].filter((e) => e.faction === side && e.domain !== "SPACE");
  const total = all.reduce((s, e) => s + points(e.cls), 0) || 1;
  const alive = all.filter((e) => !e.destroyed).reduce((s, e) => s + points(e.cls) * Math.max(0, Math.min(1, e.domain === "LAND" ? e.strength ?? e.health : e.health)), 0);
  const strength = alive / total;
  const dry = all.filter((e) => !e.destroyed && e.supplyDays < 1 && hasClass(e.cls) && getClass(e.cls).combatPower > 0).length;
  const c2 = inp.c2.find((c) => c.faction === side);
  const unreachable = c2?.unreachable.length ?? 0;
  const contacts = inp.tracks.filter((t) => t.owner === side && t.affiliation !== "NEUTRAL");
  const identified = contacts.filter((t) => t.quality === "IDENTIFIED" || t.quality === "TRACKED").length;
  const esc = ownF?.escalation ?? 0;
  const enEsc = enF?.escalation ?? 0;
  const lead = score.own - score.enemy;
  const tiles: StatusTile[] = [
    { id: "objectives", label: "Objectives", value: `${held} of ${mine.length} held`, sub: mine.map((o) => `${o.place}: ${o.stateText.toLowerCase()}`).join(" · "), severity: lost ? "critical" : held === mine.length ? "good" : mine.some((o) => o.state === "contested") ? "warning" : "info", drill: "strategic", help: "Your objectives. Each hour you hold one earns victory points and national will." },
    { id: "score", label: "Score", value: `${score.own} vs ≈${score.enemy}`, sub: lead > 5 ? "You lead" : lead < -5 ? "Enemy leads" : "Too close to call", severity: lead > 5 ? "good" : lead < -25 ? "critical" : lead < -5 ? "warning" : "info", drill: "strategic", help: "Objective-hours (weighted) plus national will. If neither side breaks, the higher score wins at the time limit. Enemy numbers are estimates." },
    { id: "forces", label: "Forces", value: `${Math.round(strength * 100)}%`, sub: `Lost ${ownF?.lossPoints ?? 0} pts · enemy ${enF?.lossPoints ?? 0}`, severity: strength < 0.5 ? "critical" : strength < 0.75 ? "warning" : "good", drill: "forces", help: "Combat strength left, weighted by unit value. Loss points measure what each side has lost." },
    { id: "will", label: "Will", value: `${Math.round(ownF?.will ?? 0)} vs ≈${Math.round(enF?.will ?? 0)}`, sub: (ownF?.will ?? 50) < 30 ? "Dangerously low" : "0 = seek terms", severity: (ownF?.will ?? 50) < 25 ? "critical" : (ownF?.will ?? 50) < 40 ? "warning" : "info", drill: "strategic", help: "Public support for the war (0–100). Losses and civilian harm lower it; objectives and enemy losses raise it. At zero you lose." },
    { id: "escalation", label: "Escalation", value: `${esc} vs ${enEsc}`, sub: ESCALATION_LADDER[Math.max(0, Math.min(6, esc))].name, severity: enEsc > esc ? "warning" : esc >= 5 ? "warning" : "info", drill: "strategic", help: "How far the conflict has gone (0–6). Higher rungs permit more targets but cost will and provoke the enemy. Rung 6 ends the game in catastrophe." },
    { id: "supply", label: "Supply", value: dry ? `${dry} short` : "Adequate", sub: dry ? "Below 1 day of supply" : "No unit below 1 day", severity: dry >= 5 ? "critical" : dry >= 2 ? "warning" : "good", drill: "logistics", help: "Fuel, munitions and spares. Units out of supply move slower and hit less." },
    { id: "comms", label: "Comms", value: unreachable ? `${unreachable} cut off` : "All reached", sub: c2 ? `Orders take ≈${Math.max(1, Math.round(c2.meanLatencyMs / 60000))} min` : "", severity: all.length && unreachable / all.length >= 0.3 ? "critical" : unreachable ? "warning" : "good", drill: "c2", help: "Orders travel over radio, satellite and datalinks. Jamming and lost relays delay them or cut units off." },
    { id: "intel", label: "Intel", value: plural(contacts.length, "contact"), sub: `${identified} identified`, severity: contacts.length && identified / contacts.length < 0.25 ? "warning" : "info", drill: "intel", help: "What your sensors see. Only identified contacts can be targeted; contacts fade if sensors lose them." },
  ];
  return tiles;
}

function outcomeOf(inp: BriefInput): Brief["outcome"] {
  const o = inp.politics?.outcome;
  if (!o) return undefined;
  const result = o.winner === "CATASTROPHIC" ? "catastrophe" : o.winner === "DRAW" ? "draw" : o.winner === inp.side ? "victory" : "defeat";
  return { result, text: o.reason };
}

function headlineOf(inp: BriefInput, objectives: ObjectiveStatus[], score: Brief["score"], alerts: Alert[], outcome: Brief["outcome"]): { headline: string; tone: Severity } {
  if (outcome) {
    const word = { victory: "Victory", defeat: "Defeat", draw: "Draw", catastrophe: "Catastrophe" }[outcome.result];
    return { headline: `${word}. ${outcome.text}.`, tone: outcome.result === "victory" ? "good" : outcome.result === "draw" ? "info" : "critical" };
  }
  const mine = objectives.filter((o) => o.mine);
  const held = mine.filter((o) => o.state === "held").length;
  const lead = score.own - score.enemy;
  const standing = lead > 5 ? "We are ahead" : lead < -5 ? "We are behind" : "The contest is even";
  const top = alerts.find((a) => a.severity === "critical") ?? alerts.find((a) => a.severity === "warning");
  const objText = mine.length ? `holding ${held} of ${mine.length} objectives` : "";
  const first = `${standing}${objText ? `, ${objText}` : ""}.`;
  if (inp.simMs < HOUR_MS && !top) return { headline: `${first} Set your intent: choose a main effort and posture.`, tone: "info" };
  return { headline: top ? `${first} ${top.title}.` : `${first} No immediate threats.`, tone: top?.severity ?? (lead >= 0 ? "good" : "info") };
}
