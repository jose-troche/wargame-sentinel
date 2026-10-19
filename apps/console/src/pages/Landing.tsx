// Landing page: the theater map from the first second, with a short setup beside it (scenario, side,
// opponent, difficulty) and the mission spelled out before the game starts.
import { useEffect, useMemo, useRef, useState } from "react";
import { SCENARIO_SUMMARIES, getScenario } from "@sentinel/scenarios";
import { FACTION_COLORS, type View } from "@sentinel/protocol";
import { navigate } from "../router";
import { api } from "../lib/api";
import { getUser, setUserName } from "../lib/identity";
import { Turnstile, type TurnstileHandle } from "../lib/turnstile";
import { CommandMap, scenarioObjectives } from "../command/CommandMap";
import { Intro } from "../command/Intro";
import { Icon } from "../command/Icons";
import { useGame, type Opponent } from "../game/store";
import { LEVELS, type Level } from "../game/levels";
import type { Side } from "../game/types";

const PLAYABLE = SCENARIO_SUMMARIES.filter((s) => s.id !== "sandbox");
const OPPONENTS: { id: Opponent; title: string; text: string; online: boolean }[] = [
  { id: "computer", title: "Computer", text: "Plays in your browser. No account, works offline.", online: false },
  { id: "llm", title: "AI commanders", text: "Language-model commanders on the server (limited daily budget; falls back to the computer).", online: true },
  { id: "human", title: "A friend", text: "Online: you get an invite link to send to your opponent.", online: true },
];

const narrowQuery = "(max-width: 860px)";

