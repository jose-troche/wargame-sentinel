// UsageDO: the account-wide quota governor. Counters live in SQLite (KV allows only 1,000 writes a day).
// Every LLM call asks canSpend() first; sessions get a neuron grant with a reserve for the AAR call.
import { DurableObject } from "cloudflare:workers";

const AAR_RESERVE = 400;

export interface UsageStats {
  day: string;
  neurons: number;
  dailyLimit: number;
  doRequests: number;
  sessions: number;
  llmCalls: number;
  grants: { session: string; granted: number; used: number }[];
}

const today = () => new Date().toISOString().slice(0, 10);

export class UsageDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, neurons INTEGER DEFAULT 0, do_requests INTEGER DEFAULT 0, sessions INTEGER DEFAULT 0, llm_calls INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS grants (session_id TEXT PRIMARY KEY, day TEXT, granted INTEGER, used INTEGER DEFAULT 0);
      `);
    });
  }

  private limit() {
    return Number(this.env.DAILY_NEURON_LIMIT || 10000);
  }

  private row(day = today()) {
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO daily (day) VALUES (?)", day);
    return this.ctx.storage.sql.exec<{ neurons: number; do_requests: number; sessions: number; llm_calls: number }>("SELECT neurons, do_requests, sessions, llm_calls FROM daily WHERE day = ?", day).one();
  }

  /** Grants a session its slice of today's neuron allowance. */
  async registerSession(sessionId: string, requested?: number): Promise<number> {
    const d = this.row();
    const remaining = Math.max(0, this.limit() - d.neurons);
    const granted = Math.min(requested ?? Number(this.env.SESSION_NEURON_GRANT || 6000), remaining);
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO grants (session_id, day, granted, used) VALUES (?, ?, ?, 0)", sessionId, today(), granted);
    this.ctx.storage.sql.exec("UPDATE daily SET sessions = sessions + 1 WHERE day = ?", today());
    // Keep 30 days of daily rows.
    this.ctx.storage.sql.exec("DELETE FROM daily WHERE day < ?", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
    return granted;
  }

  /** Answers before every LLM call. The AAR call may dip into the reserve. */
  async canSpend(sessionId: string, neurons: number, purpose: "decision" | "aar" = "decision"): Promise<{ ok: boolean; left: number }> {
    const d = this.row();
    const g = this.ctx.storage.sql.exec<{ granted: number; used: number }>("SELECT granted, used FROM grants WHERE session_id = ?", sessionId).toArray()[0];
    if (!g) return { ok: false, left: 0 };
    const reserve = purpose === "aar" ? 0 : AAR_RESERVE;
    const left = g.granted - g.used - reserve;
    const ok = neurons <= left && d.neurons + neurons <= this.limit();
    return { ok, left: Math.max(0, left) };
  }

  async record(sessionId: string, neurons: number): Promise<number> {
    const n = Math.max(0, Math.round(neurons));
    this.row();
    this.ctx.storage.sql.exec("UPDATE daily SET neurons = neurons + ?, llm_calls = llm_calls + 1 WHERE day = ?", n, today());
    this.ctx.storage.sql.exec("UPDATE grants SET used = used + ? WHERE session_id = ?", n, sessionId);
    const g = this.ctx.storage.sql.exec<{ granted: number; used: number }>("SELECT granted, used FROM grants WHERE session_id = ?", sessionId).toArray()[0];
    return g ? Math.max(0, g.granted - g.used) : 0;
  }

  async reportRequests(n: number) {
    this.row();
    this.ctx.storage.sql.exec("UPDATE daily SET do_requests = do_requests + ? WHERE day = ?", Math.round(n), today());
  }

  async stats(): Promise<UsageStats> {
    const d = this.row();
    const grants = this.ctx.storage.sql
      .exec<{ session_id: string; granted: number; used: number }>("SELECT session_id, granted, used FROM grants WHERE day = ? ORDER BY rowid DESC LIMIT 50", today())
      .toArray()
      .map((g) => ({ session: g.session_id, granted: g.granted, used: g.used }));
    return { day: today(), neurons: d.neurons, dailyLimit: this.limit(), doRequests: d.do_requests, sessions: d.sessions, llmCalls: d.llm_calls, grants };
  }
}
