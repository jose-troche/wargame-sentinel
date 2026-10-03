// Console 5 — Air Operations Board: the air tasking order as a Gantt chart, CAP stations, tanker
// tracks and sortie-rate gauges. Shows that sortie generation and tankers limit air power.
import { useMemo } from "react";
import { useStore } from "../store";
import { Console, useEntities, useVersion } from "./common";
import { simTime } from "../lib/format";

const TASK_COLOR: Record<string, string> = { CAP: "#56b4e9", STRIKE: "#e5533d", ISR: "#cc79a7", TANK: "#e6b800", ESCORT: "#3fb68b", ATTACK: "#d55e00", PATROL: "#9aa8c0", MOVE: "#9aa8c0", JAM: "#cc79a7" };

function Gauge({ value, label, sub }: { value: number; label: string; sub: string }) {
  const a = Math.PI * Math.max(0, Math.min(1, value));
  const x = 40 - 32 * Math.cos(a), y = 42 - 32 * Math.sin(a);
  return (
    <svg viewBox="0 0 80 56" width={110} role="img" aria-label={`${label} ${Math.round(value * 100)}%`}>
      <path d="M8 42 A32 32 0 0 1 72 42" fill="none" stroke="var(--line)" strokeWidth={7} />
      <path d={`M8 42 A32 32 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke="var(--accent)" strokeWidth={7} />
      <text x={40} y={40} textAnchor="middle" fontSize={12} fill="var(--text)" fontWeight={600}>{Math.round(value * 100)}%</text>
      <text x={40} y={53} textAnchor="middle" className="gauge-label">{sub}</text>
    </svg>
  );
}

export function AirOpsBoard() {
  const v = useVersion();
  const air = useStore((s) => s.air);
  const simMs = useStore((s) => s.simMs);
  const select = useStore((s) => s.select);
  const selected = useStore((s) => s.selected);
  const entities = useStore((s) => s.entities);
  const tankers = useEntities((e) => e.cls === "tanker" && !e.destroyed);
  const window0 = simMs - 4 * 3_600_000, window1 = simMs + 12 * 3_600_000;

  const rows = useMemo(() => {
    const ms = (air?.missions ?? []).filter((m) => m.endMs >= window0 && m.startMs <= window1);
    const byUnit = new Map<string, typeof ms>();
    for (const m of ms) byUnit.set(m.unit, [...(byUnit.get(m.unit) ?? []), m]);
    return [...byUnit.entries()].slice(0, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  const caps = (air?.missions ?? []).filter((m) => m.task === "CAP" && m.status === "ACTIVE").length;
  const W = 1000;
  const x = (t: number) => ((Math.max(window0, Math.min(window1, t)) - window0) / (window1 - window0)) * W;

  return (
    <Console title="Air Operations Board" concept="Sortie generation and tanker dependence" tools={<span className="muted">ATO window {simTime(window0)} → {simTime(window1)}</span>}>
      <div className="row wrap" style={{ gap: 10, marginBottom: 6 }}>
        {(air?.sortieRate ?? []).map((b) => (
          <div key={b.base} className="col" style={{ alignItems: "center", gap: 0 }}>
            <Gauge value={b.rate} label={b.base} sub="airborne" />
            <div style={{ fontSize: 11 }} className={b.faction === "BLUE" ? "badge-blue" : "badge-red"}>{b.base.replace(/@.*/, "")} base</div>
            <div className="dim" style={{ fontSize: 10 }}>{Math.round(b.readiness * 100)}% ready on deck</div>
          </div>
        ))}
        <div className="col" style={{ gap: 2, marginLeft: 8 }}>
          <div className="section-title">CAP stations active</div><b className="mono" style={{ fontSize: 20 }}>{caps}</b>
          <div className="section-title">Tankers</div>
          {tankers.length === 0 ? <span className="dim">none</span> : tankers.map((t) => <span key={t.id} style={{ fontSize: 12 }}>{t.callsign}: {t.task} · fuel {Math.round(t.fuel * 100)}%</span>)}
        </div>
      </div>
      <div className="section-title">Air tasking order</div>
      {rows.length === 0 && <div className="empty">No missions in the window. The Air Component issues ATO lines (CAP, STRIKE, ISR, TANK) on its cadence.</div>}
      <svg viewBox={`0 0 ${W + 160} ${rows.length * 16 + 18}`} style={{ width: "100%" }} role="img" aria-label="ATO Gantt chart">
        <line x1={160 + x(simMs)} x2={160 + x(simMs)} y1={0} y2={rows.length * 16 + 14} stroke="var(--accent-2)" strokeDasharray="3 3" />
        {rows.map(([unit, ms], i) => (
          <g key={unit} transform={`translate(0 ${i * 16 + 4})`} onClick={() => select(unit)} style={{ cursor: "pointer" }}>
            <text x={0} y={10} fontSize={10} fill={selected === unit ? "var(--accent-2)" : "var(--text-2)"}>{entities.get(unit)?.callsign ?? unit}</text>
            {ms.map((m) => (
              <rect key={m.id} x={160 + x(m.startMs)} width={Math.max(2, x(m.endMs) - x(m.startMs))} y={1} height={11} rx={2}
                fill={TASK_COLOR[m.task] ?? "#888"} opacity={m.status === "DONE" ? 0.35 : m.status === "ABORTED" ? 0.2 : m.status === "PLANNED" ? 0.6 : 1}
                stroke={m.status === "ABORTED" ? "var(--bad)" : "none"}>
                <title>{`${m.task} ${m.status} ${simTime(m.startMs)}–${simTime(m.endMs)}`}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      <div className="legend">{Object.entries(TASK_COLOR).slice(0, 6).map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}<span className="dim">faded = done/planned</span></div>
    </Console>
  );
}
