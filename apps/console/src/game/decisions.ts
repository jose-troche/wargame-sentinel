// Decision points: the moments the staff bring to the commander, each with two or three options,
// the consequence of each in plain language, and the staff's recommendation. Options are offered only
// when they are actually possible right now (a strike needs an identified target in range, an assault
// needs escalation rung 3), so every button does something.
import { ESCALATION_LADDER, HOUR_MS, type CopForAgents, type EventView, type Posture } from "@sentinel/protocol";
import { buildPlay, PLAYS, valueOf, type PlayId } from "@sentinel/agents-rules";
import { getClass, hasClass } from "@sentinel/catalog";
import { LEVELS, POSTURE_INFO, type Level } from "./levels";
import type { Brief, DecisionCard, DecisionOption, Side } from "./types";

const HV_CLASSES = new Set(["csg", "arg", "ssn", "bomber", "lrad_bn", "hq", "launch_site", "coastal_ashm"]);

export interface DecisionInput {
  side: Side;
  level: Level;
  simMs: number;
  cop: CopForAgents;
  brief: Brief;
  events: EventView[];
  unreachable: number;
  /** Will history for the commander's side: [hour, will]. */
  willHistory: [number, number][];
}

export class DecisionDesk {
  private lastSeq = 0;
  /** Keys already raised, with the sim time they may be raised again. */
  private cooldown = new Map<string, number>();

  reset() {
    this.lastSeq = 0;
    this.cooldown.clear();
  }

  /** Marks a key as handled so it is not raised again until `untilMs`. */
  private arm(key: string, now: number, hours: number) {
    this.cooldown.set(key, now + hours * HOUR_MS);
  }
  private ready(key: string, now: number) {
    const t = this.cooldown.get(key);
    return t === undefined || now >= t;
  }

