import { useEffect, useMemo, useRef, useState } from "react";
import { DockviewReact, themeDark, themeLight, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { HOUR_MS, type View } from "@sentinel/protocol";
import { useStore } from "../store";
import { controller } from "./controller";
import { TheaterMap } from "../consoles/TheaterMap";
import { OrbitalConsole } from "../consoles/OrbitalConsole";
import { KillChainConsole } from "../consoles/KillChainConsole";
import { SensorConsole } from "../consoles/SensorConsole";
import { AirOpsBoard } from "../consoles/AirOpsBoard";
import { MaritimeConsole } from "../consoles/MaritimeConsole";
import { LandOpsConsole } from "../consoles/LandOpsConsole";
import { DroneConsole } from "../consoles/DroneConsole";
import { C2Graph } from "../consoles/C2Graph";
import { LogisticsConsole } from "../consoles/LogisticsConsole";
import { AgentConsole } from "../consoles/AgentConsole";
import { StrategicDashboard } from "../consoles/StrategicDashboard";
import { EventLog } from "../consoles/EventLog";
import { AarPanel } from "../consoles/AarPanel";
import { FACTOR_HELP, TEACH, explainFormula } from "../lib/explain";
import { simTime } from "../lib/format";
import { getUser } from "../lib/identity";
import { navigate } from "../router";

const PANELS: { id: string; title: string; C: React.FC }[] = [
  { id: "map", title: "1 · Global Theater Map", C: TheaterMap },
  { id: "orbital", title: "2 · Orbital", C: OrbitalConsole },
  { id: "killchain", title: "3 · Kill Chain", C: KillChainConsole },
  { id: "sensor", title: "4 · Sensor & Signature", C: SensorConsole },
  { id: "air", title: "5 · Air Operations", C: AirOpsBoard },
  { id: "maritime", title: "6 · Maritime", C: MaritimeConsole },
  { id: "land", title: "7 · Land Operations", C: LandOpsConsole },
  { id: "drone", title: "8 · Drone & Swarm", C: DroneConsole },
  { id: "c2", title: "9 · C2 Network", C: C2Graph },
  { id: "logistics", title: "10 · Logistics", C: LogisticsConsole },
  { id: "agents", title: "11 · Agent Reasoning", C: AgentConsole },
  { id: "strategic", title: "12 · Strategic Dashboard", C: StrategicDashboard },
  { id: "events", title: "Event Log", C: EventLog },
  { id: "aar", title: "After-Action Review", C: AarPanel },
];

const components = Object.fromEntries(PANELS.map((p) => [p.id, (_: IDockviewPanelProps) => <p.C />]));

function layout(api: DockviewApi) {
  const add = (id: string, position?: { referencePanel: string; direction: "right" | "below" | "within" | "left" | "above" }) => {
    const p = PANELS.find((x) => x.id === id)!;
    api.addPanel({ id, component: id, title: p.title, position });
  };
  add("map");
  add("agents", { referencePanel: "map", direction: "right" });
  add("strategic", { referencePanel: "agents", direction: "within" });
  add("killchain", { referencePanel: "agents", direction: "within" });
  add("aar", { referencePanel: "agents", direction: "within" });
  add("events", { referencePanel: "map", direction: "below" });
  for (const id of ["c2", "orbital", "logistics", "air", "maritime", "land", "drone", "sensor"]) add(id, { referencePanel: "events", direction: "within" });
  api.getPanel("map")?.api.setActive();
  api.getPanel("agents")?.api.setActive();
  api.getPanel("events")?.api.setActive();
  try {
    api.getPanel("map")?.group.api.setSize({ width: Math.round(window.innerWidth * 0.6) });
    api.getPanel("events")?.group.api.setSize({ height: Math.round(window.innerHeight * 0.36) });
  } catch { /* sizing is best effort */ }
}

function isLightTheme() {
  try {
    const forced = document.documentElement.getAttribute("data-theme");
    if (forced) return forced === "light";
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch { return false; }
}

export function SessionPage() {
  const mode = useStore((s) => s.mode);
  const meta = useStore((s) => s.meta);
  const toast = useStore((s) => s.toast);
  const explain = useStore((s) => s.explain);
  const teachEvent = useStore((s) => s.teachEvent);
  const apiRef = useRef<DockviewApi | null>(null);
  const light = useMemo(isLightTheme, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const st = useStore.getState();
      const owner = st.mode === "local" || st.meta?.owner === getUser().id;
      if (e.key === "Escape") st.set({ pick: null, explain: null, teachEvent: null });
      if (!owner) return;
      if (e.key === " ") { e.preventDefault(); controller.play(!st.playing); }
      if (e.key === "+" || e.key === "=") controller.setSpeed(Math.min(3600, st.speed * 2));
      if (e.key === "-") controller.setSpeed(Math.max(1, Math.round(st.speed / 2)));
      if (e.key === "n") controller.nextEvent();
      if (e.key === ".") controller.step();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!mode || !meta) return <div className="empty">Loading session…</div>;
  return (
    <div className="app">
      <TopBar />
      <div className="dock">
        <DockviewReact components={components} onReady={(e: DockviewReadyEvent) => { apiRef.current = e.api; layout(e.api); }} theme={light ? themeLight : themeDark} />
      </div>
      <Timeline />
      {toast && <div className={`toast${toast.bad ? " bad" : ""}`} role="status">{toast.text}</div>}
      {explain && <ExplainModal />}
      {teachEvent && <TeachingOverlay />}
    </div>
  );
}

const SPEEDS = [1, 10, 60, 300, 600, 1200, 3600];

function TopBar() {
  const meta = useStore((s) => s.meta)!;
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.view);
  const allowed = useStore((s) => s.allowedViews);
  const simMs = useStore((s) => s.simMs);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const actual = useStore((s) => s.actualSpeed);
  const teaching = useStore((s) => s.teaching);
  const connected = useStore((s) => s.connected);
  const joinCode = useStore((s) => s.joinCode);
  const ended = useStore((s) => s.ended);
  const set = useStore((s) => s.set);
  const owner = mode === "local" || meta.owner === getUser().id;
  const [injectOpen, setInjectOpen] = useState(false);
  const status = mode === "local" ? (playing ? "RUNNING" : ended ? "ENDED" : "PAUSED") : meta.status;

  const invite = () => {
    const url = `${location.origin}/s/${meta.id}?code=${joinCode ?? ""}`;
    navigator.clipboard?.writeText(url).then(() => useStore.getState().notify(`Invite link copied (join code ${joinCode ?? "—"}).`), () => useStore.getState().notify(url));
  };

  return (
    <header className="topbar">
      <button className="ghost brand" onClick={() => { controller.stop(); navigate("/"); }} title="Back to lobby">WARFARE SENTINEL</button>
      <span className="muted">{meta.scenarioName}</span>
      <span className={`pill ${status === "RUNNING" ? "ok" : status === "ENDED" ? "bad" : "warn"}`}>{mode === "local" ? "LOCAL" : `PROFILE ${meta.profile}`} · {status}</span>
      {mode !== "local" && <span className={`pill ${connected ? "ok" : "bad"}`} title="Hub connection">{connected ? "online" : "reconnecting"}</span>}
      {mode !== "local" && meta.profile === "B" && !meta.hostConnected && <span className="pill warn">host offline — paused</span>}
      <span className="clock" aria-live="off">{simTime(simMs)}</span>
      <div className="row" role="group" aria-label="View">
        {(["WHITE", "BLUE", "RED"] as View[]).filter((v) => allowed.includes(v)).map((v) => (
          <button key={v} className={`small ${view === v ? "primary" : ""}`} onClick={() => controller.switchView(v)} aria-pressed={view === v} title={v === "WHITE" ? "Ground truth (White cell)" : `${v} faction view (fog of war)`}>
            {v === "WHITE" ? "◎ Truth" : v === "BLUE" ? "■ Blue" : "◆ Red"}
          </button>
        ))}
      </div>
      {owner && (
        <div className="row">
          <button onClick={() => controller.play(!playing)} aria-label={playing ? "Pause" : "Play"} disabled={ended}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
          <button className="small" onClick={() => controller.step()} title="Step one tick (.)">Step</button>
          <button className="small" onClick={() => controller.nextEvent()} title="Run to the next notable event (n)">Next event</button>
          <select value={speed} onChange={(e) => controller.setSpeed(+e.target.value)} aria-label="Speed">{SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}</select>
          {playing && actual > 0 && Math.abs(actual - speed) / speed > 0.2 && <span className="dim" title="Actual simulated speed">≈{actual}×</span>}
          <button className="small" onClick={() => setInjectOpen((x) => !x)}>Inject</button>
          {mode !== "local" && <label className="row small" title="Zero LLM calls: every agent uses its rule-based policy"><input type="checkbox" checked={meta.rulesOnly} onChange={(e) => controller.rulesOnly(e.target.checked)} /> rules only</label>}
          <button className="small danger" onClick={() => { if (confirm("End the scenario and produce the after-action review?")) controller.end(); }}>End</button>
        </div>
      )}
      {!owner && <span className="dim">{playing ? `${speed}×` : "paused"} · time is controlled by the session owner</span>}
      <div className="row" style={{ marginLeft: "auto" }}>
        <label className="row small" title="Pause at notable events and explain the concept"><input type="checkbox" checked={teaching} onChange={(e) => set({ teaching: e.target.checked })} /> Teaching mode</label>
        {mode !== "local" && owner && <button className="small" onClick={invite}>Invite</button>}
        <button className="small" onClick={() => { const r = document.documentElement; r.setAttribute("data-theme", isLightTheme() ? "dark" : "light"); location.reload(); }} title="Toggle light/dark">◐</button>
      </div>
      {injectOpen && <InjectMenu onClose={() => setInjectOpen(false)} />}
    </header>
  );
}

function InjectMenu({ onClose }: { onClose: () => void }) {
  const scenario = useStore((s) => s.scenario);
  const items: { kind: string; text: string; faction?: "BLUE" | "RED" }[] = [
    { kind: "STORM", text: "A storm front moves into the theater" },
    { kind: "CONVOY", text: "A neutral convoy enters the theater" },
    { kind: "GNSS_OUTAGE", text: "GNSS interference over the theater", faction: "BLUE" },
    { kind: "CYBER_OUTAGE", text: "Cyber outage at Blue headquarters", faction: "BLUE" },
    { kind: "CYBER_OUTAGE", text: "Cyber outage at Red headquarters", faction: "RED" },
    { kind: "SAT_FAILURE", text: "A Blue satellite fails", faction: "BLUE" },
    { kind: "SAT_FAILURE", text: "A Red satellite fails", faction: "RED" },
    { kind: "CEASEFIRE_OFFER", text: "A mediator proposes a ceasefire" },
  ];
  return (
    <div className="card" style={{ position: "absolute", top: 46, right: 220, zIndex: 40, width: 300 }}>
      <div className="section-title">White-cell injects</div>
      {items.map((i, k) => (
        <button key={k} className="small" style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 4 }} onClick={() => { controller.inject({ ...i, at: scenario?.map.center }); useStore.getState().notify(`Inject queued: ${i.text}`); onClose(); }}>{i.text}</button>
      ))}
    </div>
  );
}

