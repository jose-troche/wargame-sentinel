// Console 12 — Strategic Dashboard: escalation ladder, national will curves, objective status and
// loss-exchange ratios. Shows how tactical events become strategic outcomes.
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DOMAINS, ESCALATION_LADDER } from "@sentinel/protocol";
import { useStore } from "../store";
import { Console } from "./common";

export function StrategicDashboard() {
  const politics = useStore((s) => s.politics);
  const view = useStore((s) => s.view);
  if (!politics) return <Console title="Strategic Dashboard" concept="Tactical events → strategic outcomes"><div className="empty">Waiting for the first strategic update.</div></Console>;
  const [b, r] = [politics.factions.find((f) => f.faction === "BLUE")!, politics.factions.find((f) => f.faction === "RED")!];
  const data = politics.history.map(([h, bw, rw, be, re]) => ({ h, blueWill: bw, redWill: rw, blueEsc: be, redEsc: re }));
  const est = (f: "BLUE" | "RED") => (view !== "WHITE" && view !== f ? " (est.)" : "");
  return (
    <Console title="Strategic Dashboard" concept="How tactical events translate into strategic outcomes">
      {politics.outcome && (
        <div className="card" style={{ borderColor: "var(--accent-2)", marginBottom: 8 }}>
          <b>Outcome: {politics.outcome.winner}</b> — {politics.outcome.reason}
        </div>
      )}
      <div className="row wrap" style={{ alignItems: "flex-start", gap: 16 }}>
        <div style={{ width: 250 }}>
          <div className="section-title">Escalation ladder</div>
          {[...ESCALATION_LADDER].reverse().map((rung) => (
            <div key={rung.rung} className="row" style={{ gap: 6, padding: "3px 6px", borderRadius: 4, background: rung.rung === 6 ? "color-mix(in srgb, var(--bad) 18%, transparent)" : rung.rung <= Math.max(b.escalation, r.escalation) ? "var(--panel-2)" : undefined }} title={rung.allows}>
              <span className="mono dim" style={{ width: 12 }}>{rung.rung}</span>
              <span className="grow" style={{ fontSize: 12 }}>{rung.name}</span>
              {b.escalation === rung.rung && <span className="pill" style={{ color: "#0072B2", borderColor: "#0072B2" }}>■ {b.name.split(" ").pop()}</span>}
              {r.escalation === rung.rung && <span className="pill" style={{ color: "#D55E00", borderColor: "#D55E00" }}>◆ {r.name.split(" ").pop()}</span>}
            </div>
          ))}
          <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>Rung 6 ends the scenario with an adjudicated catastrophic outcome; it is not modeled.</div>
        </div>
        <div className="grow" style={{ minWidth: 280, height: 220 }}>
          <div className="section-title">National will</div>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={data} margin={{ left: -20, right: 8, top: 4 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis dataKey="h" tick={{ fontSize: 10, fill: "var(--text-3)" }} label={{ value: "sim hour", fontSize: 10, fill: "var(--text-3)", position: "insideBottomRight", offset: -2 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--text-3)" }} />
              <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--line-2)", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line isAnimationActive={false} type="monotone" dataKey="blueWill" name={`${b.name}${est("BLUE")}`} stroke="#0072B2" dot={false} strokeWidth={2} />
              <Line isAnimationActive={false} type="monotone" dataKey="redWill" name={`${r.name}${est("RED")}`} stroke="#D55E00" dot={false} strokeWidth={2} strokeDasharray="6 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="row wrap" style={{ alignItems: "flex-start", gap: 16, marginTop: 8 }}>
        <div className="grow" style={{ minWidth: 260 }}>
          <div className="section-title">Objectives</div>
          <table className="grid">
            <thead><tr><th>Objective</th><th>Owner</th><th>Kind</th><th>Holder</th><th>Held</th></tr></thead>
            <tbody>
              {politics.objectives.map((o) => (
                <tr key={`${o.owner}-${o.id}`}>
                  <td>{o.name}</td><td className={o.owner === "BLUE" ? "badge-blue" : "badge-red"}>{o.owner}</td><td>{o.kind}</td>
                  <td><span className={`pill ${o.holder === o.owner ? "ok" : o.holder === "CONTESTED" ? "warn" : o.holder === "NONE" ? "" : "bad"}`}>{o.holder}</span></td>
                  <td className="mono">{o.heldHours} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grow" style={{ minWidth: 260 }}>
          <div className="section-title">Loss exchange by domain</div>
          <table className="grid">
            <thead><tr><th>Domain</th><th>Blue lost</th><th>Red lost</th><th>Exchange (R/B)</th></tr></thead>
            <tbody>
              {DOMAINS.map((d) => (
                <tr key={d}><td>{d}</td><td className="mono">{b.losses[d]}</td><td className="mono">{r.losses[d]}</td><td className="mono">{b.losses[d] ? (r.losses[d] / b.losses[d]).toFixed(2) : r.losses[d] ? "∞" : "—"}</td></tr>
              ))}
              <tr><td><b>Cost points</b></td><td className="mono">{b.lossPoints}</td><td className="mono">{r.lossPoints}</td><td className="mono">{b.lossPoints ? (r.lossPoints / b.lossPoints).toFixed(2) : "—"}</td></tr>
              <tr><td>Civilian harm</td><td className="mono">{b.civilianHarm}</td><td className="mono">{r.civilianHarm}</td><td className="dim">cost, never rewarded</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </Console>
  );
}
