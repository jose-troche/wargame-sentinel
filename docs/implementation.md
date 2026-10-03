# WARFARE SENTINEL — Implementation Plan: Cloudflare Free Tier

Oct 2, 2026 · @Jose

## 1. Approach and free-tier constraints

WARFARE SENTINEL fits the Cloudflare free tier by making the 10 ms CPU limit the central design constraint: the deterministic simulation engine runs in the session host's browser by default, while Cloudflare provides the authoritative session hub, fog-of-war routing, LLM agents, persistence and global delivery.

**Two deployment profiles from one codebase**

- **Profile B — Browser-compute (default).** The World Engine and Adjudicator run in a Web Worker in the White-cell host's browser. Durable Objects relay per-faction views, host the agents, validate orders and persist the event log. Supports the full spec scale (2,000 entities, tactical tick).
- **Profile A — Edge-authoritative (lite).** The same engine package runs inside a Durable Object, advanced in small alarm-driven slices that each fit 10 ms of CPU. Scale is capped at about 300 entities on the operational tick only. Used for headless demos and for players who must not trust a host.

The engine is one TypeScript package with no platform dependencies, so the profile is a deployment switch, not a fork. Upgrading to Workers Paid lifts Profile A to full scale (section 11).

**Free-tier limits that shape the design** (as of the date above)

| Resource | Free allowance | Design consequence |
| --- | --- | --- |
| Worker CPU time | 10 ms per invocation; Durable Objects follow the Workers plan limits | No heavy loops on the edge; engine in browser (B) or sliced across alarms (A) |
| Worker requests | 100,000 / day | Static assets are free and unlimited, so the console costs nothing to serve |
| Durable Object requests | 100,000 / day; incoming WebSocket messages billed at 20:1 | Batch deltas; one WebSocket per client; outgoing messages are free |
| Durable Object duration | 13,000 GB-s / day | WebSocket Hibernation API everywhere; hibernating objects are not billed |
| DO SQLite storage | 5 GB per account; 5 M rows read and 100,000 rows written / day | Batch events into one row per tick; roll old logs to R2 |
| Workers AI | 10,000 neurons / day, hard stop on Free | Small models, tight prompts, per-session neuron budgets, rule-based fallback |
| D1 | 5 GB; 5 M rows read and 100,000 rows written / day | Catalog, session index and AAR summaries only |
| KV | 100,000 reads and 1,000 writes / day | Read-mostly config only; never counters |
| R2 | 10 GB-month; 1 M Class A and 10 M Class B ops / month; free egress | Event-log archives, snapshots, replays |
| Queues | 10,000 operations / day | Not used on the hot path |
| Workers Logs | 200,000 events / day, 3-day retention | Sampled, structured logging |

All daily limits reset at 00:00 UTC. Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Durable Objects limits](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/durable-objects/platform/limits.mdx).

## 2. Deployment architecture

&#91;embedded content: deployment architecture · Profile B, with Profile A engine slices in SessionDO\]

The SessionDO is the hub: it is the only server component that sees ground truth, while FactionAgents hold only their own COP and spend neurons only after UsageDO approves.

## 3. Component mapping

Every spec component lands on exactly one runtime, and the boundary between Session and Faction objects is also the fog-of-war boundary: faction agents physically never receive ground truth.

