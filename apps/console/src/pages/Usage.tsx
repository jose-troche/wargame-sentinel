import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../router";
import { Bar } from "../consoles/common";

export function UsagePage() {
  const [u, setU] = useState<Awaited<ReturnType<typeof api.usage>> | null>(null);
  const [cfg, setCfg] = useState<Awaited<ReturnType<typeof api.config>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.usage().then(setU).catch((e) => setErr(String(e.message)));
    api.config().then(setCfg).catch(() => undefined);
  }, []);
  return (
    <div className="lobby">
      <div className="hero">
        <div><h1>FREE-TIER USAGE</h1><p>Workers AI neurons are the binding constraint: when a session's grant or the daily allowance runs out, agents switch to rule-based policies and the session continues.</p></div>
        <button onClick={() => navigate("/")}>← Lobby</button>
      </div>
      {err && <div className="pill bad">{err}</div>}
      {u && (
        <div className="card col">
          <div className="row"><b>{u.day}</b><span className="dim">(UTC, resets at 00:00)</span></div>
          <div>Neurons {u.neurons.toFixed(0)} / {u.dailyLimit}</div>
          <Bar value={u.neurons} max={u.dailyLimit} color={u.neurons > u.dailyLimit * 0.8 ? "var(--bad)" : "var(--accent)"} />
          <dl className="kv"><dt>LLM calls</dt><dd>{u.llmCalls}</dd><dt>Sessions started</dt><dd>{u.sessions}</dd><dt>DO requests (est.)</dt><dd>{u.doRequests}</dd><dt>Archive store</dt><dd>{cfg?.archive ?? "?"}</dd></dl>
          <div className="section-title">Session grants today</div>
          <table className="grid"><thead><tr><th>Session</th><th>Granted</th><th>Used</th></tr></thead>
            <tbody>{u.grants.map((g) => <tr key={g.session}><td className="mono">{g.session}</td><td>{g.granted}</td><td>{Math.round(g.used)}</td></tr>)}</tbody></table>
          {cfg && <div className="dim" style={{ fontSize: 12 }}>Models: {Object.entries(cfg.models).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>}
        </div>
      )}
    </div>
  );
}
