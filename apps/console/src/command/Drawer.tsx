// Drill-down: the expert consoles behind each part of the briefing, opened in a side drawer
// (full screen on phones) with a plain-language note on what the console shows.
import { useEffect, useState } from "react";
import { useGame } from "../game/store";
import type { Drill } from "../game/types";
import { StrategicDashboard } from "../consoles/StrategicDashboard";
import { LandOpsConsole } from "../consoles/LandOpsConsole";
import { MaritimeConsole } from "../consoles/MaritimeConsole";
import { AirOpsBoard } from "../consoles/AirOpsBoard";
import { DroneConsole } from "../consoles/DroneConsole";
import { LogisticsConsole } from "../consoles/LogisticsConsole";
import { C2Graph } from "../consoles/C2Graph";
import { SensorConsole } from "../consoles/SensorConsole";
import { OrbitalConsole } from "../consoles/OrbitalConsole";
import { KillChainConsole } from "../consoles/KillChainConsole";
import { AgentConsole } from "../consoles/AgentConsole";
import { EventLog } from "../consoles/EventLog";
import { Icon } from "./Icons";

interface Tab { id: string; title: string; C: React.FC; about: string }

const DRILLS: Record<Drill, { title: string; tabs: Tab[] }> = {
  strategic: { title: "Strategy", tabs: [{ id: "strategic", title: "Objectives, will and escalation", C: StrategicDashboard, about: "How battles turn into the strategic result: who holds each objective and for how long, both sides' national will over time, the escalation ladder and losses by domain." }] },
  forces: {
    title: "Our forces", tabs: [
      { id: "land", title: "Land", C: LandOpsConsole, about: "Ground formations, the front line, where we have the advantage in combat power (green) or the enemy does (red), and supply status." },
      { id: "maritime", title: "Sea", C: MaritimeConsole, about: "Ship groups, the enemy's missile and air-defense umbrellas (rings), chokepoints and where enemy submarines may be." },
      { id: "air", title: "Air", C: AirOpsBoard, about: "The air tasking schedule: which aircraft fly which mission when, and how many sorties each base can generate." },
      { id: "drones", title: "Drones", C: DroneConsole, about: "Drone swarms, whether they are flying by datalink or on their own autonomy under jamming, and what they cost compared to what they destroy." },
    ],
  },
  logistics: { title: "Logistics", tabs: [{ id: "logistics", title: "Supply", C: LogisticsConsole, about: "Supply flowing from depots to units (wider = more), routes the enemy has cut, and how many days of supply each unit has left." }] },
  c2: { title: "Communications", tabs: [{ id: "c2", title: "Command network", C: C2Graph, about: "How orders reach units: headquarters, satellites and relays as nodes, links colored by delay. Dashed links are jammed; hollow red units cannot be reached." }] },
  intel: {
    title: "Intelligence", tabs: [
      { id: "sensor", title: "Sensors", C: SensorConsole, about: "Why something was or was not detected: sensor range against how visible the target is, radar horizon, and jamming." },
      { id: "orbital", title: "Space", C: OrbitalConsole, about: "Satellites overhead, when they pass over the theater, and the gaps between passes when nothing is watching." },
    ],
  },
  killchain: { title: "Strikes", tabs: [{ id: "killchain", title: "Kill chains", C: KillChainConsole, about: "Each strike as a row of steps (find, fix, track, target, engage, assess). Red marks the step that failed and why." }] },
  orbital: { title: "Space", tabs: [{ id: "orbital", title: "Orbits", C: OrbitalConsole, about: "Satellites overhead, when they pass over the theater, and the gaps between passes when nothing is watching." }] },
  agents: { title: "Your staff", tabs: [{ id: "agents", title: "Staff reasoning", C: AgentConsole, about: "Your AI staff: who decided what and why, the courses of action your planners considered, and the message trail of every order." }] },
  events: { title: "Event log", tabs: [{ id: "events", title: "Everything that happened", C: EventLog, about: "The full record of events your side can see, newest first. Use Explain for the factors behind any outcome." }] },
};

export function Drawer() {
  const drill = useGame((s) => s.drawer);
  const [tab, setTab] = useState(0);
  useEffect(() => setTab(0), [drill]);
  useEffect(() => {
    if (!drill) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useGame.setState({ drawer: null });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drill]);
  if (!drill) return null;
  const d = DRILLS[drill];
  const t = d.tabs[Math.min(tab, d.tabs.length - 1)];
  return (
    <div className="drawer-back" onClick={() => useGame.setState({ drawer: null })}>
      <aside className="drawer" role="dialog" aria-label={d.title} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>{d.title}</h2>
          {d.tabs.length > 1 && (
            <div className="segmented" role="tablist">
              {d.tabs.map((x, i) => <button key={x.id} role="tab" aria-selected={i === tab} className={i === tab ? "on" : ""} onClick={() => setTab(i)}>{x.title}</button>)}
            </div>
          )}
          <span className="grow" />
          <button className="ghost" onClick={() => useGame.setState({ drawer: null })} aria-label="Close"><Icon name="close" /></button>
        </header>
        <p className="drawer-about">{t.about}</p>
        <div className="drawer-body"><t.C key={t.id} /></div>
      </aside>
    </div>
  );
}
