// First-run introduction (what the game is, how to win, the screen, the controls) and a guided tour
// that points at each part of the live screen. Both can be reopened from the help button.
import { useEffect, useLayoutEffect, useState } from "react";
import { useGame } from "../game/store";
import { Icon } from "./Icons";

const SLIDES: { title: string; body: React.ReactNode }[] = [
  {
    title: "You are the commander",
    body: (
      <>
        <p>A crisis between two fictional nations. You lead one side from a war room. Your AI staff (intelligence, operations, logistics and communications) run the ships, aircraft, troops, drones and satellites, and report to you.</p>
        <p>Reports arrive faster than anyone can read them. Your staff sort them and bring you only what matters, and the decisions only you can make. <b>Your job is to decide.</b></p>
      </>
    ),
  },
  {
    title: "How you win",
    body: (
      <ul className="intro-list">
        <li><Icon name="flag" size={16} /> <span><b>Hold your objectives.</b> Each hour you hold one earns victory points and boosts national will.</span></li>
        <li><Icon name="target" size={16} /> <span><b>Break the enemy's will.</b> Destroy their forces and deny their aims. A nation whose will reaches zero seeks terms, and loses.</span></li>
        <li><Icon name="clock" size={16} /> <span><b>Or lead when time runs out.</b> If neither side breaks, the higher victory-point score wins.</span></li>
        <li><Icon name="critical" size={16} /> <span><b>Avoid catastrophe.</b> Losses and civilian harm drain your own will. Escalating to the top rung ends the game for everyone.</span></li>
      </ul>
    ),
  },
  {
    title: "Your war room",
    body: (
      <div className="intro-layout" aria-label="Screen layout">
        <div className="il-top">Mission · score · clock · play / pause</div>
        <div className="il-map">Map<small>your forces, enemy contacts, objectives</small></div>
        <div className="il-side">Staff briefing<small>decisions needed and reports, most urgent first</small><br />Actions<small>intent, escalation and one-click plays</small></div>
        <div className="il-status">Status board<small>key numbers; tap for details</small></div>
        <div className="il-ask">Ask your staff<small>type or speak</small></div>
      </div>
    ),
  },
  {
    title: "Making decisions",
    body: (
      <ul className="intro-list">
        <li><Icon name="warning" size={16} /> <span><b>Decision cards.</b> Your staff lay out options and consequences and recommend one. On Recruit the game waits for you; on harder levels they act on their advice when time runs out.</span></li>
        <li><Icon name="bolt" size={16} /> <span><b>Plays.</b> One-click actions: surge surveillance, air cover, reinforce, strike the top threat, resupply and more.</span></li>
        <li><Icon name="target" size={16} /> <span><b>Direct orders.</b> Tap one of your units, pick an order, then tap the map.</span></li>
        <li><Icon name="mic" size={16} /> <span><b>Ask.</b> “Where is the enemy fleet?”, “What should I do?”, “Go defensive”. Type, or press the microphone.</span></li>
      </ul>
    ),
  },
  {
    title: "Controls",
    body: (
      <table className="keys">
        <tbody>
          <tr><td><kbd>Space</kbd></td><td>Pause / resume</td></tr>
          <tr><td><kbd>1</kbd>–<kbd>4</kbd></td><td>Speed: slow, normal, fast, max</td></tr>
          <tr><td><kbd>/</kbd></td><td>Ask your staff</td></tr>
          <tr><td><kbd>M</kbd></td><td>Speak</td></tr>
          <tr><td><kbd>C</kbd></td><td>Show the whole theater</td></tr>
          <tr><td><kbd>?</kbd></td><td>Tour of the screen</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Close / deselect</td></tr>
        </tbody>
      </table>
    ),
  },
];