  /** New decision cards (existing open ones are kept by the caller and not duplicated here). */
  detect(inp: DecisionInput, openKinds: Set<string>): DecisionCard[] {
    const out: DecisionCard[] = [];
    const now = inp.simMs;
    const lvl = LEVELS[inp.level];
    const deadline = lvl.deadlineH === null ? undefined : now + lvl.deadlineH * HOUR_MS;
    const cop = inp.cop;
    const can = (play: PlayId, objective?: string) => buildPlay(play, cop, objective).ok;
    const playOpt = (play: PlayId, objective: string | undefined, label: string, detail?: string): DecisionOption => ({ label, detail: detail ?? `${PLAYS[play].summary} ${PLAYS[play].tradeoff}`, action: { kind: "play", play, objective } });
    const push = (c: Omit<DecisionCard, "createdMs" | "deadlineMs"> & { deadline?: boolean }) => {
      if (openKinds.has(c.id)) return;
      const { deadline: useDeadline = true, ...card } = c;
      out.push({ ...card, createdMs: now, deadlineMs: useDeadline ? deadline : undefined });
    };
    const ownObjs = inp.brief.objectives.filter((o) => o.mine);

    // 1. Commander's intent at the start of the game.
    if (!cop.mainEffort && this.ready("intent", now) && ownObjs.length) {
      this.arm("intent", now, 1e6);
      push({
        id: "intent", kind: "intent", severity: "warning", category: "strategy", deadline: false,
        title: "Set your commander's intent",
        situation: `Tell your staff what matters most. They will concentrate surveillance, ships and aircraft on your main effort, and fight with the posture you choose. You have ${ownObjs.length} objectives: ${ownObjs.map((o) => o.place).join(" and ")}.`,
        options: (["BALANCED", "AGGRESSIVE", "DEFENSIVE"] as Posture[]).map((p) => ({ label: POSTURE_INFO[p].title, detail: POSTURE_INFO[p].text, action: { kind: "intent", posture: p, objective: ownObjs[0].id } })),
        recommended: 0,
      });
    }

    // 2. The enemy escalated above us.
    if (cop.enemyEscalation > cop.escalation) {
      const key = `esc-${cop.enemyEscalation}`;
      if (this.ready(key, now)) {
        this.arm(key, now, 1e6);
        const steps = cop.enemyEscalation - cop.escalation;
        const rung = ESCALATION_LADDER[Math.min(6, cop.enemyEscalation)];
        const options: DecisionOption[] = [
          { label: `Match them (rung ${cop.enemyEscalation})`, detail: `Unlocks: ${rung.allows} Costs about ${2 * steps} points of national will and signals resolve.`, action: { kind: "escalate", steps } },
          { label: "Hold at our rung", detail: `Keeps the moral high ground and our will. The enemy can now hit targets we are not allowed to answer.`, action: { kind: "none" } },
        ];
        push({
          id: key, kind: "escalation", severity: "critical", category: "strategy",
          title: `The enemy escalated to rung ${cop.enemyEscalation}: ${rung.name}`,
          situation: `We are at rung ${cop.escalation}. ${rung.allows} Each rung up widens what both sides may strike; rung 6 ends the game in catastrophe for everyone.`,
          options, recommended: cop.will > 45 && cop.enemyEscalation <= 4 ? 0 : 1,
        });
      }
    }

    // 3. Our objectives contested or lost.
    for (const o of ownObjs) {
      if (o.state === "held" || o.state === "open") {
        this.cooldown.delete(`obj-${o.id}-contested`);
        this.cooldown.delete(`obj-${o.id}-lost`);
        continue;
      }
      const key = `obj-${o.id}-${o.state}`;
      if (!this.ready(key, now)) continue;
      this.arm(key, now, 12);
      const options: DecisionOption[] = [];
      if (can("REINFORCE", o.id)) options.push(playOpt("REINFORCE", o.id, `Reinforce ${o.place}`));
      if (can("SEA_CONTROL", o.id) && o.kind !== "DESTROY") options.push(playOpt("SEA_CONTROL", o.id, `Push the fleet to ${o.place}`));
      if (can("ASSAULT", o.id)) options.push(playOpt("ASSAULT", o.id, `Counter-attack at ${o.place}`));
      if (can("AIR_COVER", o.id)) options.push(playOpt("AIR_COVER", o.id, `Air cover over ${o.place}`));
      if (cop.mainEffort !== o.id) options.push({ label: `Make ${o.place} the main effort`, detail: "The whole staff re-plans around it at their next cycle: surveillance, ships and aircraft shift here.", action: { kind: "intent", objective: o.id } });
      options.push({ label: "Accept it for now", detail: "Keep the current plan. Every hour the enemy holds it costs us victory points and will.", action: { kind: "none" } });
      push({
        id: key, kind: "objective", severity: o.state === "lost" ? "critical" : "warning", category: "strategy",
        title: o.state === "lost" ? `The enemy holds ${o.place}` : `${o.place} is contested`,
        situation: `"${o.name}" is ${o.state === "lost" ? "now held by the enemy" : "contested: neither side has a clear edge"}. An objective counts as held only with clearly more combat power in the area than the enemy.`,
        options: options.slice(0, 3).concat(options.length > 3 ? [options[options.length - 1]] : []), recommended: 0, where: o.center,
      });
    }

    // 4. A ceasefire offer.
    for (const e of inp.events) {
      if (e.seq <= this.lastSeq) continue;
      if (e.type === "INJECT" && e.factors?.kind === "CEASEFIRE_OFFER") {
        const lead = inp.brief.score.own - inp.brief.score.enemy;
        push({
          id: `ceasefire-${e.seq}`, kind: "ceasefire", severity: "warning", category: "strategy",
          title: "A mediator proposes a ceasefire",
          situation: `${e.text.replace(/^White cell inject: /, "")} We are ${lead > 5 ? "ahead" : lead < -5 ? "behind" : "level"} on victory points. Accepting signals restraint; the enemy may or may not reciprocate.`,
          options: [
            { label: cop.escalation > 0 ? "Accept: step down one rung" : "Accept: go defensive", detail: "De-escalate and go defensive. Preserves will and forces; gives the enemy room to regroup.", action: { kind: "multi", actions: [...(cop.escalation > 0 ? [{ kind: "escalate" as const, steps: -1 }] : []), { kind: "intent", posture: "DEFENSIVE" }] } },
            { label: "Reject: keep fighting", detail: "Keep the current plan and pressure.", action: { kind: "none" } },
          ],
          recommended: lead > 5 || cop.will < 40 ? 0 : 1,
        });
      }
    }
    this.lastSeq = inp.events.length ? inp.events[inp.events.length - 1].seq : this.lastSeq;

    // 5. A high-value target is identified and can be struck.
    const hv = cop.tracks
      .filter((t) => t.affiliation === "HOSTILE" && (t.quality === "IDENTIFIED" || t.quality === "TRACKED") && t.believedClass && HV_CLASSES.has(t.believedClass))
      .filter((t) => (t.believedDomain === "SEA" && cop.escalation >= 2) || (t.believedDomain === "LAND" && cop.escalation >= 3))
      .sort((a, b) => valueOf(b) - valueOf(a))[0];
    if (hv && this.ready(`target-${hv.id}`, now) && this.ready("target", now) && can("STRIKE_TOP")) {
      this.arm(`target-${hv.id}`, now, 1e6);
      this.arm("target", now, 6);
      const ofs = ownObjs.find((o) => o.state !== "held") ?? ownObjs[0];
      push({
        id: `target-${hv.id}`, kind: "target", severity: "warning", category: "intel",
        title: `Strike opportunity: enemy ${hasClass(hv.believedClass ?? "") ? getClass(hv.believedClass!).name.toLowerCase() : "target"} identified`,
        situation: `Intelligence has a firm track on ${hv.id}. Identified tracks go stale within hours if sensors lose them, so the window is now. Strikes use scarce munitions.`,
        options: [
          playOpt("STRIKE_TOP", undefined, "Strike it now"),
          ...(ofs ? [playOpt("ISR_SURGE", ofs.id, "Keep watching, strike later", "Surge surveillance to keep the track fresh and look for more targets; no munitions spent.")] : []),
          { label: "Ignore it", detail: "Save munitions for threats closer to our objectives.", action: { kind: "none" } },
        ],
        recommended: 0, where: [hv.lat, hv.lon],
      });
    }

    // 6. Supply running out.
    const dry = cop.units.filter((u) => u.supplyDays < 1 && (u.domain === "LAND" || u.domain === "SEA")).length;
    if (dry >= 3 && this.ready("supply", now)) {
      this.arm("supply", now, 12);
      const options: DecisionOption[] = [];
      if (can("RESUPPLY")) options.push(playOpt("RESUPPLY", undefined, "Send convoys and oilers"));
      if (can("PULL_BACK")) options.push(playOpt("PULL_BACK", undefined, "Pull back damaged units"));
      options.push({ label: "Press on", detail: "Accept slower movement and weaker fire for now.", action: { kind: "none" } });
      push({ id: "supply", kind: "supply", severity: "warning", category: "logistics", title: `${dry} units are nearly out of supply`, situation: "Units without fuel and munitions slow down, sortie less and miss more. Supply lines are also a target for the enemy.", options, recommended: 0 });
    }

    // 7. Communications breaking down.
    const total = cop.units.length || 1;
    if (inp.unreachable / total >= 0.25 && this.ready("comms", now)) {
      this.arm("comms", now, 12);
      const options: DecisionOption[] = [];
      if (can("JAM", ownObjs[0]?.id)) options.push(playOpt("JAM", cop.mainEffort ?? ownObjs[0]?.id, "Counter-jam and hit their command posts"));
      options.push({ label: "Ride it out", detail: "Cut-off units keep executing their last orders; links usually recover when jammers move or are destroyed.", action: { kind: "none" } });
      push({ id: "comms", kind: "comms", severity: "warning", category: "comms", title: `${Math.round((inp.unreachable / total) * 100)}% of our units are cut off`, situation: "Our orders cannot reach them, so they keep doing what they were last told. This is usually enemy jamming or the loss of a relay or satellite link.", options, recommended: 0 });
    }

    // 8. Heavy losses: will falling fast.
    const hist = inp.willHistory;
    if (hist.length >= 7) {
      const drop = hist[hist.length - 7][1] - hist[hist.length - 1][1];
      if (drop >= 8 && this.ready("losses", now)) {
        this.arm("losses", now, 18);
        const options: DecisionOption[] = [];
        if (can("PULL_BACK")) options.push(playOpt("PULL_BACK", undefined, "Pull back and regroup"));
        options.push({ label: "Go defensive", detail: POSTURE_INFO.DEFENSIVE.text, action: { kind: "intent", posture: "DEFENSIVE" } });
        options.push({ label: "Press the attack", detail: "Accept losses to win faster. Risky if will is already low.", action: { kind: "none" } });
        push({ id: "losses", kind: "losses", severity: cop.will < 35 ? "critical" : "warning", category: "strategy", title: `National will fell ${Math.round(drop)} points in 6 hours`, situation: `Will is now ${Math.round(cop.will)}. At zero we must seek terms and lose. Losses and civilian harm drive it down.`, options, recommended: cop.will < 40 ? 0 : options.length - 1 });
      }
    }
    return out;
  }
}

/** Short description of an action, used in the decision log ("You chose …"). */
export function describeAction(card: DecisionCard, idx: number): string {
  const o = card.options[idx];
  return o ? o.label : "No action";
}
