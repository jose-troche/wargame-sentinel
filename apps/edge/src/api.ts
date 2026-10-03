// REST API (spec §9): sessions, control, orders, seats, events, AAR, scenarios, usage, Monte Carlo.
import { VIEWS, type ControlFrame, type JoinClaims, type Profile, type SessionMeta, type View } from "@sentinel/protocol";
import { validateScenario, CATALOG, CATALOG_VERSION } from "@sentinel/catalog";
import { SCENARIO_SUMMARIES, getScenario } from "@sentinel/scenarios";
import { bearer, checkTurnstile, randomId, signToken, verifyToken } from "./auth";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const err = (message: string, status = 400) => json({ error: message }, status);

const TOKEN_TTL = 7 * 86_400_000;

function sessionStub(env: Env, id: string) {
  return env.SESSION.get(env.SESSION.idFromName(`session:${id}`));
}

async function claimsFor(req: Request, env: Env, sid: string): Promise<JoinClaims | null> {
  const c = await verifyToken(bearer(req), env.JOIN_SECRET);
  return c && c.sid === sid ? c : null;
}

async function tokensFor(env: Env, sid: string, user: { id: string; name: string }, owner: boolean, views: View[]) {
  const out: Partial<Record<View, string>> = {};
  for (const view of views) {
    out[view] = await signToken({ sid, sub: user.id, name: user.name, view, host: owner && view === "WHITE", owner, exp: Date.now() + TOKEN_TTL }, env.JOIN_SECRET);
  }
  return out;
}

function cleanUser(u: unknown): { id: string; name: string } | null {
  const o = u as { id?: string; name?: string } | undefined;
  if (!o?.id || typeof o.id !== "string" || o.id.length > 64) return null;
  return { id: o.id, name: String(o.name ?? "Player").slice(0, 40) };
}

async function createSession(
  env: Env,
  body: { scenarioId: string; profile?: Profile; seed?: number; rulesOnly?: boolean; user: { id: string; name: string } },
  parent?: { session: string; tick: number; branch: { snapshot: Uint8Array; orders: never[]; pauseAtTick: number } },
) {
  const scn = getScenario(body.scenarioId);
  if (!scn) throw new Error("unknown scenario");
  const profile: Profile = body.profile === "A" ? "A" : body.profile === "B" ? "B" : (env.PROFILE_DEFAULT as Profile);
  if (profile === "A") {
    const n = scn.orbat.reduce((a, u) => a + u.count, 0) + scn.space.reduce((a, c) => a + c.planes * c.perPlane, 0);
    if (n > 300) throw new Error(`Profile A (edge-authoritative) is capped at about 300 entities on the free tier; ${scn.name} has ${n}. Use Profile B.`);
  }
  const id = randomId(10);
  const seed = Number.isInteger(body.seed) ? (body.seed as number) >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0];
  const joinCode = randomId(6);
  const usage = env.USAGE.get(env.USAGE.idFromName("global"));
  const grant = body.rulesOnly ? 0 : await usage.registerSession(id, scn.rules.neuronGrant);
  const meta: SessionMeta = {
    id, scenarioId: scn.id, scenarioName: scn.name, seed, profile, status: profile === "A" ? "RUNNING" : "WAITING_HOST", speed: 600, simMs: 0, tick: 0,
    owner: body.user.id, createdAt: Date.now(), hostConnected: profile === "A", rulesOnly: !!body.rulesOnly, lastSeq: 0,
    parent: parent ? { session: parent.session, tick: parent.tick } : undefined,
  };
  await sessionStub(env, id).init(meta, grant, parent?.branch);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessions (id, scenario_id, owner, profile, seed, status, created_at, owner_name, parent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, scn.id, body.user.id, profile, seed, meta.status, meta.createdAt, body.user.name, parent?.session ?? null),
    env.DB.prepare("INSERT OR REPLACE INTO members (session_id, user, view) VALUES (?, ?, 'WHITE')").bind(id, body.user.id),
  ]);
  await env.CONFIG.put(`join:${id}`, joinCode, { expirationTtl: 30 * 86400 }).catch(() => undefined);
  const tokens = await tokensFor(env, id, body.user, true, ["WHITE", "BLUE", "RED"]);
  return { session: meta, tokens, joinCode, grant };
}