function Timeline() {
  const scenario = useStore((s) => s.scenario)!;
  const meta = useStore((s) => s.meta)!;
  const mode = useStore((s) => s.mode);
  const simMs = useStore((s) => s.simMs);
  const events = useStore((s) => s.events);
  const [drag, setDrag] = useState<number | null>(null);
  const total = scenario.durationH * HOUR_MS;
  const tickMs = scenario.rules.tickMs;
  const owner = mode === "local" || meta.owner === getUser().id;
  const notable = useMemo(() => events.filter((e) => e.notable).slice(-200), [events]);
  const value = drag ?? simMs;
  const commit = async (ms: number) => {
    setDrag(null);
    const tick = Math.round(ms / tickMs);
    if (mode === "local") {
      controller.seek(tick);
      useStore.getState().notify(ms < simMs ? `Rewound to ${simTime(ms)} — replayed deterministically from the nearest snapshot. Changes from here form a new branch.` : `Fast-forwarded to ${simTime(ms)}.`);
    } else if (mode === "host" && ms < simMs) {
      if (!confirm(`Branch a new session from ${simTime(ms)}? The current session continues unchanged.`)) return;
      try {
        const created = await controller.seek(tick);
        if (created) {
          controller.stop();
          navigate(`/s/${created.session.id}`, created);
        }
      } catch (e) {
        useStore.getState().notify(String((e as Error).message), true);
      }
    }
  };
  return (
    <footer className="timeline">
      <span className="mono dim">D+0</span>
      <div className="track">
        {notable.map((e) => (
          <div key={`${e.seq}-${e.type}`} className={`mark${/DESTROY|BROKEN|HARM|ESCALATION/.test(e.type) ? " bad" : ""}`} style={{ left: `${(e.simMs / total) * 100}%` }} title={`${simTime(e.simMs)} ${e.text}`} onClick={() => useStore.getState().set({ explain: e })} />
        ))}
        <input type="range" min={0} max={total} step={tickMs} value={value} disabled={!owner || mode === "viewer"} aria-label="Timeline scrubber"
          onChange={(e) => setDrag(+e.target.value)} onMouseUp={() => drag !== null && commit(drag)} onKeyUp={(e) => e.key === "Enter" && drag !== null && commit(drag)} onTouchEnd={() => drag !== null && commit(drag)} />
      </div>
      <span className="mono">{simTime(value)}</span>
      <span className="dim" style={{ fontSize: 11 }}>{mode === "local" ? "drag back to rewind & branch" : mode === "host" ? "drag back to branch" : "live"}</span>
    </footer>
  );
}