| Spec component | Runtime (Profile B) | Runtime (Profile A) | Notes |
| --- | --- | --- | --- |
| Web console (12 consoles) | Static assets on the Worker, rendered in browser | Same | Served free; SPA fallback routing |
| World Engine + Adjudicator | Web Worker in host browser | `SessionDO`, alarm-sliced | Same `@sentinel/engine` package |
| Environment agent | Inside engine | Inside engine | Deterministic weather from seed |
| Scenario Director (injects) | `SessionDO` | `SessionDO` | Injects scheduled with DO alarms |
| Message bus + C2 network model | Engine computes delivery; `SessionDO` routes | `SessionDO` | Messages carry sim delivery time |
| Faction COP filtering | Host engine emits per-faction deltas; `SessionDO` routes by socket tag | `SessionDO` | Ground truth only reaches WHITE sockets |
| NCA, JFC, component commanders, J2/J4/J5 summaries | `FactionAgent` DO (one per faction per session) | Same | Agents SDK; Workers AI calls |
| Tactical controllers (behavior trees) | Inside engine | Inside engine | No LLM; deterministic |
| AAR Analyst | `FactionAgent` with role WHITE, run once at session end | Same | One larger-model call |
| Quota governor | `UsageDO` (singleton) | Same | Tracks neurons, DO requests, per-session budgets |
| Event log (hot) | `SessionDO` SQLite | Same | One row per tick batch |
| Event log (archive), snapshots, replays | R2 | R2 | Written at session end and hourly |
| Scenario catalog, session index, AAR summaries | D1 | D1 | Low write volume |
| Asset catalogue, feature flags | KV (read-mostly) + bundled JSON | Same | Bundled copy is the fallback |
| Monte Carlo batch runs | Browser Web Workers (N seeds in parallel) | Not offered | Free; results uploaded as one summary |
| Auth | Signed join tokens (HMAC via Web Crypto) + Turnstile on session creation | Same | Optional Cloudflare Access for class rosters |

## 4. Durable Object design

Three SQLite-backed classes carry all server state: `SessionDO` (one per session), `FactionAgent` (one per faction per session) and `UsageDO` (one per account).

**`SessionDO` responsibilities**

- WebSocket hub using the Hibernation API: `ctx.acceptWebSocket(ws, ["view:BLUE", "seat:blue.jfacc"])` tags each socket, and `ctx.getWebSockets("view:BLUE")` fans a delta out to exactly that faction.
- Order intake: validates that the sender holds the seat, stamps sim time, appends to the event log, forwards to the engine (host socket in B, local engine in A).
- Agent bridge: pushes each faction's COP delta to its `FactionAgent` once per simulated hour, and receives orders back over RPC.
- Scenario Director: schedules injects as alarms.
- Persistence: hot event log in SQLite; hourly snapshot to R2; full archive to R2 on session end.

**Profile A tick slicing.** One alarm invocation may use only 10 ms of CPU, so a tick is a resumable job:

1. Alarm fires; load the tick cursor `{tick, phase, offset}` from SQLite.
2. Run one slice of the current phase (movement → sensing → C2 delivery → engagements → logistics), processing a fixed number of work units.
3. Save the cursor and state changes in one transaction.
4. If the tick is unfinished, `setAlarm(Date.now())` to continue at once; otherwise broadcast the delta and schedule the next tick at its wall-clock time.

Work units per slice are calibrated offline with benchmarks, not measured at runtime: inside Workers, `Date.now()` and `performance.now()` do not advance during pure computation (a timing-attack mitigation), so a CPU-budget loop cannot see its own CPU use. Ship conservative defaults (for example 40 entity-moves or 150 sensor-pair checks per slice) and tune them in `wrangler dev` with production-like scenarios.

**`SessionDO` SQLite schema**

```sql
CREATE TABLE meta      (k TEXT PRIMARY KEY, v TEXT);              -- scenario ref, seed, speed, status, profile
CREATE TABLE seats     (agent_id TEXT PRIMARY KEY, faction TEXT, holder TEXT, since INTEGER);
CREATE TABLE events    (seq INTEGER PRIMARY KEY, tick INTEGER, sim_ms INTEGER, batch BLOB);  -- msgpack array of events per tick
CREATE TABLE orders    (id TEXT PRIMARY KEY, faction TEXT, from_agent TEXT, sim_ms INTEGER, body BLOB, state TEXT);
CREATE TABLE cursor    (id INTEGER PRIMARY KEY CHECK (id = 1), tick INTEGER, phase TEXT, offset INTEGER);
CREATE TABLE entity_shards (shard INTEGER PRIMARY KEY, state BLOB);  -- Profile A only; ~40 entities per msgpack blob
CREATE INDEX events_tick ON events(tick);
```

Entity state is stored as shard blobs rather than one row per entity because the free tier meters rows written, not bytes: a slice that rewrites one 40-entity blob costs 1 row instead of 40.