export async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  const method = req.method;
  try {
    // ---- catalogue and scenarios
    if (parts[0] === "scenarios" && parts.length === 1 && method === "GET") return json({ scenarios: SCENARIO_SUMMARIES });
    if (parts[0] === "scenarios" && parts[1] === "validate" && method === "POST") {
      const res = validateScenario(await req.json());
      return json({ ok: res.ok, errors: res.errors, warnings: res.warnings });
    }
    if (parts[0] === "scenarios" && parts.length === 2 && method === "GET") {
      const s = getScenario(parts[1]);
      return s ? json(s) : err("not found", 404);
    }
    if (parts[0] === "catalog" && method === "GET") return json({ version: CATALOG_VERSION, classes: CATALOG });
    if (parts[0] === "config" && method === "GET") {
      // KV holds read-mostly feature flags and the catalogue version pointer; the bundled copy is the fallback.
      const flags = (await env.CONFIG.get<Record<string, unknown>>("flags", "json").catch(() => null)) ?? {};
      return json({ turnstileSiteKey: env.TURNSTILE_SITEKEY || null, profileDefault: env.PROFILE_DEFAULT, catalogVersion: (await env.CONFIG.get("catalog_version")) ?? CATALOG_VERSION, flags, archive: env.ARCHIVE ? "R2" : "D1", models: { operational: env.MODEL_OPERATIONAL, strategic: env.MODEL_STRATEGIC, summary: env.MODEL_SUMMARY } });
    }
    if (parts[0] === "admin" && parts[1] === "usage" && method === "GET") {
      return json(await env.USAGE.get(env.USAGE.idFromName("global")).stats());
    }

    // ---- Monte Carlo summaries (computed in browsers, uploaded as one summary)
    if (parts[0] === "montecarlo") {
      if (method === "POST") {
        const body = (await req.json()) as { scenarioId: string; seeds: number; summary: unknown; user?: unknown };
        if (!getScenario(body.scenarioId)) return err("unknown scenario");
        const s = JSON.stringify(body.summary);
        if (s.length > 200_000) return err("summary too large");
        const id = randomId(10);
        await env.DB.prepare("INSERT INTO montecarlo (id, scenario_id, seeds, created_at, summary_json, owner) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(id, body.scenarioId, Math.min(10000, body.seeds | 0), Date.now(), s, cleanUser(body.user)?.id ?? null).run();
        return json({ id });
      }
      const rows = await env.DB.prepare("SELECT id, scenario_id, seeds, created_at, summary_json FROM montecarlo ORDER BY created_at DESC LIMIT 20").all();
      return json({ runs: rows.results.map((r) => ({ ...r, summary: JSON.parse(String(r.summary_json)), summary_json: undefined })) });
    }

    // ---- sessions
    if (parts[0] !== "sessions") return err("not found", 404);
    if (parts.length === 1 && method === "POST") {
      const body = (await req.json()) as { scenarioId: string; profile?: Profile; seed?: number; rulesOnly?: boolean; user: unknown; turnstile?: string };
      const user = cleanUser(body.user);
      if (!user) return err("user id required");
      if (!(await checkTurnstile(env, body.turnstile, req.headers.get("cf-connecting-ip")))) return err("Turnstile check failed", 403);
      try {
        return json(await createSession(env, { ...body, user }), 201);
      } catch (e) {
        return err(String((e as Error).message));
      }
    }
    if (parts.length === 1 && method === "GET") {
      const owner = url.searchParams.get("owner");
      const q = owner
        ? env.DB.prepare("SELECT id, scenario_id, owner_name, profile, status, created_at, ended_at, parent FROM sessions WHERE owner = ? ORDER BY created_at DESC LIMIT 25").bind(owner)
        : env.DB.prepare("SELECT id, scenario_id, owner_name, profile, status, created_at, ended_at, parent FROM sessions ORDER BY created_at DESC LIMIT 25");
      return json({ sessions: (await q.all()).results });
    }
    const sid = parts[1];
    if (!/^[a-z0-9]{6,16}$/.test(sid ?? "")) return err("bad session id");
    const stub = sessionStub(env, sid);
    const meta = await stub.getMeta();
    if (!meta) return err("session not found", 404);

    if (parts.length === 2 && method === "GET") return json({ session: meta });

    if (parts[2] === "join" && method === "POST") {
      const body = (await req.json()) as { view: View; user: unknown; code?: string };
      const user = cleanUser(body.user);
      if (!user || !VIEWS.includes(body.view)) return err("view and user required");
      const owner = meta.owner === user.id;
      if (body.view === "WHITE" && !owner) return err("the White-cell view is restricted to the session owner", 403);
      if (!owner) {
        const code = await env.CONFIG.get(`join:${sid}`);
        if (code && code !== body.code) return err("wrong join code", 403);
      }
      await env.DB.prepare("INSERT OR REPLACE INTO members (session_id, user, view) VALUES (?, ?, ?)").bind(sid, user.id, body.view).run();
      const tokens = await tokensFor(env, sid, user, owner, owner ? ["WHITE", "BLUE", "RED"] : [body.view]);
      return json({ session: meta, tokens });
    }

    const claims = await claimsFor(req, env, sid);
    if (!claims) return err("missing or invalid join token", 401);

    if (parts[2] === "control" && method === "POST") {
      const frame = (await req.json()) as ControlFrame;
      return json(await stub.control(claims, { ...frame, t: "CONTROL" }));
    }
    if (parts[2] === "orders" && method === "POST") {
      const body = (await req.json()) as { seat: string; batch: unknown };
      return json(await stub.acceptOrder(claims, { t: "ORDER", seat: body.seat, batch: body.batch as never }));
    }
    if (parts[2] === "seats" && parts[3] && method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { take?: boolean };
      return json(await stub.control(claims, { t: "CONTROL", op: "seat", seat: parts[3], take: body.take !== false }));
    }
    if (parts[2] === "events" && method === "GET") {
      return json(await stub.apiEvents(claims.view, Number(url.searchParams.get("from") ?? 0)));
    }
    if (parts[2] === "agents" && method === "GET") return json(await stub.apiAgents(claims.view));
    if (parts[2] === "aar" && method === "GET") {
      const a = await stub.aar();
      // Faction viewers get the metrics and narrative but not White-cell-only ground truth beyond the AAR itself.
      return json(a);
    }
    if (parts[2] === "audit" && method === "GET") {
      if (!claims.owner) return err("audit log is restricted to the session owner", 403);
      const f = (url.searchParams.get("faction") ?? "BLUE") as "BLUE" | "RED" | "WHITE";
      return json({ log: await stub.audit(f, Number(url.searchParams.get("limit") ?? 50)) });
    }
    if (parts[2] === "branch" && method === "POST") {
      if (!claims.owner) return err("only the owner can branch", 403);
      const body = (await req.json()) as { tick: number };
      const src = await stub.branchSource(Math.max(0, body.tick | 0));
      if (!src) return err("no snapshot yet: branching needs at least one simulated hour");
      const created = await createSession(
        env,
        { scenarioId: meta.scenarioId, profile: meta.profile, seed: meta.seed, rulesOnly: meta.rulesOnly, user: { id: claims.sub, name: claims.name } },
        { session: sid, tick: body.tick, branch: { snapshot: src.snapshot, orders: src.orders as never[], pauseAtTick: body.tick } },
      );
      return json(created, 201);
    }
    return err("not found", 404);
  } catch (e) {
    console.error(JSON.stringify({ path: url.pathname, error: String(e) }));
    return err("internal error", 500);
  }
}
