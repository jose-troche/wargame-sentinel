// FactionAgent: one per faction per session. Holds only that faction's COP (never ground truth),
// runs every staff and command role on its cadence, spends neurons only after UsageDO approves,
// and falls back to the rule-based policy when the budget is spent or the model misbehaves.
// Invariant: this file must not import @sentinel/engine (ground-truth types live there).
import { Agent } from "agents";
import {
  ROLE_INFO, agentId, extractJson, parseOrderBatchLenient, type OrderBatch, fmtSimTime, type CopForAgents, type Decision, type EventView, type Faction, type Order, type Role,
} from "@sentinel/protocol";
import { rolesDue, rulePolicy } from "@sentinel/agents-rules";
import { roleCanCommand } from "@sentinel/catalog";
import { buildAarPrompt, buildPrompt, estimateNeurons, modelFor, neuronsFor } from "./prompts";

export interface FactionAgentState {
  sessionId: string;
  faction: Faction | "WHITE";
  factionName: string;
  last: Partial<Record<Role, number>>;
  humanSeats: string[];
  rulesOnly: boolean;
  memory: Partial<Record<Role, string>>;
  budgetLeft: number;
}

export interface AarNarrative {
  summary: string;
  turningPoints: { title: string; text: string; simMs?: number; events: number[] }[];
  counterfactuals: { text: string; events: number[] }[];
  source: "LLM" | "RULES";
}

const LLM_ROLES: Role[] = ["nca", "jfc", "lcc", "mcc", "acc", "scc", "cyber", "j2", "j5"];

function coarseKey(role: Role, cop: CopForAgents): string {
  const bucket = (n: number) => Math.min(9, Math.floor(n / 4));
  const by = (d: string) => bucket(cop.tracks.filter((t) => t.affiliation === "HOSTILE" && t.believedDomain === d).length);
  return [role, cop.escalation, cop.enemyEscalation, by("LAND"), by("SEA"), by("AIR"), by("DRONE"), cop.objectives.map((o) => o.holder[0]).join(""), Math.floor(cop.will / 20)].join(":");
}

export class FactionAgent extends Agent<Env, FactionAgentState> {
  override initialState: FactionAgentState = {
    sessionId: "", faction: "BLUE", factionName: "", last: {}, humanSeats: [], rulesOnly: false, memory: {}, budgetLeft: 0,
  };

