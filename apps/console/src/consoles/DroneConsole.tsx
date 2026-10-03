// Console 8 — Drone and Swarm Console: a flocking animation of the selected swarm (datalink vs onboard
// autonomy under jamming), link status, attrition tally and the cost-exchange of attritable mass.
import { useEffect, useMemo, useRef, useState } from "react";
import { getClass, hasClass } from "@sentinel/catalog";
import { useStore } from "../store";
import { Console, useEntities, useVersion } from "./common";
import { clsName } from "../lib/format";

interface Boid { x: number; y: number; vx: number; vy: number; alive: boolean }

export function DroneConsole() {
  const v = useVersion();
  const view = useStore((s) => s.view);
  const politics = useStore((s) => s.politics);
  const events = useStore((s) => s.events);
  const ew = useStore((s) => s.ew);
  const drones = useEntities((e) => e.domain === "DRONE" && (view === "WHITE" || e.faction === view));
  const swarms = drones.filter((d) => !d.destroyed && (d.count ?? 1) > 1);
  const [pick, setPick] = useState("");
  const selected = useStore((s) => s.selected);
  const swarm = swarms.find((s) => s.id === selected) ?? swarms.find((s) => s.id === pick) ?? swarms[0];
  const jammed = !!swarm && (swarm.comms !== "OK" || ew.some((f) => f.faction !== swarm.faction && Math.hypot((f.lat - swarm.lat) * 111, (f.lon - swarm.lon) * 85) < f.radiusKm));
  const canvas = useRef<HTMLCanvasElement>(null);
  const boids = useRef<Boid[]>([]);
  const meta = useRef({ alive: 0, jammed: false, target: 0 });
  meta.current = { alive: swarm?.count ?? 0, jammed, target: swarm?.task === "ATTACK" || swarm?.task === "STRIKE" ? 1 : 0 };

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const step = () => {
      const W = c.width = c.clientWidth * devicePixelRatio, H = c.height = c.clientHeight * devicePixelRatio;
      const m = meta.current;
      const max = getClass(swarm?.cls && hasClass(swarm.cls) ? swarm.cls : "quad_swarm").members ?? 40;
      while (boids.current.length < max) boids.current.push({ x: Math.random() * W, y: Math.random() * H, vx: Math.random() - 0.5, vy: Math.random() - 0.5, alive: true });
      boids.current.forEach((b, i) => (b.alive = i < m.alive));
      const goal = { x: m.target ? W * 0.82 : W / 2, y: H / 2 };
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(213,94,0,0.08)";
      if (m.jammed) ctx.fillRect(0, 0, W, H);
      if (m.target) { ctx.strokeStyle = "#e5533d"; ctx.beginPath(); ctx.arc(goal.x, goal.y, 14 * devicePixelRatio, 0, Math.PI * 2); ctx.stroke(); }
      const alive = boids.current.filter((b) => b.alive);
      for (const b of alive) {
        let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, n = 0;
        for (const o of alive) {
          if (o === b) continue;
          const dx = o.x - b.x, dy = o.y - b.y, d = Math.hypot(dx, dy);
          if (d < 80 * devicePixelRatio) { cx += o.x; cy += o.y; ax += o.vx; ay += o.vy; n++; if (d < 14 * devicePixelRatio) { sx -= dx / d; sy -= dy / d; } }
        }
        // With a datalink the swarm coheres on the goal; under jamming each drone falls back to weaker onboard autonomy.
        const cohesion = m.jammed ? 0.0004 : 0.002, align = m.jammed ? 0.01 : 0.05, seek = m.jammed ? 0.0004 : 0.0025;
        if (n) { b.vx += (cx / n - b.x) * cohesion + (ax / n - b.vx) * align; b.vy += (cy / n - b.y) * cohesion + (ay / n - b.vy) * align; }
        b.vx += sx * 0.12 + (goal.x - b.x) * seek + (m.jammed ? (Math.random() - 0.5) * 0.6 : 0);
        b.vy += sy * 0.12 + (goal.y - b.y) * seek + (m.jammed ? (Math.random() - 0.5) * 0.6 : 0);
        const sp = Math.hypot(b.vx, b.vy), lim = 2.4 * devicePixelRatio;
        if (sp > lim) { b.vx = (b.vx / sp) * lim; b.vy = (b.vy / sp) * lim; }
        b.x = (b.x + b.vx + W) % W;
        b.y = (b.y + b.vy + H) % H;
        ctx.fillStyle = swarm?.faction === "RED" ? "#e0662a" : "#2b8fd6";
        ctx.beginPath();
        const a = Math.atan2(b.vy, b.vx), s = 5 * devicePixelRatio;
        ctx.moveTo(b.x + Math.cos(a) * s, b.y + Math.sin(a) * s);
        ctx.lineTo(b.x + Math.cos(a + 2.5) * s * 0.6, b.y + Math.sin(a + 2.5) * s * 0.6);
        ctx.lineTo(b.x + Math.cos(a - 2.5) * s * 0.6, b.y + Math.sin(a - 2.5) * s * 0.6);
        ctx.fill();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [swarm?.id, swarm?.cls, swarm?.faction]);

  const exchange = useMemo(() => {
    // Cost of drones lost vs cost of what drones destroyed, from destruction events visible to this view.
    const droneIds = new Set([...useStore.getState().entities.values()].filter((e) => e.domain === "DRONE").map((e) => e.id));
    let lost = 0, killed = 0;
    for (const e of events) {
      if (e.type !== "ENTITY_DESTROYED" || !e.entities) continue;
      const cost = Number(e.factors?.cost ?? 0);
      const [victim, killer] = e.entities;
      if (droneIds.has(victim)) lost += cost;
      else if (killer && droneIds.has(killer)) killed += cost;
    }
    return { lost, killed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  const maxEx = Math.max(1, exchange.lost, exchange.killed);

  return (
    <Console title="Drone and Swarm Console" concept="Attritable mass; autonomy vs datalink dependence"
      tools={
        <select value={swarm?.id ?? ""} onChange={(e) => setPick(e.target.value)} aria-label="Swarm">
          {swarms.length === 0 && <option value="">no swarms</option>}
          {swarms.map((s) => <option key={s.id} value={s.id}>{s.callsign} · {clsName(s.cls)} ({s.count})</option>)}
        </select>
      }>
      <div className="row wrap" style={{ alignItems: "stretch", gap: 12 }}>
        <div style={{ flex: "2 1 280px", minHeight: 200, position: "relative", border: "1px solid var(--line)", borderRadius: 8 }}>
          <canvas ref={canvas} style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }} aria-label="Swarm flocking animation" />
          <div style={{ position: "absolute", left: 8, top: 6, fontSize: 11 }}>
            {swarm ? <>{swarm.callsign}: {swarm.count} alive · task {swarm.task} · link <b className={jammed ? "badge-red" : ""}>{jammed ? "JAMMED → onboard autonomy" : "datalink OK"}</b></> : <span className="dim">No swarm in this view.</span>}
          </div>
        </div>
        <div style={{ flex: "1 1 220px" }} className="col">
          <div className="section-title">Cost exchange (points)</div>
          <svg viewBox="0 0 220 60" style={{ width: "100%" }} role="img" aria-label="cost exchange">
            <rect x={70} y={6} height={18} width={(exchange.lost / maxEx) * 140} fill="var(--bad)" /><text x={0} y={19} fontSize={10} fill="var(--text-2)">drones lost</text><text x={74 + (exchange.lost / maxEx) * 140} y={19} fontSize={10} fill="var(--text)">{exchange.lost}</text>
            <rect x={70} y={32} height={18} width={(exchange.killed / maxEx) * 140} fill="var(--ok)" /><text x={0} y={45} fontSize={10} fill="var(--text-2)">killed by drones</text><text x={74 + (exchange.killed / maxEx) * 140} y={45} fontSize={10} fill="var(--text)">{exchange.killed}</text>
          </svg>
          <div className="dim" style={{ fontSize: 11 }}>Ratio {exchange.lost ? (exchange.killed / exchange.lost).toFixed(1) : "—"} : 1 — cheap drones only pay off if they trade up.</div>
          <div className="section-title">Attrition tally (drone domain)</div>
          {politics?.factions.map((f) => <div key={f.faction} style={{ fontSize: 12 }} className={f.faction === "BLUE" ? "badge-blue" : "badge-red"}>{f.name}: lost {f.losses.DRONE}, killed {f.kills.DRONE}</div>)}
        </div>
      </div>
      <div className="section-title" style={{ marginTop: 8 }}>Link status</div>
      <table className="grid">
        <thead><tr><th>Drone</th><th>Class</th><th>Task</th><th>Link</th><th>Fuel</th><th>Members</th></tr></thead>
        <tbody>
          {drones.filter((d) => !d.destroyed).slice(0, 80).map((d) => (
            <tr key={d.id} className={`click${selected === d.id ? " sel" : ""}`} onClick={() => useStore.getState().select(d.id)}>
              <td>{d.callsign}</td><td>{clsName(d.cls)}</td><td>{d.task}</td>
              <td><span className={`pill ${d.comms === "OK" ? "ok" : d.comms === "DEGRADED" ? "warn" : "bad"}`}>{d.comms}</span></td>
              <td>{Math.round(d.fuel * 100)}%</td><td>{d.count ?? 1}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Console>
  );
}
