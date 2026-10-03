// Batch mode: N seeds in a pool of Web Workers; outcome distributions show whether a plan is robust
// or merely lucky. Results are summarized and optionally uploaded as one row.
import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SCENARIO_SUMMARIES } from "@sentinel/scenarios";
import type { McResult } from "../engine/montecarlo.worker";
import { api } from "../lib/api";
import { getUser } from "../lib/identity";
import { navigate } from "../router";

function histogram(values: number[], bins = 10) {
  if (!values.length) return [];
  const lo = Math.min(...values), hi = Math.max(...values);
  const w = (hi - lo) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ bin: `${Math.round(lo + i * w)}`, n: 0 }));
  for (const v of values) out[Math.min(bins - 1, Math.floor((v - lo) / w))].n++;
  return out;
}

export function MonteCarloPage() {
  const [scenarioId, setScenarioId] = useState("sandbox");
  const [n, setN] = useState(24);
  const [hours, setHours] = useState(48);
  const [results, setResults] = useState<McResult[]>([]);
  const [running, setRunning] = useState(false);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [past, setPast] = useState<{ id: string; scenario_id: string; seeds: number; created_at: number; summary: unknown }[]>([]);
  const pool = useRef<Worker[]>([]);

  useEffect(() => { api.montecarlo().then((r) => setPast(r.runs)).catch(() => undefined); return () => pool.current.forEach((w) => w.terminate()); }, []);

  const run = () => {
    setResults([]);
    setUploaded(null);
    setRunning(true);
    const size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    pool.current.forEach((w) => w.terminate());
    pool.current = Array.from({ length: size }, () => new Worker(new URL("../engine/montecarlo.worker.ts", import.meta.url), { type: "module" }));
    let next = 0, done = 0;
    const base = Math.floor(Math.random() * 1e6);
    const feed = (w: Worker) => {
      if (next >= n) return;
      w.postMessage({ scenarioId, seed: base + next, hours });
      next++;
    };
    for (const w of pool.current) {
      w.onmessage = (ev: MessageEvent<McResult>) => {
        done++;
        setResults((r) => [...r, ev.data]);
        if (done >= n) setRunning(false);
        feed(w);
      };
      feed(w);
    }
  };

  const wins = ["BLUE", "RED", "DRAW", "CATASTROPHIC"].map((w) => ({ w, n: results.filter((r) => r.winner === w).length }));
  const summary = results.length ? {
    hours, runs: results.length, wins: Object.fromEntries(wins.map((x) => [x.w, x.n])),
    meanWill: { blue: avg(results.map((r) => r.willBlue)), red: avg(results.map((r) => r.willRed)) },
    meanCost: { blue: avg(results.map((r) => r.costBlue)), red: avg(results.map((r) => r.costRed)) },
    meanS2S: avg(results.map((r) => r.s2sMin)),
  } : null;

  return (
    <div className="lobby">
      <div className="hero">
        <div>
          <h1>MONTE CARLO</h1>
          <p>Run many seeds of the same scenario with rule-based agents to separate skill from luck. Runs execute in your browser's Web Workers, not on the server.</p>
        </div>
        <button onClick={() => navigate("/")}>← Lobby</button>
      </div>
      <div className="card row wrap">
        <label className="row">Scenario <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>{SCENARIO_SUMMARIES.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.entities})</option>)}</select></label>
        <label className="row">Seeds <input type="number" min={2} max={500} value={n} onChange={(e) => setN(+e.target.value)} style={{ width: 80 }} /></label>
        <label className="row">Hours per run <input type="number" min={6} max={504} value={hours} onChange={(e) => setHours(+e.target.value)} style={{ width: 80 }} /></label>
        <button className="primary" onClick={run} disabled={running}>{running ? `Running ${results.length}/${n}…` : "Run batch"}</button>
        {summary && !running && (
          <button onClick={async () => { try { const r = await api.uploadMontecarlo({ scenarioId, seeds: results.length, summary, user: getUser() }); setUploaded(r.id); } catch (e) { setUploaded(`failed: ${(e as Error).message}`); } }}>Upload summary</button>
        )}
        {uploaded && <span className="dim">uploaded: {uploaded}</span>}
      </div>
      {results.length > 0 && (
        <div className="row wrap" style={{ gap: 12, marginTop: 12 }}>
          <Chart title="Outcomes" data={wins} x="w" y="n" color="#56b4e9" />
          <Chart title="Final Blue will" data={histogram(results.map((r) => r.willBlue))} x="bin" y="n" color="#0072B2" />
          <Chart title="Final Red will" data={histogram(results.map((r) => r.willRed))} x="bin" y="n" color="#D55E00" />
          <Chart title="Cost lost by Blue (points)" data={histogram(results.map((r) => r.costBlue))} x="bin" y="n" color="#0072B2" />
          <Chart title="Cost lost by Red (points)" data={histogram(results.map((r) => r.costRed))} x="bin" y="n" color="#D55E00" />
          <Chart title="Escalation peak" data={histogram(results.map((r) => r.escalationPeak), 6)} x="bin" y="n" color="#e69f00" />
        </div>
      )}
      {summary && <p className="muted">Mean sensor-to-shooter {summary.meanS2S.toFixed(1)} min · mean will Blue {summary.meanWill.blue.toFixed(0)} / Red {summary.meanWill.red.toFixed(0)}. A spread-out distribution means outcomes depend on luck; a tight one means the plan is robust.</p>}
      {past.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="section-title">Uploaded batches</div>
          {past.map((p) => <div key={p.id} style={{ fontSize: 12 }} className="mono">{new Date(p.created_at).toLocaleString()} · {p.scenario_id} · {p.seeds} seeds · {JSON.stringify((p.summary as { wins?: unknown })?.wins ?? {})}</div>)}
        </div>
      )}
    </div>
  );
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function Chart({ title, data, x, y, color }: { title: string; data: object[]; x: string; y: string; color: string }) {
  return (
    <div className="card" style={{ flex: "1 1 300px", height: 220 }}>
      <div className="section-title">{title}</div>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data}><CartesianGrid stroke="var(--line)" /><XAxis dataKey={x} tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Bar isAnimationActive={false} dataKey={y} fill={color} /></BarChart>
      </ResponsiveContainer>
    </div>
  );
}
