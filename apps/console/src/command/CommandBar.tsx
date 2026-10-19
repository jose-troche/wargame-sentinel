// Top bar of the command post: the mission in one line, the score, the clock and time controls.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { useGame, canControlTime } from "../game/store";
import { LEVELS, SPEED_PRESETS, speedPreset } from "../game/levels";
import { controller } from "../session/controller";
import { navigate } from "../router";
import { canSpeak } from "../game/voice";
import { fmtShort } from "./Briefing";
import { Icon } from "./Icons";

export function CommandBar({ onExpert }: { onExpert: () => void }) {
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const ended = useStore((s) => s.ended);
  const simMs = useStore((s) => Math.floor(s.simMs / 60_000) * 60_000);
  const mode = useStore((s) => s.mode);
  const connected = useStore((s) => s.connected);
  const joinCode = useStore((s) => s.joinCode);
  const meta = useStore((s) => s.meta);
  const brief = useGame((s) => s.brief);
  const level = useGame((s) => s.level);
  const side = useGame((s) => s.side);
  const pausedFor = useGame((s) => s.pausedFor);
  const owner = canControlTime();
  const score = brief?.score;
  const total = score ? Math.max(1, score.own + score.enemy) : 1;
  const mission = (brief?.objectives ?? []).filter((o) => o.mine).map((o) => o.place).join(" · ");
  const preset = speedPreset(speed);
  return (
    <header className={`cbar side-${side?.toLowerCase()}`}>
      <Menu onExpert={onExpert} />
      <button className="mission" onClick={() => useGame.setState({ drawer: "strategic" })} title="Your objectives — click for details" data-tour="mission">
        <span className="mission-label">Mission</span>
        <span className="mission-text">{mission || meta?.scenarioName}</span>
      </button>
      {score && (
        <div className="score" title={`Victory points: ${score.ownName} ${score.own}, ${score.enemyName} about ${score.enemy}. The higher score wins at the time limit.`} data-tour="score">
          <span className="score-n own">{score.own}</span>
          <span className="score-bar"><span className="own" style={{ width: `${(score.own / total) * 100}%` }} /></span>
          <span className="score-n enemy">≈{score.enemy}</span>
        </div>
      )}
      <div className="clock-box" title="Simulated time (D+day hh:mm)">
        <span className="clock mono">{fmtShort(simMs)}</span>
        {score && <span className="clock-left">{timeLeft(score.hoursLeft)}</span>}
      </div>
      <div className="time-ctl" data-tour="time">
        {owner ? (
          <>
            <button className={`play-btn${playing ? " on" : ""}`} onClick={() => controller.play(!playing)} disabled={ended} aria-label={playing ? "Pause (Space)" : "Play (Space)"} title={playing ? "Pause (Space)" : "Play (Space)"}>
              <Icon name={playing ? "pause" : "play"} size={18} />
            </button>
            <div className="segmented speeds" role="group" aria-label="Game speed">
              {SPEED_PRESETS.map((p, i) => (
                <button key={p.id} className={preset.id === p.id ? "on" : ""} onClick={() => controller.setSpeed(p.speed)} title={`${p.label}: ${p.hint} (${i + 1})`} aria-pressed={preset.id === p.id}>{p.label}</button>
              ))}
            </div>
            <button className="speed-cycle" onClick={() => { const i = SPEED_PRESETS.findIndex((p) => p.id === preset.id); controller.setSpeed(SPEED_PRESETS[(i + 1) % SPEED_PRESETS.length].speed); }} aria-label={`Speed: ${preset.label}`}>{preset.label}</button>
          </>
        ) : (
          <span className="dim small-text">{playing ? `Running · ${preset.label}` : "Paused by host"}</span>
        )}
      </div>
      {pausedFor && !playing && <span className="paused-tag" role="status">Paused: decision needed</span>}
      <span className="grow" />
      {mode !== "local" && <span className={`net ${connected ? "ok" : "bad"}`} title={connected ? "Connected" : "Reconnecting…"}>{connected ? "online" : "reconnecting"}</span>}
      {mode === "host" && joinCode && <InviteButton />}
      <span className="level-tag" title={LEVELS[level].blurb}>{LEVELS[level].title}</span>
      <button className="icon-btn" onClick={() => useGame.setState({ tour: 0 })} aria-label="Help and tour (?)" title="Help and tour (?)"><Icon name="help" /></button>
    </header>
  );
}

export function timeLeft(hours: number) {
  const h = Math.ceil(hours);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h left` : `${h}h left`;
}

function InviteButton() {
  const meta = useStore((s) => s.meta)!;
  const joinCode = useStore((s) => s.joinCode);
  const side = useGame((s) => s.side);
  const other = side === "BLUE" ? "RED" : "BLUE";
  const invite = () => {
    const url = `${location.origin}/s/${meta.id}?code=${joinCode ?? ""}&view=${other}`;
    navigator.clipboard?.writeText(url).then(() => useStore.getState().notify(`Invite link copied. Your opponent joins as ${other === "BLUE" ? "Blue" : "Red"} (code ${joinCode}).`), () => useStore.getState().notify(url));
  };
  return <button className="small" onClick={invite}><Icon name="users" size={14} /> Invite opponent</button>;
}

function Menu({ onExpert }: { onExpert: () => void }) {
  const [open, setOpen] = useState(false);
  const voice = useGame((s) => s.voice);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const setVoice = (v: boolean) => {
    useGame.setState({ voice: v });
    try { localStorage.setItem("ws.voice", v ? "1" : "0"); } catch { /* storage unavailable */ }
  };
  return (
    <div className="menu" ref={ref}>
      <button className="brand-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="brand">SENTINEL</span><Icon name="down" size={14} />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button role="menuitem" onClick={() => { setOpen(false); useGame.setState({ intro: true }); }}><Icon name="help" size={14} /> How to play</button>
          <button role="menuitem" onClick={() => { setOpen(false); useGame.setState({ tour: 0 }); }}><Icon name="target" size={14} /> Tour of the screen</button>
          <button role="menuitem" onClick={() => { setOpen(false); onExpert(); }}><Icon name="grid" size={14} /> Expert consoles</button>
          {canSpeak() && <button role="menuitem" onClick={() => setVoice(!voice)}><Icon name={voice ? "volume" : "mute"} size={14} /> Spoken alerts: {voice ? "on" : "off"}</button>}
          <button role="menuitem" onClick={() => { const r = document.documentElement; const light = r.getAttribute("data-theme") === "light" || (!r.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: light)").matches); const t = light ? "dark" : "light"; r.setAttribute("data-theme", t); try { localStorage.setItem("ws.theme", t); } catch { /* storage unavailable */ } location.reload(); }}><Icon name="sun" size={14} /> Light / dark</button>
          <hr />
          <button role="menuitem" onClick={() => { if (confirm("Leave this game?")) { controller.stop(); navigate("/"); } }}><Icon name="close" size={14} /> Leave game</button>
        </div>
      )}
    </div>
  );
}