function ExplainModal() {
  const e = useStore((s) => s.explain)!;
  const set = useStore((s) => s.set);
  const formula = explainFormula(e);
  const teach = TEACH[e.type];
  return (
    <div className="modal-back" onClick={() => set({ explain: null })}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="Explain">
        <div className="row"><h3>Why: {e.type.replace(/_/g, " ").toLowerCase()}</h3><span className="mono dim" style={{ marginLeft: "auto" }}>#{e.seq} · {simTime(e.simMs)}</span></div>
        <p>{e.text}</p>
        {formula && <p className="mono" style={{ fontSize: 12, background: "var(--bg-2)", padding: 8, borderRadius: 6 }}>{formula}</p>}
        {e.factors && (
          <table className="grid"><thead><tr><th>Factor</th><th>Value</th><th>Meaning</th></tr></thead>
            <tbody>{Object.entries(e.factors).map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td className="mono">{String(v)}</td><td className="dim">{FACTOR_HELP[k] ?? ""}</td></tr>)}</tbody></table>
        )}
        {teach && <p className="muted" style={{ marginTop: 10 }}><b>{teach.title}.</b> {teach.body}</p>}
        {e.rng !== undefined && <p className="dim" style={{ fontSize: 11 }}>Random draws used: {e.rng}. Same seed and orders reproduce this exactly.</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          {e.entities?.[0] && <button onClick={() => set({ selected: e.entities![0], explain: null })}>Select unit</button>}
          <button className="primary" onClick={() => set({ explain: null })}>Close</button>
        </div>
      </div>
    </div>
  );
}

function TeachingOverlay() {
  const e = useStore((s) => s.teachEvent)!;
  const set = useStore((s) => s.set);
  const mode = useStore((s) => s.mode);
  const t = TEACH[e.type];
  useEffect(() => {
    const st = useStore.getState();
    if ((mode === "local" || st.meta?.owner === getUser().id) && st.playing) controller.play(false);
  }, [e, mode]);
  if (!t) return null;
  return (
    <aside className="teach" role="dialog" aria-label="Teaching mode">
      <h3>{t.title}</h3>
      <p style={{ margin: "4px 0 8px" }}>{t.body}</p>
      <p className="dim" style={{ fontSize: 12 }}>{simTime(e.simMs)} — {e.text}</p>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        {e.factors && <button className="small" onClick={() => set({ explain: e })}>Explain</button>}
        <button className="small primary" onClick={() => { set({ teachEvent: null }); controller.play(true); }}>Continue</button>
      </div>
    </aside>
  );
}