export function Intro({ onDone }: { onDone?: () => void }) {
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const close = (tour: boolean) => {
    try { localStorage.setItem("ws.intro", "1"); } catch { /* storage unavailable */ }
    useGame.setState({ intro: false, tour: tour ? 0 : null });
    onDone?.();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((x) => Math.min(SLIDES.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const s = SLIDES[i];
  return (
    <div className="modal-back intro-back">
      <div className="modal intro" role="dialog" aria-label="How to play" aria-modal="true">
        <div className="intro-step">{i + 1} / {SLIDES.length}</div>
        <h2>{s.title}</h2>
        <div className="intro-body">{s.body}</div>
        <div className="dots" aria-hidden="true">{SLIDES.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}</div>
        <div className="row">
          <button className="ghost" onClick={() => close(false)}>Skip</button>
          <span className="grow" />
          {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}
          {!last && <button className="primary" onClick={() => setI(i + 1)}>Next</button>}
          {last && <button onClick={() => close(false)}>Start playing</button>}
          {last && <button className="primary" onClick={() => close(true)}>Show me around</button>}
        </div>
      </div>
    </div>
  );
}

const TOUR: { sel: string; title: string; text: string }[] = [
  { sel: "mission", title: "Your mission", text: "Your objectives in a word each. Tap for the full picture: who holds what, national will and escalation." },
  { sel: "score", title: "The score", text: "Victory points: yours against the enemy's estimate. Holding objectives and keeping national will high raise yours." },
  { sel: "time", title: "Time", text: "Pause any time to think (Space). Speeds are named by how long a simulated hour takes." },
  { sel: "briefing", title: "Staff briefing", text: "The bottom line first, then decisions your staff need, then reports sorted by urgency. Similar reports are grouped. Tap one for detail and to see it on the map." },
  { sel: "actions", title: "Your actions", text: "Set your main effort and posture, climb or step down the escalation ladder, and launch plays. Grey buttons tell you why they are not possible yet." },
  { sel: "status", title: "Status board", text: "The key numbers at a glance, colored by severity. Tap any tile for the expert console behind it." },
  { sel: "legend", title: "Legend", text: "What each symbol and ring means. Collapse it when you need the space." },
  { sel: "ask", title: "Ask your staff", text: "Type or speak: “how are we doing?”, “where is the enemy fleet?”, “strike the top threat”. Orders wait for your confirmation." },
];

export function Tour() {
  const step = useGame((s) => s.tour);
  const [box, setBox] = useState<DOMRect | null>(null);
  const t = step !== null ? TOUR[step] : null;
  useLayoutEffect(() => {
    if (!t) return;
    const find = () => {
      const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${t.sel}"]`)].find((x) => x.offsetParent !== null);
      if (!el) return setBox(null);
      el.scrollIntoView({ block: "nearest" });
      setBox(el.getBoundingClientRect());
    };
    find();
    window.addEventListener("resize", find);
    return () => window.removeEventListener("resize", find);
  }, [t]);
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useGame.setState({ tour: null });
      if (e.key === "ArrowRight" || e.key === "Enter") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (step === null || !t) return null;
  const next = () => useGame.setState({ tour: step + 1 < TOUR.length ? step + 1 : null });
  // Skip steps whose target is not on screen (e.g. a hidden mobile tab).
  if (!box) {
    return (
      <div className="tour-tip center" role="dialog" aria-label={t.title}>
        <b>{t.title}</b><p>{t.text}</p>
        <div className="row"><span className="dim">{step + 1} / {TOUR.length}</span><span className="grow" /><button className="ghost small" onClick={() => useGame.setState({ tour: null })}>End tour</button><button className="primary small" onClick={next}>{step + 1 < TOUR.length ? "Next" : "Done"}</button></div>
      </div>
    );
  }
  const below = box.top < window.innerHeight / 2;
  const left = Math.max(12, Math.min(window.innerWidth - 332, box.left + box.width / 2 - 160));
  return (
    <>
      <div className="tour-spot" style={{ left: box.left - 6, top: box.top - 6, width: box.width + 12, height: box.height + 12 }} />
      <div className="tour-tip" role="dialog" aria-label={t.title} style={{ left, top: below ? Math.min(window.innerHeight - 180, box.bottom + 14) : undefined, bottom: below ? undefined : Math.max(12, window.innerHeight - box.top + 14) }}>
        <b>{t.title}</b><p>{t.text}</p>
        <div className="row"><span className="dim">{step + 1} / {TOUR.length}</span><span className="grow" /><button className="ghost small" onClick={() => useGame.setState({ tour: null })}>End tour</button><button className="primary small" onClick={next}>{step + 1 < TOUR.length ? "Next" : "Done"}</button></div>
      </div>
    </>
  );
}
