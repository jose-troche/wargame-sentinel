import { useEffect, useRef, useState } from "react";
import { SCENARIO_SUMMARIES, getScenario } from "@sentinel/scenarios";
import type { View } from "@sentinel/protocol";
import { api } from "../lib/api";
import { getUser, setUserName } from "../lib/identity";
import { navigate } from "../router";
import { Turnstile, type TurnstileHandle } from "../lib/turnstile";

export function Lobby() {
  const [sel, setSel] = useState(SCENARIO_SUMMARIES[0].id);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const [name, setName] = useState(getUser().name);
  const [rulesOnly, setRulesOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [joinId, setJoinId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinView, setJoinView] = useState<View>("BLUE");
  const [mine, setMine] = useState<{ id: string; scenario_id: string; profile: string; status: string; created_at: number; parent: string | null }[]>([]);
  const [recent, setRecent] = useState<typeof mine>([]);
  const [online, setOnline] = useState(true);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [tsToken, setTsToken] = useState<string | null>(null);
  const ts = useRef<TurnstileHandle>(null);
  const scn = SCENARIO_SUMMARIES.find((s) => s.id === sel)!;
  const full = getScenario(sel)!;
  const profileA = scn.entities <= 300;

  useEffect(() => {
    api.sessions(getUser().id).then((r) => setMine(r.sessions)).catch(() => setOnline(false));
    api.config().then((c) => setSiteKey(c.turnstileSiteKey)).catch(() => undefined);
    api.sessions().then((r) => setRecent(r.sessions.filter((s) => s.status !== "ENDED").slice(0, 8))).catch(() => undefined);
  }, []);

  const create = async (profile: "A" | "B") => {
    setBusy(true);
    setErr(null);
    setUserName(name);
    try {
      const created = await api.createSession({ scenarioId: sel, profile, seed, rulesOnly, user: { ...getUser(), name }, turnstile: tsToken ?? undefined });
      navigate(`/s/${created.session.id}`, created);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
      ts.current?.reset(); // tokens are single-use
    }
  };
  const needsCheck = !!siteKey && !tsToken;

  return (
    <div className="lobby">
      <div className="hero">
        <div>
          <h1>WARFARE SENTINEL</h1>
          <p>A multi-domain, multi-agent wargame for teaching how joint operations behave as systems: sensing, command latency, logistics and attrition across land, sea, air, drones and space. AI agents command fictional factions; you can take any seat.</p>
        </div>
        <div className="row wrap">
          <label className="row">Your name <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 140 }} /></label>
          <button onClick={() => navigate("/montecarlo")}>Monte Carlo</button>
          <button onClick={() => navigate("/usage")}>Free-tier usage</button>
        </div>
      </div>

      <div className="section-title">Starter scenarios</div>
      <div className="scn-grid">
        {SCENARIO_SUMMARIES.map((s) => (
          <div key={s.id} className={`card scn${s.id === sel ? " active" : ""}`} onClick={() => setSel(s.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(s.id)} aria-pressed={s.id === sel}>
            <h3>{s.name}</h3>
            <div className="muted" style={{ fontSize: 12 }}>{s.scale} · {s.entities} entities</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>{s.description}</div>
            <div className="chips">{s.domains.map((d) => <span key={d} className="pill">{d}</span>)}</div>
            <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>Teaching focus: {s.teachingFocus}</div>
          </div>
        ))}
      </div>

      <div className="row wrap" style={{ alignItems: "stretch", gap: 12, marginTop: 16 }}>
        <div className="card grow" style={{ minWidth: 300 }}>
          <h3>Start {scn.name}</h3>
          <dl className="kv" style={{ margin: "8px 0" }}>
            <dt>Factions</dt><dd>{full.factions.map((f) => f.name).join(" vs ")}</dd>
            <dt>Duration</dt><dd>{full.durationH} simulated hours, tick {full.rules.tickMs / 1000}s</dd>
            <dt>Objectives</dt><dd>{full.factions.flatMap((f) => f.objectives.map((o) => `${f.id}: ${o.name}`)).join(" · ")}</dd>
          </dl>
          <div className="row wrap">
            <label className="row">Seed <input type="number" value={seed} onChange={(e) => setSeed(+e.target.value)} style={{ width: 110 }} /></label>
            <label className="row" title="Zero LLM calls: every agent uses its rule-based policy"><input type="checkbox" checked={rulesOnly} onChange={(e) => setRulesOnly(e.target.checked)} /> rules-only agents</label>
          </div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button className="primary" onClick={() => navigate(`/local/${sel}/${seed}`)}>Play locally</button>
            <button onClick={() => create("B")} disabled={busy || !online || needsCheck} title="Engine runs in your browser; Cloudflare hosts the hub and the LLM agents">Host online (Profile B)</button>
            <button onClick={() => create("A")} disabled={busy || !online || !profileA || needsCheck} title={profileA ? "Engine runs on the edge in alarm-sized slices (≤300 entities, 10-minute ticks)" : "Over 300 entities: Profile A is not available on the free tier"}>Edge-authoritative (Profile A)</button>
          </div>
          {siteKey && online && (
            <div style={{ marginTop: 10 }}>
              <Turnstile ref={ts} siteKey={siteKey} onToken={setTsToken} />
              {needsCheck && <div className="dim" style={{ fontSize: 11 }}>Complete the check to create an online session.</div>}
            </div>
          )}
          <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
            Local play runs entirely in your browser with rule-based agents, deterministic rewind and branching. Online sessions add LLM commanders on Workers AI (with a daily neuron budget and automatic rule fallback), faction views for other players, and a server-side event log and AAR.
          </p>
          {err && <div className="pill bad" style={{ whiteSpace: "normal" }}>{err}</div>}
        </div>

        <div className="card" style={{ minWidth: 280, flex: "1 1 280px" }}>
          <h3>Join a session</h3>
          <div className="col" style={{ marginTop: 8 }}>
            <input type="text" placeholder="session id" value={joinId} onChange={(e) => setJoinId(e.target.value.trim())} aria-label="Session id" />
            <input type="text" placeholder="join code" value={joinCode} onChange={(e) => setJoinCode(e.target.value.trim())} aria-label="Join code" />
            <div className="row">
              {(["BLUE", "RED"] as View[]).map((v) => <button key={v} className={`small ${joinView === v ? "primary" : ""}`} onClick={() => setJoinView(v)}>{v === "BLUE" ? "■ Blue" : "◆ Red"}</button>)}
              <button className="primary" disabled={!joinId} onClick={() => navigate(`/s/${joinId}?code=${encodeURIComponent(joinCode)}&view=${joinView}`)}>Join</button>
            </div>
          </div>
          {mine.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 12 }}>Your sessions</div>
              {mine.slice(0, 8).map((s) => (
                <div key={s.id} className="row" style={{ fontSize: 12, marginBottom: 2 }}>
                  <a href={`/s/${s.id}`} onClick={(e) => { e.preventDefault(); navigate(`/s/${s.id}`); }}>{s.id}</a>
                  <span className="dim">{s.scenario_id} · P{s.profile}</span><span className={`pill ${s.status === "ENDED" ? "" : "ok"}`}>{s.status}</span>
                  {s.parent && <span className="dim">branch of {s.parent}</span>}
                </div>
              ))}
            </>
          )}
          {recent.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 12 }}>Open sessions</div>
              {recent.map((s) => <div key={s.id} style={{ fontSize: 12 }}><span className="mono">{s.id}</span> <span className="dim">{s.scenario_id} · {s.status}</span></div>)}
            </>
          )}
          {!online && <div className="dim" style={{ marginTop: 8 }}>Online features are unavailable (no API). Local play still works.</div>}
        </div>
      </div>

      <p className="guardrail">
        Educational and research use only. All asset values are notional bands calibrated for relative plausibility, factions and landmasses are fictional,
        and there is no connection to real command-and-control, sensor or weapon systems or live feeds. LLM agents reason only at the game-abstraction level.
        Civilian harm is modeled as a cost and reported in every after-action review.
      </p>
    </div>
  );
}