  override async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS cop (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT, sim_ms INTEGER)`;
    this.sql`CREATE TABLE IF NOT EXISTS prompt_log (id TEXT PRIMARY KEY, role TEXT, sim_ms INTEGER, model TEXT, prompt TEXT, response TEXT, neurons REAL, source TEXT, created_at INTEGER)`;
    this.sql`CREATE TABLE IF NOT EXISTS decision_cache (key TEXT PRIMARY KEY, sim_ms INTEGER, json TEXT)`;
  }

  async init(sessionId: string, faction: Faction | "WHITE", factionName: string, rulesOnly: boolean, budget: number) {
    this.setState({ ...this.state, sessionId, faction, factionName, rulesOnly, budgetLeft: budget });
  }

  async setRulesOnly(v: boolean) {
    this.setState({ ...this.state, rulesOnly: v });
  }

  async seatTakeover(role: Role, holder: string | null) {
    const id = agentId(this.state.faction as Faction, role);
    const seats = new Set(this.state.humanSeats);
    if (holder) seats.add(id);
    else seats.delete(id);
    this.setState({ ...this.state, humanSeats: [...seats] });
  }

  /** RPC from SessionDO once per simulated hour. */
  async onCopUpdate(cop: CopForAgents) {
    const json = JSON.stringify(cop);
    this.sql`INSERT OR REPLACE INTO cop (id, json, sim_ms) VALUES (1, ${json}, ${cop.simMs})`;
    const due = rolesDue(cop, this.state.last, new Set(this.state.humanSeats));
    if (!due.length) return;
    const hour = Math.round(cop.simMs / 3_600_000);
    const last = { ...this.state.last };
    for (const r of due) last[r] = hour;
    this.setState({ ...this.state, last });
    // Decide asynchronously so the hub's RPC returns at once; commanders after staff.
    await this.schedule(0, "decideMany", { roles: due });
  }

  async decideMany({ roles }: { roles: Role[] }) {
    for (const role of roles) {
      try {
        await this.decide(role);
      } catch (err) {
        console.error(JSON.stringify({ session: this.state.sessionId, faction: this.state.faction, role, error: String(err) }));
      }
    }
  }

  private readCop(): CopForAgents | null {
    const row = this.sql<{ json: string }>`SELECT json FROM cop WHERE id = 1`[0];
    return row ? (JSON.parse(row.json) as CopForAgents) : null;
  }

  private async decide(role: Role) {
    const cop = this.readCop();
    if (!cop) return;
    const faction = cop.faction;
    let decision: Decision | null = null;
    const key = coarseKey(role, cop);
    const cached = this.sql<{ json: string; sim_ms: number }>`SELECT json, sim_ms FROM decision_cache WHERE key = ${key}`[0];
    if (cached && cop.simMs - cached.sim_ms < 6 * 3_600_000 && role !== "j2") {
      const prev = JSON.parse(cached.json) as Decision;
      decision = { ...prev, id: crypto.randomUUID(), simMs: cop.simMs, source: "CACHE", rationale: `(cached) ${prev.rationale}`.slice(0, 600) };
    }
    if (!decision && !this.state.rulesOnly && LLM_ROLES.includes(role)) decision = await this.llmDecide(role, cop);
    if (!decision) {
      const r = rulePolicy(role, cop);
      decision = { ...r, id: crypto.randomUUID(), agent: agentId(faction, role), role, faction, simMs: cop.simMs, source: "RULES", budgetLeft: this.state.budgetLeft };
    } else if (decision.source === "LLM") {
      this.sql`INSERT OR REPLACE INTO decision_cache (key, sim_ms, json) VALUES (${key}, ${cop.simMs}, ${JSON.stringify(decision)})`;
    }
    // Rolling 150-word plan memory per role.
    const mem = `${fmtSimTime(cop.simMs)}: ${decision.rationale}`.split(/\s+/).slice(0, 150).join(" ");
    this.setState({ ...this.state, memory: { ...this.state.memory, [role]: mem } });
    console.log(JSON.stringify({ session: this.state.sessionId, faction, role, source: decision.source, neurons: decision.neurons ?? 0 }));
    const session = this.env.SESSION.get(this.env.SESSION.idFromName(`session:${this.state.sessionId}`));
    await session.submitAgentOrders(faction as "BLUE" | "RED", role, decision);
  }

  /** Per-model call shaping: Qwen3 thinking off, gpt-oss low reasoning effort, plain JSON in the text. */
  private async callModel(model: string, messages: { role: "system" | "user" | "assistant"; content: string }[], maxTokens: number) {
    const ai = this.env.AI as unknown as { run: (m: string, i: unknown) => Promise<unknown> };
    let msgs = messages;
    const extra: Record<string, unknown> = {};
    if (model.includes("qwen3")) {
      msgs = messages.map((m, i) => (i === messages.length - 1 && m.role === "user" ? { ...m, content: `${m.content}\n/no_think` } : m));
    }
    if (model.includes("gpt-oss")) extra.reasoning_effort = "low";
    try {
      return await ai.run(model, { messages: msgs, max_tokens: maxTokens, ...extra });
    } catch {
      // Some models reject extra parameters; retry in the plainest form.
      return await ai.run(model, { messages: msgs, max_tokens: maxTokens });
    }
  }

  private async llmDecide(role: Role, cop: CopForAgents): Promise<Decision | null> {
    const model = modelFor(role, this.env);
    const messages = buildPrompt(role, cop, this.state.factionName, this.state.memory[role] ?? "");
    const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
    const maxOut = model.includes("gpt-oss") ? 2000 : role === "j2" ? 400 : 1200;
    const estimate = estimateNeurons(model, promptChars, maxOut);
    const usage = this.env.USAGE.get(this.env.USAGE.idFromName("global"));
    const gate = await usage.canSpend(this.state.sessionId, estimate);
    if (!gate.ok) {
      this.setState({ ...this.state, budgetLeft: gate.left });
      return null;
    }
    let spent = 0;
    let parsed: { batch: OrderBatch; dropped: number } | null = null;
    let raw: unknown = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const msgs = attempt === 0 ? messages : [...messages, { role: "user" as const, content: "Your previous output was not a valid JSON object for the schema. Return only the JSON object." }];
      try {
        raw = await this.callModel(model, msgs, maxOut);
      } catch (err) {
        console.error(JSON.stringify({ session: this.state.sessionId, role, model, error: String(err) }));
        break;
      }
      const u = (raw as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
      spent += u?.prompt_tokens ? neuronsFor(model, u.prompt_tokens, u.completion_tokens ?? maxOut / 2) : estimate;
      parsed = parseOrderBatchLenient(extractJson(raw));
      if (!parsed && attempt === 0) {
        const again = await usage.canSpend(this.state.sessionId, estimate);
        if (!again.ok) break;
      }
    }
    const left = await usage.record(this.state.sessionId, spent);
    this.setState({ ...this.state, budgetLeft: left });
    const promptText = messages.map((m) => m.content).join("\n---\n");
    const responseText = JSON.stringify(raw).slice(0, 8000);
    const logId = crypto.randomUUID();
    if (!parsed) {
      this.sql`INSERT INTO prompt_log (id, role, sim_ms, model, prompt, response, neurons, source, created_at) VALUES (${logId}, ${role}, ${cop.simMs}, ${model}, ${promptText}, ${responseText}, ${spent}, ${"INVALID"}, ${Date.now()})`;
      return null;
    }
    // Keep only orders this role may give to units that exist; note what was dropped.
    const own = new Map(cop.units.map((u) => [u.id, u]));
    const kept: Order[] = [];
    let dropped = parsed.dropped;
    for (const o of parsed.batch.orders) {
      const unit = own.get(o.to);
      const toAgent = /^(blue|red)\.[a-z0-9]+$/.test(o.to);
      if (["ROE", "ESCALATE", "DEESCALATE", "PRIORITY"].includes(o.type) || toAgent || (unit && roleCanCommand(role, unit))) kept.push(o);
      else dropped++;
    }
    this.sql`INSERT INTO prompt_log (id, role, sim_ms, model, prompt, response, neurons, source, created_at) VALUES (${logId}, ${role}, ${cop.simMs}, ${model}, ${promptText}, ${responseText}, ${spent}, ${"LLM"}, ${Date.now()})`;
    this.sql`DELETE FROM prompt_log WHERE id NOT IN (SELECT id FROM prompt_log ORDER BY created_at DESC LIMIT 500)`;
    return {
      orders: kept,
      rationale: (dropped ? `${parsed.batch.rationale} [${dropped} invalid order(s) dropped]` : parsed.batch.rationale).slice(0, 600),
      confidence: parsed.batch.confidence,
      id: logId, agent: agentId(cop.faction, role), role, faction: cop.faction, simMs: cop.simMs, source: "LLM", model,
      neurons: Math.round(spent * 10) / 10, budgetLeft: left,
    };
  }

  /** WHITE instance: the AAR Analyst, one larger-model call at session end. */
  async analyzeAar(summary: string, notable: EventView[]): Promise<AarNarrative | null> {
    if (this.state.rulesOnly || !notable.length) return null;
    const model = modelFor("aar", this.env);
    const list = notable.slice(0, 60).map((e) => ({ seq: e.seq, t: fmtSimTime(e.simMs), text: e.text.slice(0, 160) }));
    const messages = buildAarPrompt(summary, list);
    const usage = this.env.USAGE.get(this.env.USAGE.idFromName("global"));
    const estimate = estimateNeurons(model, messages.reduce((n, m) => n + m.content.length, 0), 2500);
    const gate = await usage.canSpend(this.state.sessionId, estimate, "aar");
    if (!gate.ok) return null;
    let raw: unknown;
    try {
      raw = await this.callModel(model, messages, 2500);
    } catch {
      return null;
    }
    const u = (raw as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
    await usage.record(this.state.sessionId, u?.prompt_tokens ? neuronsFor(model, u.prompt_tokens, u.completion_tokens ?? 1500) : estimate);
    const json = extractJson(raw) as Partial<AarNarrative> | null;
    this.sql`INSERT INTO prompt_log (id, role, sim_ms, model, prompt, response, neurons, source, created_at) VALUES (${crypto.randomUUID()}, ${"aar"}, ${0}, ${model}, ${messages[1].content}, ${JSON.stringify(raw).slice(0, 8000)}, ${estimate}, ${"AAR"}, ${Date.now()})`;
    if (!json || typeof json.summary !== "string" || !Array.isArray(json.turningPoints)) return null;
    const valid = new Set(list.map((e) => e.seq));
    const tps = json.turningPoints
      .filter((t) => t && typeof t.title === "string" && Array.isArray(t.events))
      .map((t) => ({ title: String(t.title).slice(0, 120), text: String(t.text ?? "").slice(0, 400), events: t.events.map(Number).filter((s) => valid.has(s)) }))
      .filter((t) => t.events.length > 0);
    if (!tps.length) return null; // acceptance: every turning point must link to a real event
    const cfs = (json.counterfactuals ?? [])
      .map((c) => ({ text: String(c?.text ?? "").slice(0, 300), events: (c?.events ?? []).map(Number).filter((s) => valid.has(s)) }))
      .filter((c) => c.text && c.events.length);
    return { summary: json.summary.slice(0, 1200), turningPoints: tps, counterfactuals: cfs, source: "LLM" };
  }

  /** NFR-09 audit: prompts, responses and sources, newest first. */
  async auditLog(limit = 50) {
    return this.sql<{ id: string; role: string; sim_ms: number; model: string; prompt: string; response: string; neurons: number; source: string; created_at: number }>`
      SELECT id, role, sim_ms, model, prompt, response, neurons, source, created_at FROM prompt_log ORDER BY created_at DESC LIMIT ${limit}`;
  }

  async status() {
    return { ...this.state, roles: Object.keys(ROLE_INFO) };
  }
}