export function Landing() {
  const [sel, setSel] = useState(PLAYABLE[0].id);
  const [side, setSide] = useState<Side>("BLUE");
  const [opponent, setOpponent] = useState<Opponent>("computer");
  const [level, setLevel] = useState<Level>(() => {
    try { return (localStorage.getItem("ws.level") as Level) || "recruit"; } catch { return "recruit"; }
  });
  const [name, setName] = useState(getUser().name);
  const [online, setOnline] = useState(true);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [tsToken, setTsToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [join, setJoin] = useState(false);
  const [narrow, setNarrow] = useState(() => matchMedia(narrowQuery).matches);
  const [sheetOpen, setSheetOpen] = useState(true);
  const intro = useGame((s) => s.intro);
  const ts = useRef<TurnstileHandle>(null);
  const scn = getScenario(sel)!;
  const summary = PLAYABLE.find((s) => s.id === sel)!;
  const objectives = useMemo(() => scenarioObjectives(scn, side), [scn, side]);
  const mine = objectives.filter((o) => o.mine);
  const theirs = objectives.filter((o) => !o.mine);
  const facName = (f: Side) => scn.factions.find((x) => x.id === f)?.name ?? f;

  useEffect(() => {
    api.config().then((c) => setSiteKey(c.turnstileSiteKey)).catch(() => setOnline(false));
    const m = matchMedia(narrowQuery);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  const opp = OPPONENTS.find((o) => o.id === opponent)!;
  const needsCheck = opp.online && !!siteKey && !tsToken;
  const start = async () => {
    try { localStorage.setItem("ws.level", level); } catch { /* storage unavailable */ }
    const seed = Math.floor(Math.random() * 1e6);
    if (!opp.online) return navigate(`/play/${sel}?side=${side}&level=${level}&seed=${seed}`);
    setBusy(true);
    setErr(null);
    setUserName(name);
    try {
      const created = await api.createSession({ scenarioId: sel, profile: "B", seed, rulesOnly: opponent === "human", user: { ...getUser(), name }, turnstile: tsToken ?? undefined });
      navigate(`/s/${created.session.id}`, { ...created, game: { side, level, opponent } });
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
      ts.current?.reset();
    }
  };

  const pad = narrow ? { top: 30, bottom: sheetOpen ? Math.round(window.innerHeight * 0.55) : 120, left: 20, right: 50 } : { top: 40, bottom: 40, left: 470, right: 70 };

  return (
    <div className={`landing${narrow ? " narrow" : ""}`}>
      <CommandMap variant="landing" scenario={scn} side={side} padding={pad} objectives={objectives} />
      <section className={`setup${narrow && !sheetOpen ? " collapsed" : ""}`} aria-label="Game setup">
        {narrow && <button className="sheet-grip" onClick={() => setSheetOpen((o) => !o)} aria-label={sheetOpen ? "Collapse" : "Expand"}><span /></button>}
        <header className="setup-head">
          <h1>WARFARE SENTINEL</h1>
          <p>Command a nation's forces from the war room. Your staff report; <b>you decide</b>.</p>
          <div className="row wrap">
            <button onClick={() => useGame.setState({ intro: true })}><Icon name="help" size={14} /> How to play</button>
            <button className="ghost" onClick={() => setJoin((j) => !j)}><Icon name="users" size={14} /> Join a friend's game</button>
          </div>
          {join && <JoinForm />}
        </header>

        <div className="setup-step">
          <div className="step-label"><span>1</span> Scenario</div>
          <div className="chips scn-chips" role="radiogroup" aria-label="Scenario">
            {PLAYABLE.map((s) => (
              <button key={s.id} role="radio" aria-checked={s.id === sel} className={`chip${s.id === sel ? " on" : ""}`} onClick={() => setSel(s.id)}>{s.name}</button>
            ))}
          </div>
          <p className="scn-desc">{summary.description}</p>
          <div className="facts"><span><Icon name="clock" size={12} /> {Math.round(scn.durationH / 24)} days</span><span>{summary.domains.join(" · ").toLowerCase()}</span><span>{summary.teachingFocus}</span></div>
        </div>

        <div className="setup-step">
          <div className="step-label"><span>2</span> Your side</div>
          <div className="side-cards" role="radiogroup" aria-label="Side">
            {(["BLUE", "RED"] as Side[]).map((f) => (
              <button key={f} role="radio" aria-checked={side === f} className={`side-card${side === f ? " on" : ""}`} onClick={() => setSide(f)} style={{ ["--fc" as string]: FACTION_COLORS[f] }}>
                <span className="swatch" />
                <b>{facName(f)}</b>
                <small>{f === "BLUE" ? "Blue" : "Red"}</small>
              </button>
            ))}
          </div>
          <div className="mission-box">
            <div className="mb-title">Your mission</div>
            <ol>
              {mine.map((o) => <li key={o.id}><b>{o.name}</b>{o.weight > 1 && <span className="tag">most points</span>}</li>)}
            </ol>
            <div className="mb-enemy">The enemy wants to: {theirs.map((o) => o.name.toLowerCase()).join("; ")}.</div>
            <div className="mb-win"><Icon name="flag" size={12} /> Win by breaking the enemy's national will, or by leading on victory points after {Math.round(scn.durationH / 24)} days. Holding objectives earns points every hour.</div>
          </div>
        </div>

        <div className="setup-step">
          <div className="step-label"><span>3</span> Opponent</div>
          <div className="segmented wide" role="radiogroup" aria-label="Opponent">
            {OPPONENTS.map((o) => (
              <button key={o.id} role="radio" aria-checked={opponent === o.id} className={opponent === o.id ? "on" : ""} disabled={o.online && !online} onClick={() => setOpponent(o.id)} title={o.online && !online ? "Online play is unavailable here" : o.text}>{o.title}</button>
            ))}
          </div>
          <p className="hint">{opp.text}</p>
          {opp.online && (
            <div className="col">
              <label className="row">Your name <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 160 }} /></label>
              {siteKey && <Turnstile ref={ts} siteKey={siteKey} onToken={setTsToken} />}
            </div>
          )}
        </div>

        <div className="setup-step">
          <div className="step-label"><span>4</span> Difficulty</div>
          <div className="levels" role="radiogroup" aria-label="Difficulty">
            {(Object.keys(LEVELS) as Level[]).map((l) => (
              <button key={l} role="radio" aria-checked={level === l} className={`level${level === l ? " on" : ""}`} onClick={() => setLevel(l)}>
                <b>{LEVELS[l].title}</b><small>{LEVELS[l].blurb}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="setup-go">
          <button className="primary big" onClick={start} disabled={busy || needsCheck}>
            {busy ? "Starting…" : <>Take command <Icon name="arrow" size={16} /></>}
          </button>
          {needsCheck && <div className="hint">Complete the check above to start an online game.</div>}
          {err && <div className="pill bad" style={{ whiteSpace: "normal" }}>{err}</div>}
        </div>

        <footer className="setup-foot">
          <div className="row wrap">
            <a href={`/local/${sel}/42`} onClick={(e) => { e.preventDefault(); navigate(`/local/${sel}/42`); }}>Referee sandbox</a>
            <a href="/lobby" onClick={(e) => { e.preventDefault(); navigate("/lobby"); }}>Advanced setup</a>
            <a href="/montecarlo" onClick={(e) => { e.preventDefault(); navigate("/montecarlo"); }}>Monte Carlo</a>
          </div>
          <p>Educational use only. Factions, forces and place names are fictional and all performance values are notional; the scenarios put fictional actors on real geography. Civilian harm is always a cost.</p>
        </footer>
      </section>
      {intro && <Intro />}
    </div>
  );
}

function JoinForm() {
  const [link, setLink] = useState("");
  const [view, setView] = useState<View>("RED");
  const go = () => {
    const m = link.match(/\/s\/([a-z0-9]{6,16})(\?.*)?$/) ?? link.match(/^([a-z0-9]{6,16})$/);
    if (!m) return;
    const q = new URLSearchParams(m[2] ?? "");
    if (!q.get("view")) q.set("view", view);
    navigate(`/s/${m[1]}?${q.toString()}`);
  };
  return (
    <div className="join-form">
      <input type="text" placeholder="Paste the invite link (or session id)" value={link} onChange={(e) => setLink(e.target.value.trim())} aria-label="Invite link" />
      {!link.includes("view=") && (
        <div className="segmented" role="radiogroup" aria-label="Side">
          {(["BLUE", "RED"] as View[]).map((v) => <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)} role="radio" aria-checked={view === v}>{v === "BLUE" ? "Blue" : "Red"}</button>)}
        </div>
      )}
      <button className="primary" onClick={go} disabled={!link}>Join</button>
    </div>
  );
}
