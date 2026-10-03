// Console 4 — Sensor and Signature Console: detection physics made visible. A live P_d calculator,
// detection range versus target signature, the radar horizon, a sonar layer cross-section and EW fields.
import { useMemo, useState } from "react";
import { BAND_FACTOR, RANGE_KM, getClass, hasClass } from "@sentinel/catalog";
import { BANDS, type Band } from "@sentinel/protocol";
import { useStore } from "../store";
import { Console, useEntities } from "./common";
import { clsName } from "../lib/format";

const K = 0.7;
const pdOf = (S: number, sigma: number, r: number, E: number, J: number, passive: boolean) => 1 - Math.exp((-K * S * sigma * E * (1 - J)) / Math.max(0.05 ** 4, passive ? r * r : r ** 4));
const horizon = (h1: number, h2: number) => 4.12 * (Math.sqrt(Math.max(0, h1)) + Math.sqrt(Math.max(0, h2)));

export function SensorConsole() {
  const selected = useStore((s) => s.selected);
  const view = useStore((s) => s.view);
  const ew = useStore((s) => s.ew);
  const own = useEntities((e) => !e.destroyed && hasClass(e.cls) && getClass(e.cls).sensors.length > 0 && (view === "WHITE" || e.faction === view));
  const [pick, setPick] = useState<string>("");
  const ent = own.find((e) => e.id === (selected && own.some((x) => x.id === selected) ? selected : pick)) ?? own[0];
  const cls = ent ? getClass(ent.cls) : null;
  const [sensorIdx, setSensorIdx] = useState(0);
  const sensor = cls?.sensors[Math.min(sensorIdx, (cls?.sensors.length ?? 1) - 1)];
  const [sigBand, setSigBand] = useState<Band>("medium");
  const [rangePct, setRangePct] = useState(70);
  const [env, setEnv] = useState(1);
  const [jam, setJam] = useState(0);
  const [tgtAlt, setTgtAlt] = useState(100);

  const calc = useMemo(() => {
    if (!sensor) return null;
    const S = BAND_FACTOR[sensor.strength];
    const sigma = BAND_FACTOR[sigBand];
    const rangeKm = RANGE_KM[sensor.range];
    const R = (rangePct / 100) * rangeKm;
    const passive = sensor.type === "PASSIVE_RF" || sensor.type === "SIGINT";
    const pd = pdOf(S, sigma, rangePct / 100, env, jam, passive);
    const rings = (["very_low", "low", "medium", "high", "very_high"] as Band[]).map((b) => {
      // Range where P_d = 0.5 for this signature band.
      const x = (K * S * BAND_FACTOR[b] * env * (1 - jam)) / Math.LN2;
      const r = passive ? Math.sqrt(x) : Math.pow(x, 0.25);
      return { band: b, km: Math.min(rangeKm * 2, r * rangeKm) };
    });
    return { S, sigma, R, rangeKm, pd, passive, rings };
  }, [sensor, sigBand, rangePct, env, jam]);

  const sensorAlt = ent ? Math.max(10, ent.alt) : 10;
  const hz = Array.from({ length: 21 }, (_, i) => {
    const h = i * 600;
    return { h, d: horizon(sensorAlt, h) };
  });
  const maxD = Math.max(...hz.map((x) => x.d));

  return (
    <Console
      title="Sensor and Signature Console"
      concept="Detection physics: stealth, emissions control and EW trade-offs"
      tools={
        <select value={ent?.id ?? ""} onChange={(e) => { setPick(e.target.value); useStore.getState().select(e.target.value); }} aria-label="Sensor platform">
          {own.slice(0, 300).map((e) => <option key={e.id} value={e.id}>{e.callsign} · {clsName(e.cls)}</option>)}
        </select>
      }
    >
      {!ent || !cls || !sensor || !calc ? <div className="empty">Select a unit with sensors.</div> : (
        <div className="col" style={{ gap: 12 }}>
          <div className="row wrap">
            {cls.sensors.map((s, i) => (
              <button key={i} className={`small ${i === sensorIdx ? "primary" : ""}`} onClick={() => setSensorIdx(i)}>{s.type} · {s.range} · {s.strength}</button>
            ))}
            {ent.emcon && <span className="pill warn">EMCON: active sensors off</span>}
          </div>

          <div className="card" style={{ padding: 10 }}>
            <div className="section-title">Probability of detection per look</div>
            <div className="mono" style={{ fontSize: 12, marginBottom: 6 }}>
              P<sub>d</sub> = 1 − exp(−k · S·σ / R<sup>{calc.passive ? 2 : 4}</sup> · E · (1 − J))
            </div>
            <div className="row wrap" style={{ gap: 14 }}>
              <label className="col" style={{ gap: 2 }}>Target signature σ
                <select value={sigBand} onChange={(e) => setSigBand(e.target.value as Band)}>{BANDS.map((b) => <option key={b}>{b}</option>)}</select>
              </label>
              <label className="col" style={{ gap: 2, minWidth: 160 }}>Range {calc.R.toFixed(0)} km ({rangePct}% of band)
                <input type="range" min={5} max={150} value={rangePct} onChange={(e) => setRangePct(+e.target.value)} />
              </label>
              <label className="col" style={{ gap: 2, minWidth: 140 }}>Environment E {env.toFixed(2)}
                <input type="range" min={0.05} max={1} step={0.05} value={env} onChange={(e) => setEnv(+e.target.value)} />
              </label>
              <label className="col" style={{ gap: 2, minWidth: 140 }}>Jamming J {jam.toFixed(2)}
                <input type="range" min={0} max={0.95} step={0.05} value={jam} onChange={(e) => setJam(+e.target.value)} />
              </label>
              <div style={{ textAlign: "center" }}>
                <div className="section-title">P<sub>d</sub></div>
                <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: calc.pd > 0.5 ? "var(--ok)" : calc.pd > 0.15 ? "var(--warn)" : "var(--bad)" }}>{(calc.pd * 100).toFixed(0)}%</div>
              </div>
            </div>
            <div className="dim" style={{ fontSize: 11 }}>S = {calc.S} ({sensor.strength}), σ = {calc.sigma} ({sigBand}), k = {K}. Passive sensors (SIGINT, passive RF) use R² and see only emitting targets.</div>
          </div>

          <div className="row wrap" style={{ alignItems: "flex-start", gap: 16 }}>
            <div className="grow" style={{ minWidth: 240 }}>
              <div className="section-title">Detection range (P<sub>d</sub> = 50%) vs target signature</div>
              <svg viewBox="0 0 300 130" style={{ width: "100%", maxHeight: 170 }} role="img" aria-label="Detection range rings">
                {calc.rings.map((r, i) => {
                  const w = (r.km / (calc.rangeKm * 2)) * 220;
                  return (
                    <g key={r.band} transform={`translate(0 ${i * 24 + 6})`}>
                      <text x={0} y={12} fontSize={10} fill="var(--text-2)">{r.band}</text>
                      <rect x={62} y={2} width={Math.max(1, w)} height={14} rx={2} fill={i < 2 ? "#cc79a7" : "var(--accent)"} opacity={0.4 + i * 0.12} />
                      <text x={66 + w} y={13} fontSize={10} fill="var(--text)">{r.km.toFixed(0)} km</text>
                    </g>
                  );
                })}
              </svg>
              <div className="dim" style={{ fontSize: 11 }}>Low-observable targets shrink detection range by the fourth root of their signature.</div>
            </div>
            <div className="grow" style={{ minWidth: 240 }}>
              <div className="section-title">Radar horizon from {sensorAlt.toFixed(0)} m</div>
              <svg viewBox="0 0 300 130" style={{ width: "100%", maxHeight: 170 }} role="img" aria-label="Radar horizon profile">
                <polyline fill="none" stroke="var(--accent)" strokeWidth={2} points={hz.map((p) => `${30 + (p.h / 12000) * 260},${115 - (p.d / maxD) * 100}`).join(" ")} />
                <line x1={30} y1={115} x2={290} y2={115} stroke="var(--line-2)" />
                <line x1={30} y1={10} x2={30} y2={115} stroke="var(--line-2)" />
                <text x={32} y={127} fontSize={9} fill="var(--text-3)">target altitude 0 → 12 km</text>
                <text x={0} y={12} fontSize={9} fill="var(--text-3)">{maxD.toFixed(0)} km</text>
                {(() => { const d = horizon(sensorAlt, tgtAlt); return <circle cx={30 + (tgtAlt / 12000) * 260} cy={115 - (d / maxD) * 100} r={4} fill="var(--accent-2)" />; })()}
              </svg>
              <label className="row" style={{ fontSize: 11 }}>Target at {tgtAlt} m → horizon {horizon(sensorAlt, tgtAlt).toFixed(0)} km
                <input type="range" min={0} max={12000} step={50} value={tgtAlt} onChange={(e) => setTgtAlt(+e.target.value)} />
              </label>
              <div className="dim" style={{ fontSize: 11 }}>Low fliers hide under the horizon — the reason for airborne early warning.</div>
            </div>
            <div style={{ width: 220 }}>
              <div className="section-title">Sonar layer cross-section</div>
              <svg viewBox="0 0 220 130" style={{ width: "100%" }} role="img" aria-label="Sonar layer">
                <rect x={0} y={10} width={220} height={120} fill="var(--ocean)" />
                <rect x={0} y={10} width={220} height={40} fill="#2b6f9c" opacity={0.25} />
                <line x1={0} y1={50} x2={220} y2={50} stroke="#56b4e9" strokeDasharray="4 3" />
                <text x={4} y={46} fontSize={9} fill="#56b4e9">thermal layer ~100 m</text>
                <rect x={20} y={4} width={40} height={8} fill="var(--text-2)" />
                <text x={20} y={30} fontSize={9} fill="var(--text)">ship hull sonar</text>
                <ellipse cx={160} cy={90} rx={24} ry={6} fill="var(--text-2)" />
                <text x={120} y={110} fontSize={9} fill="var(--text)">submarine below layer</text>
                <path d="M40 14 Q 100 40 130 50" stroke="var(--accent-2)" fill="none" strokeDasharray="3 3" />
                <path d="M130 50 Q 140 46 160 20" stroke="var(--bad)" fill="none" strokeDasharray="2 3" />
              </svg>
              <div className="dim" style={{ fontSize: 11 }}>Sound bends at the layer: a quiet submarine below it is hard to hear from the surface. Sea state lowers E.</div>
            </div>
          </div>

          <div>
            <div className="section-title">Active jamming fields ({ew.length})</div>
            {ew.length === 0 ? <div className="dim">None. Jamming reduces P<sub>d</sub> for radar and passive sensors inside the field (J up to 0.8).</div> : (
              <table className="grid"><thead><tr><th>Field</th><th>Faction</th><th>Kind</th><th>Radius</th><th>Strength</th></tr></thead>
                <tbody>{ew.map((f) => <tr key={f.id}><td>{f.id}</td><td>{f.faction}</td><td>{f.kind}</td><td>{f.radiusKm} km</td><td>{f.strength.toFixed(2)}</td></tr>)}</tbody></table>
            )}
          </div>
        </div>
      )}
    </Console>
  );
}