**`FactionAgent`** extends the Agents SDK `Agent` class, so it gets per-instance SQLite, scheduling, and state sync for free. It stores the faction COP (never ground truth), each role's plan and memory summary, the message history, and the neuron budget it was granted. Its methods are exposed over RPC: `onCopUpdate(delta)`, `onReport(msg)`, `requestDecision(role)`, `seatTakeover(role, user)`.

**`UsageDO`** keeps daily counters in SQLite (neurons, DO requests estimated, sessions started) and hands each new session a budget slice. It answers `canSpend(sessionId, neurons)` before every LLM call. KV is deliberately not used for counters because the free tier allows only 1,000 writes per day.

**Naming and placement.** `idFromName("session:" + sessionId)` and `idFromName("faction:" + sessionId + ":BLUE")`; pass a `locationHint` near the host when creating the session so the hub sits close to the White cell.

## 5. Agent runtime

At roughly 24 neurons per operational decision, the free 10,000-neuron allowance buys about 400 LLM decisions a day, so the runtime is built around small mixture-of-experts models, compact prompts and a governor that falls back to rule-based play when the budget runs out.

**Model assignment** (Workers AI, rates from the [pricing page](https://developers.cloudflare.com/workers-ai/platform/pricing/))

| Role | Model | Rate (neurons per M tokens, in / out) | Typical call (tokens in / out) | Neurons per call |
| --- | --- | --- | --- | --- |
| Component commanders, JFC, J5 | `@cf/qwen/qwen3-30b-a3b-fp8` | 4,625 / 30,475 | 2,500 / 400 | \~24 |
| National Command Authority | `@cf/openai/gpt-oss-120b` | 31,818 / 68,182 | 3,000 / 500 | \~130 |
| J2 INTSUM and rationale summaries | `@cf/ibm-granite/granite-4.0-h-micro` | 1,542 / 10,158 | 1,500 / 200 | \~4 |
| AAR Analyst (once per session) | `@cf/openai/gpt-oss-120b` | 31,818 / 68,182 | 8,000 / 1,500 | \~357 |

Model ids are configuration, not code, so a cheaper or better model can be swapped in without a redeploy.

**Decision loop (per role)**

1. Trigger: the role's cadence (via the Agents SDK `this.schedule()`), or an event trigger such as a unit loss, a new high-confidence threat or an escalation change, debounced to at most one decision per role per 30 simulated minutes.
2. Budget check: `UsageDO.canSpend(sessionId, estimate)`; if denied, run the rule-based policy and mark the order "RULES".
3. Prompt assembly: role card, ROE for the current escalation rung, the top 25 relevant COP tracks as a compact table, current plan, J4 sustainment limits, and the output JSON schema.
4. Call `env.AI.run(model, { messages, response_format })` using JSON mode where the model supports it.
5. Validate with the shared Zod schema from `@sentinel/protocol`; one repair retry on failure, then fallback.
6. Send orders to `SessionDO` with the rationale; log prompt, response and orders (NFR-09).

**Order output schema (abridged)**

```json
{
  "orders": [
    {
      "type": "FRAGO",
      "to": "blue.wing.12",
      "task": "CAP",
      "area_h3": "85283473fffffff",
      "window_sim_h": [62, 66],
      "roe": "WEAPONS_TIGHT"
    }
  ],
  "rationale": "Protect tanker track ALPHA from detected fighter activity.",
  "confidence": 0.7
}
```

**Rule-based fallback.** Each role has a utility-AI policy in `@sentinel/agents-rules` that scores a fixed menu of actions (hold, reinforce, strike highest-value track in range, withdraw, request ISR) from COP features. Fallback orders are flagged in the Agent Reasoning Console, which also makes LLM-versus-rules comparisons an interesting teaching feature.

**Cost controls**

- Decision cache: a hash of (role, coarse COP features, plan phase) maps to a recent decision in agent SQLite; a hit skips the model call.
- Prompt compaction: tracks as fixed-width rows, H3 ids instead of coordinates, no prose history beyond a rolling 150-word memory summary.
- Session budgets: `UsageDO` grants each session a slice (default 6,000 neurons) and keeps a reserve for the AAR call.
- Guardrail text in every system prompt keeps reasoning at game-abstraction level, per spec section 10.

## 6. Web console build

The console is a React single-page app served as Worker static assets (free and unlimited), with the globe, orbits and charts all rendered client-side so that smooth animation costs no server requests.

**Stack**

| Concern | Choice | Why |
| --- | --- | --- |
| App shell | React + Vite + TypeScript, Zustand store | Fast builds; one store fed by the delta stream |
| Dockable panels | dockview (or FlexLayout) | Twelve consoles as tabs, splits and pop-outs |
| Globe and theater map | MapLibre GL JS globe projection + deck.gl layers | Instanced icon layers handle 5,000 symbols at 60 fps |
| Basemap | Natural Earth vector tiles (zoom 0–6) pre-built with tippecanoe, shipped as static assets | No tile server, no third-party key, zero request cost |
| Unit symbology | milsymbol, pre-rendered into a sprite atlas at build time | APP-6-style symbols without per-frame SVG work |
| Orbital console | three.js; orbits propagated client-side from elements (same code as engine) | Smooth motion and ground tracks with no traffic |
| C2 graph, kill chain swimlanes, Sankey, escalation ladder | D3 (d3-force, d3-sankey) | Full control over teaching-oriented visuals |
| Charts (AAR, sortie gauges, will curves) | visx or Recharts | Standard charts |
| Geospatial index | h3-js | Shared with engine |
| Engine host (Profile B) | Dedicated Web Worker running `@sentinel/engine` | Keeps the UI thread free |
| Monte Carlo | Pool of Web Workers, one seed each | Uses the user's cores, not the free tier |

**WebSocket protocol** (MessagePack frames over one socket per client)

| Frame | Direction | Content |
| --- | --- | --- |
| `HELLO` | client → hub | Join token, requested view (BLUE, RED, WHITE), client version |
| `SNAPSHOT` | hub → client | Full view state at a tick (from R2 snapshot + replayed events) |
| `DELTA` | host → hub → clients | Changed entities or tracks per tick, quantized positions, status bits |
| `EVENT` | hub → clients | Adjudication events visible to that view |
| `MSG` | hub → clients | C2 message trace (orders and reports) for the C2 Network and Kill Chain consoles |
| `RATIONALE` | hub → clients | Agent decision, rationale text, LLM or RULES badge, budget left |
| `ORDER` | client → hub | Order from a human-held seat |
| `CONTROL` | client → hub | Pause, speed, branch, seat takeover (owner only for time controls) |

**Request economy rules**

- The host sends at most one `DELTA` per second of wall time, coalescing ticks; at 20:1 billing that is 180 billed requests per hour.
- Viewers send almost nothing upstream; WebSocket pings are free and keep sockets alive while the hub hibernates.
- Clients reconnect with the last applied sequence number and receive only missing events.

**Determinism across browser and edge.** Both run V8, but transcendental `Math` functions are not guaranteed identical across engine versions. The engine therefore uses its own polynomial `sin`, `cos`, `atan2` and `exp`, a seeded xoshiro128\*\* generator, and never reads `Date` or `Math.random`, so a replay produces the same log on any machine.

## 7. Storage layout

Hot, per-session state lives in Durable Object SQLite next to the code that uses it; anything that outlives a session moves to R2 (bulk) or D1 (queryable), and KV holds only read-mostly configuration.

| Store | Holds | Write pattern | Retention |
| --- | --- | --- | --- |
| `SessionDO` SQLite | Seats, orders, tick-batched events, cursor, entities (Profile A) | One transaction per tick or slice | Deleted 7 days after session end, after archive |
| `FactionAgent` SQLite | Faction COP, plans, memory summaries, prompt/response log, decision cache | Per decision and per COP push | Deleted with the session |
| `UsageDO` SQLite | Daily counters, session budget grants | Per LLM call | 30 days of daily rows |
| R2 `sentinel-archive` | `sessions/{id}/events-{n}.msgpack.gz`, `snapshots/{tick}.msgpack.gz`, `aar.json`, Monte Carlo summaries | Hourly snapshot; archive on end | Until deleted by owner |
| D1 `sentinel` | Scenario catalog, session index, AAR metrics, user-to-session links | A few rows per session | Permanent |
| KV `SENTINEL_CONFIG` | Asset catalogue version pointer, feature flags, model ids | Manual, a few per day | Permanent |
| Static assets | Console bundle, basemap tiles, symbol atlas, bundled catalogue and starter scenarios | Per deploy | Per deploy |

**D1 schema**

```sql
CREATE TABLE scenarios (id TEXT PRIMARY KEY, name TEXT, version TEXT, scale TEXT, r2_key TEXT, created_at INTEGER);
CREATE TABLE sessions  (id TEXT PRIMARY KEY, scenario_id TEXT, owner TEXT, profile TEXT, seed INTEGER,
                        status TEXT, created_at INTEGER, ended_at INTEGER, archive_key TEXT);
CREATE TABLE aar       (session_id TEXT PRIMARY KEY, metrics_json TEXT, narrative_key TEXT);
CREATE TABLE members   (session_id TEXT, user TEXT, view TEXT, PRIMARY KEY (session_id, user));
CREATE INDEX sessions_owner ON sessions(owner, created_at);
```

**Size check.** A 3-day Strait Crisis run produces about 430 tick batches; at roughly 20 KB compressed each that is under 10 MB per session in R2, so the 10 GB free R2 allowance holds about a thousand archived sessions.

## 8. Free-tier budget

Workers AI neurons are the only binding constraint: a full AI-versus-AI session uses about 60% of the daily neuron allowance, while every other resource stays under 7%.

**Reference session:** Strait Crisis, first 3 simulated days in 90 minutes of wall time, Profile B, 1 host plus 10 viewers, both factions AI-controlled.

**Agent cadence used for the estimate**

| Role (per faction) | Decisions per sim day | Model | Calls over 3 days, 2 factions | Neurons |
| --- | --- | --- | --- | --- |
| Component commanders (5) | 3 each | qwen3-30b-a3b | 90 | \~2,160 |
| Joint Force Commander | 4 | qwen3-30b-a3b | 24 | \~580 |
| J5 courses of action | 2 | qwen3-30b-a3b | 12 | \~290 |
| National Command Authority | 2 | gpt-oss-120b | 12 | \~1,560 |
| J2 summaries | 12 | granite-4.0-h-micro | 72 | \~290 |
| AAR Analyst | once per session | gpt-oss-120b | 1 | \~360 |
| **Total** |  |  | **211** | **\~5,240** |

Event-triggered decisions add roughly 15%, giving about 6,000 neurons, which is the default session grant in `UsageDO`.

**Resource usage for the reference session**

| Resource | Free daily allowance | Session usage (estimate) | Share |
| --- | --- | --- | --- |
| Workers AI | 10,000 neurons | \~6,000 neurons | \~60% |
| DO requests | 100,000 | \~1,300 (270 billed host deltas, 460 governor RPCs, 210 agent alarms, 144 COP pushes, 140 order RPCs, rest connects and control) | \~1.3% |
| DO duration | 13,000 GB-s | \~180 GB-s (mostly agents awaiting model responses) | \~1.4% |
| DO SQLite rows written | 100,000 | \~6,600 (one row per host delta, plus orders and logs) | \~6.6% |
| Worker requests | 100,000 | \~100 (API calls and WebSocket upgrades; static assets free) | \~0.1% |
| D1 rows written | 100,000 | \~20 | <0.1% |
| R2 Class A ops | 1 M / month | \~25 | <0.1% |

**What that means in practice**

- About one full AI-versus-AI session per day, or about three sessions per day when one faction is human-led (roughly halves agent calls).
- When the neuron grant runs out mid-session, agents switch to rule-based policies and the session continues; the console shows the switch.
- Profile A adds about 3,500 alarm invocations and about 7,000 rows written for the same 3-day run (8 slices per operational tick), still well inside DO limits.
- Many concurrent classrooms are limited by neurons, not infrastructure; run them with human-led factions or the rules-only mode, or move to Workers Paid.

## 9. Repository, configuration and code skeletons

A pnpm monorepo keeps the engine, protocol and rules packages shared between the browser and the edge, with one Worker deploying both the API and the console.

**Layout**

```text
warfare-sentinel/
├─ apps/
│  ├─ console/            React + Vite SPA (12 consoles, engine Web Worker host)
│  └─ edge/               Worker entry, SessionDO, FactionAgent, UsageDO, wrangler.jsonc
├─ packages/
│  ├─ engine/             Deterministic sim core: world, physics, sensing, C2, adjudication
│  ├─ agents-rules/       Behavior trees and utility-AI fallback policies
│  ├─ protocol/           Zod schemas, frame types, msgpack codecs, order schema
│  └─ catalog/            Notional asset bands (JSON) + validator
├─ scenarios/            strait-crisis.json, northern-plains.json, ...
├─ tools/                tile build (tippecanoe), symbol atlas build, slice benchmarks
├─ docs/                 spec.md, implementation.md (these two documents)
└─ CLAUDE.md             Build conventions and invariants for coding agents
```

Key invariants for `CLAUDE.md`: the engine never imports platform APIs; no `Math.random` or `Date` in `packages/engine`; `FactionAgent` code never imports ground-truth types; every frame type lives in `packages/protocol`.

**`apps/edge/wrangler.jsonc`**

```json
{
  "name": "warfare-sentinel",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-15",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "../console/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/ws/*"]
  },
  "durable_objects": {
    "bindings": [
      { "name": "SESSION", "class_name": "SessionDO" },
      { "name": "FACTION", "class_name": "FactionAgent" },
      { "name": "USAGE", "class_name": "UsageDO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["SessionDO", "FactionAgent", "UsageDO"] }
  ],
  "ai": { "binding": "AI" },
  "d1_databases": [
    { "binding": "DB", "database_name": "sentinel", "database_id": "<from wrangler d1 create>", "migrations_dir": "migrations" }
  ],
  "r2_buckets": [{ "binding": "ARCHIVE", "bucket_name": "sentinel-archive" }],
  "kv_namespaces": [{ "binding": "CONFIG", "id": "<from wrangler kv namespace create>" }],
  "vars": {
    "PROFILE_DEFAULT": "B",
    "SESSION_NEURON_GRANT": "6000",
    "MODEL_OPERATIONAL": "@cf/qwen/qwen3-30b-a3b-fp8",
    "MODEL_STRATEGIC": "@cf/openai/gpt-oss-120b",
    "MODEL_SUMMARY": "@cf/ibm-granite/granite-4.0-h-micro"
  },
  "observability": { "enabled": true, "head_sampling_rate": 0.1 }
}
```

Secrets (`wrangler secret put`): `JOIN_SECRET` for signing join tokens, `TURNSTILE_SECRET` for session creation.

**Worker entry (`src/index.ts`)**

```ts
export { SessionDO } from "./session";
export { FactionAgent } from "./faction";
export { UsageDO } from "./usage";

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req, env);

    const ws = url.pathname.match(/^\/ws\/sessions\/([\w-]+)$/);
    if (ws) {
      const stub = env.SESSION.get(env.SESSION.idFromName(`session:${ws[1]}`));
      return stub.fetch(req); // SessionDO verifies the join token and upgrades
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
```

**`SessionDO` hub (hibernation-friendly)**

```ts
import { DurableObject } from "cloudflare:workers";
import { decode, encode } from "@sentinel/protocol";

export class SessionDO extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const claims = await verifyJoinToken(new URL(req.url).searchParams.get("t"), this.env.JOIN_SECRET);
    if (!claims) return new Response("forbidden", { status: 403 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [`view:${claims.view}`, `user:${claims.sub}`]);
    server.serializeAttachment(claims);            // survives hibernation
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: ArrayBuffer | string) {
    const who = ws.deserializeAttachment() as Claims;
    const frame = decode(data);
    if (frame.t === "DELTA" && who.host) return this.fanOut(frame, ws);
    if (frame.t === "ORDER") return this.acceptOrder(who, frame);
    if (frame.t === "CONTROL") return this.control(who, frame);
  }

  private fanOut(frame: DeltaFrame, sender: WebSocket) {
    for (const view of ["BLUE", "RED", "WHITE"] as const) {
      const part = frame.views[view];
      if (!part) continue;
      const bytes = encode({ t: "DELTA", tick: frame.tick, d: part });
      for (const s of this.ctx.getWebSockets(`view:${view}`)) if (s !== sender) s.send(bytes);
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO events (tick, sim_ms, batch) VALUES (?, ?, ?)",
      frame.tick, frame.simMs, encode(frame.events),
    );
  }

  async submitAgentOrders(faction: Faction, role: Role, orders: OrderBatch) { /* RPC from FactionAgent */ }
  async alarm() { /* Profile A: run one engine slice; or fire a scheduled inject */ }
}
```

**`FactionAgent` (Agents SDK)**

```ts
import { Agent } from "agents";

export class FactionAgent extends Agent<Env, FactionState> {
  async onCopUpdate(delta: CopDelta) {               // RPC from SessionDO, hourly sim time
    applyCopDelta(this.sql, delta);
    for (const role of rolesDue(delta, this.state)) await this.schedule(0, "decide", { role });
  }

  async decide({ role }: { role: Role }) {
    const usage = this.env.USAGE.get(this.env.USAGE.idFromName("global"));
    const granted = await usage.canSpend(this.state.sessionId, estimateNeurons(role));
    const cop = readCop(this.sql);
    const orders = (granted && (await this.llmDecide(role, cop))) || rulePolicy(role, cop);
    const session = this.env.SESSION.get(this.env.SESSION.idFromName(`session:${this.state.sessionId}`));
    await session.submitAgentOrders(this.state.faction, role, orders);
  }

  private async llmDecide(role: Role, cop: Cop) {
    const res = await this.env.AI.run(modelFor(role, this.env), {
      messages: buildPrompt(role, cop, this.state),
      response_format: { type: "json_schema", json_schema: ORDER_BATCH_JSON_SCHEMA },
      max_tokens: 500,
    });
    const parsed = OrderBatch.safeParse(extractJson(res));
    return parsed.success ? { ...parsed.data, source: "LLM" } : null; // one repair retry in full version
  }
}
```

The skeletons follow the current Durable Objects and Agents SDK APIs; pin package versions and check the SDK changelog when upgrading, since the Agents SDK evolves quickly.

## 10. Build, deploy and CI

One `wrangler deploy` ships the Worker, all three Durable Object classes and the console bundle; GitHub Actions runs it on every merge to `main`, with preview versions for pull requests.

**One-time setup**

1. `pnpm create cloudflare@latest` (or clone the repo) and `pnpm install`.
2. `npx wrangler login`.
3. `npx wrangler d1 create sentinel`, then paste the id into `wrangler.jsonc`.
4. `npx wrangler r2 bucket create sentinel-archive`.
5. `npx wrangler kv namespace create SENTINEL_CONFIG`, then paste the id.
6. `npx wrangler secret put JOIN_SECRET` and `npx wrangler secret put TURNSTILE_SECRET`.
7. `npx wrangler d1 migrations apply sentinel --remote`.
8. `pnpm --filter tools build:tiles && pnpm --filter tools build:symbols` to produce basemap tiles and the symbol atlas into `apps/console/public/`.

**Build and deploy**

```bash
pnpm -r typecheck && pnpm -r test
pnpm --filter console build                 # outputs apps/console/dist
pnpm --filter edge exec wrangler deploy     # Worker + DOs + static assets
```

**GitHub Actions (`.github/workflows/deploy.yml`, abridged)**

```yaml
name: deploy
on:
  push: { branches: [main] }
  pull_request:
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck && pnpm -r test
      - run: pnpm --filter console build
      - name: Preview version (PRs)
        if: github.event_name == 'pull_request'
        run: pnpm --filter edge exec wrangler versions upload
        env: { CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}" }
      - name: Deploy (main)
        if: github.ref == 'refs/heads/main'
        run: |
          pnpm --filter edge exec wrangler d1 migrations apply sentinel --remote
          pnpm --filter edge exec wrangler deploy
        env: { CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}" }
```

**Suggested build order** (each step is demoable on its own)

1. Engine core with one land and one air class, deterministic replay test, running in a browser Web Worker.
2. Global Theater Map and timeline scrubber fed directly by the local engine.
3. `SessionDO` hub: join tokens, faction views, event log; a second browser sees Blue-only view.
4. Remaining asset classes, sensing, C2 network model; C2 Network Graph and Kill Chain consoles.
5. Orbital model and Orbital Console.
6. `FactionAgent` with rule-based policies only, then LLM decisions behind `UsageDO`.
7. Agent Reasoning Console, seat takeover, AAR Analyst.
8. Remaining consoles, starter scenarios, Monte Carlo batch, Profile A slicing.

## 11. Testing, observability, known limits and upgrade path

The riskiest assumptions (determinism, slice sizing, fog-of-war isolation) each get an automated test, and the one paid lever that matters most is the $5 Workers Paid plan.

**Testing**

| Test | Tooling | Pass condition |
| --- | --- | --- |
| Engine determinism | Vitest, Node and headless Chromium | Same seed + order log gives byte-identical event logs in both runtimes |
| Slice budget (Profile A) | Benchmark harness in `tools/`, run under `wrangler dev` | Worst-case slice stays under 6 ms CPU with margin |
| Durable Object behavior | `@cloudflare/vitest-pool-workers` | Hibernation round-trip keeps tags and attachments; orders from wrong seats rejected |
| Fog-of-war isolation | Static check + runtime test | `FactionAgent` bundle contains no ground-truth types; BLUE sockets never receive RED-only frames |
| Agent output | Zod contract tests on recorded model outputs | Every recorded response parses or triggers the fallback cleanly |
| Scenario validation | Catalog validator in CI | Rejects non-band numeric performance fields (spec guardrail) |
| Console performance | Playwright + trace | 5,000 symbols at 60 fps on reference hardware |

**Observability**

- Workers Logs with 10% head sampling and structured JSON (`session`, `faction`, `role`, `neurons`, `source`).
- `UsageDO` exposes `/api/admin/usage` with today's neurons, estimated DO requests and per-session grants; the console shows a quota banner to the session owner.
- Note the scheduled change: Workers Logs moves to Cloudflare Observability pricing on December 1, 2026, so recheck free log volumes then.

**Known limits on the free tier**

- Profile A is capped near 300 entities without tactical ticks.
- About one fully AI-driven session per day; beyond that, agents run on rules.
- A host closing the browser pauses a Profile B session; it resumes from the last snapshot when any WHITE seat reconnects.
- Account-wide 5 GB Durable Object storage requires the 7-day cleanup and R2 archiving.
- Free-plan limits can change; this plan reflects the documentation as of the date above.

**Upgrade path**

| Lever | What it unlocks |
| --- | --- |
| Workers Paid ($5/month) | 30 s default CPU per invocation (up to 5 min): Profile A at full spec scale; paid neurons at $0.011 per 1,000; Queues and larger log retention |
| Session fan-out | One `SessionDO` per region shard for global scenarios above 5,000 entities |
| Larger models | Swap `MODEL_STRATEGIC` to a frontier model for richer strategic reasoning |
| AI Gateway | Caching, rate limiting and analytics in front of Workers AI |

## Sources

- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) — Workers, KV, Queues, Workflows, D1, Durable Objects, R2 and Workers Logs free allowances.
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) — daily neuron allowance and per-model neuron rates.
- [Durable Objects limits](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/durable-objects/platform/limits.mdx) — per-account storage on Free, SQL limits, and the rule that Workers plan limits apply to Durable Objects.
- Companion document: WARFARE SENTINEL — Multi-Agent Global Warfare Simulator: System Specification
