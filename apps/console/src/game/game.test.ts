// Command-post logic on a real headless run: the briefing ranks and merges reports, decisions offer
// only possible options, and the Ask interpreter answers and proposes actions from the faction view.
import { describe, expect, it } from "vitest";
import { Engine } from "@sentinel/engine";
import { RulesCommander } from "@sentinel/agents-rules";
import { getScenario } from "@sentinel/scenarios";
import type { EntityView, EventView, PoliticsView, TrackView, C2View, LogisticsView } from "@sentinel/protocol";
import { Briefer } from "./brief";
import { DecisionDesk } from "./decisions";
import { answer } from "./ask";
import { copFromView } from "./cop";
import { placeName, where } from "./places";
import { SEVERITY_RANK } from "./types";

const scn = getScenario("strait-crisis")!;

/** Runs Strait Crisis with rules agents and collects Blue's own view, as the console would hold it. */
function blueView(hours: number) {
  const eng = Engine.create(scn, 5);
  const cmd = new RulesCommander(new Set(["blue.nca"]));
  const entities = new Map<string, EntityView>();
  let tracks: TrackView[] = [], politics: PoliticsView | null = null, c2: C2View[] = [], logistics: LogisticsView[] = [];
  const events: EventView[] = [];
  const apply = (d: ReturnType<Engine["viewSnapshot"]>) => {
    for (const e of d.entities ?? []) entities.set(e.id, e);
    if (d.tracks) tracks = d.tracks;
    if (d.politics) politics = d.politics;
    if (d.c2) c2 = d.c2;
    if (d.logistics) logistics = d.logistics;
    events.push(...(d.events ?? []));
  };
  apply(eng.viewSnapshot("BLUE"));
  for (let i = 0; i < hours * 60; i++) {
    const r = eng.step();
    if (r.cops) for (const f of ["BLUE", "RED"] as const) for (const d of cmd.decide(r.cops[f])) if (d.orders.length) eng.submit({ faction: f, from: d.agent, batch: d, source: "RULES" });
    apply(eng.drain().views.BLUE);
  }
  return { simMs: eng.state.simMs, tick: eng.state.tick, entities, tracks, politics, c2, logistics, events };
}

const view = blueView(10);
const input = { side: "BLUE" as const, scenario: scn, ...view };

describe("staff briefing", () => {
  const brief = new Briefer("BLUE").update(input);

  it("leads with a one-line bottom line and scores both sides", () => {
    expect(brief.headline.length).toBeGreaterThan(10);
    expect(brief.score.own).toBeGreaterThan(0);
    expect(brief.objectives.filter((o) => o.mine).map((o) => o.place)).toEqual(["Meridian Strait", "Meridian Island"]);
  });

  it("ranks reports most severe first and merges repeats", () => {
    const ranks = brief.alerts.map((a) => SEVERITY_RANK[a.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(brief.alerts.length).toBeLessThan(view.events.length / 3);
    expect(brief.alerts.some((a) => a.count > 1)).toBe(true);
  });

  it("never names enemy units it cannot see", () => {
    const enemyIds = /\bR-[A-Z]+-\d+\b/;
    for (const a of brief.alerts) expect(`${a.title} ${a.detail ?? ""} ${a.entity ?? ""}`).not.toMatch(enemyIds);
  });

  it("offers a status tile for each key number, each with a drill-down", () => {
    expect(brief.tiles.map((t) => t.id)).toEqual(["objectives", "score", "forces", "will", "escalation", "supply", "comms", "intel"]);
    for (const t of brief.tiles) expect(t.drill).toBeTruthy();
  });
});

describe("decision desk", () => {
  const brief = new Briefer("BLUE").update(input);
  const cop = copFromView("BLUE", view);

  it("asks for the commander's intent first, and only once", () => {
    const desk = new DecisionDesk();
    const args = { side: "BLUE" as const, level: "recruit" as const, simMs: view.simMs, cop, brief, events: view.events, unreachable: 0, willHistory: [] };
    const first = desk.detect(args, new Set());
    expect(first[0]?.kind).toBe("intent");
    expect(desk.detect(args, new Set()).some((c) => c.kind === "intent")).toBe(false);
  });

  it("gives every card a recommended, possible option and a deadline above Recruit", () => {
    const desk = new DecisionDesk();
    const cards = desk.detect({ side: "BLUE", level: "officer", simMs: view.simMs, cop: { ...cop, mainEffort: "B1", enemyEscalation: cop.escalation + 1 }, brief, events: view.events, unreachable: 0, willHistory: [] }, new Set());
    const esc = cards.find((c) => c.kind === "escalation")!;
    expect(esc).toBeTruthy();
    expect(esc.deadlineMs).toBeGreaterThan(view.simMs);
    for (const c of cards) expect(c.options[c.recommended]).toBeTruthy();
  });
});

describe("ask your staff", () => {
  const brief = new Briefer("BLUE").update(input);
  const ctx = { side: "BLUE" as const, scenario: scn, brief, cards: [], unreachable: [], ...view };

  it("answers status, objectives and supply questions in plain words", () => {
    expect(answer("How are we doing?", ctx).text).toBe(brief.headline);
    expect(answer("what do we need to do", ctx).bullets?.[0]).toMatch(/Keep the Meridian Strait open/);
    expect(answer("who is low on supply?", ctx).text).toMatch(/supply/i);
  });

  it("finds our units and enemy contacts and moves the map to them", () => {
    const unit = [...view.entities.values()].find((e) => e.faction === "BLUE" && e.cls === "csg")!;
    const r = answer(`where is ${unit.callsign}`, ctx);
    expect(r.select).toBe(unit.id);
    expect(r.focus).toBeTruthy();
    expect(answer("where are our destroyers", ctx).bullets?.length).toBeGreaterThan(0);
    const enemy = answer("where is the enemy fleet?", ctx);
    expect(enemy.text).toMatch(/We (see|have no)/);
  });

  it("turns orders into confirmable actions and time controls into immediate ones", () => {
    expect(answer("go defensive", ctx).action?.action).toEqual({ kind: "intent", posture: "DEFENSIVE" });
    expect(answer("focus on the island", ctx).action?.action).toEqual({ kind: "intent", objective: "B2" });
    expect(answer("escalate", ctx).action?.action).toEqual({ kind: "escalate", steps: 1 });
    expect(answer("pause", ctx).control).toBe("pause");
    expect(answer("faster", ctx).control).toBe("faster");
  });

  it("explains game terms", () => {
    expect(answer("what is a kill chain?", ctx).text).toMatch(/^Kill chain:/);
    expect(answer("what does ROE mean", ctx).text).toMatch(/^Rules of engagement:/);
  });
});

describe("places", () => {
  it("names objectives by place, resolving generic words to the real place", () => {
    const r2 = scn.factions.find((f) => f.id === "RED")!.objectives.find((o) => o.id === "R2")!;
    expect(placeName(scn, r2)).toBe("Meridian Strait");
    expect(where(scn, [-40.0, 148.05])).toBe("at Meridian Island");
    expect(where(scn, [-41.6, 146.36])).toMatch(/km [NESW]+ of /);
  });
});
