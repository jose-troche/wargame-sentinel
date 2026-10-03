// After-action review: metrics, the AAR Analyst narrative (LLM when available, rules otherwise), and
// links from every turning point to the events that support it.
import { useEffect, useState } from "react";
import { Bar as RBar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AarReport } from "@sentinel/engine";
import { useStore } from "../store";
import { Console } from "./common";
import { controller } from "../session/controller";
import { api } from "../lib/api";
import { simTime } from "../lib/format";

interface Narrative { summary: string; turningPoints: { title: string; text: string; events: number[] }[]; counterfactuals: { text: string; events: number[] }[]; source: string }

export function AarPanel() {
  const aar = useStore((s) => s.aar);
  const mode = useStore((s) => s.mode);
  const meta = useStore((s) => s.meta);
  const tokens = useStore((s) => s.tokens);
  const allEvents = useStore((s) => s.allEvents);
  const events = useStore((s) => s.events);
  const set = useStore((s) => s.set);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      if (mode === "local" || mode === "host") controller.requestAar();
      if (mode !== "local" && meta) {
        const t = Object.values(tokens)[0];
        if (t) {
          const r = await api.aar(meta.id, t);
          set({ aar: { report: r.report, narrative: r.narrative } });
        }
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const report = aar?.report as AarReport | null;
  const llm = aar?.narrative as Narrative | null;
  const narrative: Narrative | null = llm ?? (report?.narrative as Narrative | undefined) ?? null;
  const evIndex = new Map((allEvents.length ? allEvents : events).map((e) => [e.seq, e]));
  const m = report?.metrics;
  const brokenData = m ? Object.entries(m.brokenPct).map(([stage, v]) => ({ stage, v })) : [];
  const lossData = m ? Object.entries(m.lossExchange).map(([d, x]) => ({ d, blue: x.blue, red: x.red })) : [];
  const jump = (seq: number) => {
    const e = evIndex.get(seq);
    if (e) set({ explain: e, selected: e.entities?.[0] ?? null });
  };

  return (
    <Console title="After-Action Review" concept="Decisions that mattered, linked to the log" tools={<button className="small" onClick={refresh} disabled={loading}>{loading ? "Computing…" : "Refresh AAR"}</button>}>
      {!m ? <div className="empty">The AAR is computed from the event log. Run the scenario for at least an hour, then refresh.</div> : (
        <div className="col" style={{ gap: 12 }}>
          <div className="row wrap" style={{ gap: 18 }}>
            <Stat label="Sim hours" value={m.simHours} />
            <Stat label="Cost exchange (R/B)" value={m.costExchange.ratio ?? "—"} />
            <Stat label="Mean sensor-to-shooter" value={`${m.meanSensorToShooterMin} min`} />
            <Stat label="Kill chains completed" value={m.chainsSucceeded} />
            <Stat label="Supply shortfall" value={`${m.supplyShortfallHours} unit-h`} />
            <Stat label="Escalation peak" value={m.escalationPeak} />
            <Stat label="Civilian harm (B/R)" value={`${m.civilianHarm.blue} / ${m.civilianHarm.red}`} />
            <Stat label="Will (B/R)" value={`${m.will.blue} / ${m.will.red}`} />
          </div>
          {m.outcome && <div className="card"><b>{m.outcome}</b></div>}
          <div className="row wrap" style={{ gap: 12 }}>
            <div className="grow" style={{ minWidth: 260, height: 180 }}>
              <div className="section-title">Kill chains broken by link (%)</div>
              <ResponsiveContainer width="100%" height="88%"><BarChart data={brokenData}><CartesianGrid stroke="var(--line)" /><XAxis dataKey="stage" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><RBar isAnimationActive={false} dataKey="v" fill="#e5533d" /></BarChart></ResponsiveContainer>
            </div>
            <div className="grow" style={{ minWidth: 260, height: 180 }}>
              <div className="section-title">Losses by domain</div>
              <ResponsiveContainer width="100%" height="88%"><BarChart data={lossData}><CartesianGrid stroke="var(--line)" /><XAxis dataKey="d" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><RBar isAnimationActive={false} dataKey="blue" fill="#0072B2" /><RBar isAnimationActive={false} dataKey="red" fill="#D55E00" /></BarChart></ResponsiveContainer>
            </div>
          </div>
          {narrative && (
            <div className="card">
              <div className="row"><h3>Narrative</h3><span className={`pill ${narrative.source === "LLM" ? "llm" : "rules"}`}>{narrative.source === "LLM" ? "AAR Analyst (LLM)" : "rule-based"}</span></div>
              <p>{narrative.summary}</p>
              <div className="section-title">Turning points</div>
              <ol>
                {narrative.turningPoints.map((t, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    <b>{t.title}</b> — {t.text}{" "}
                    {t.events.map((s) => <button key={s} className="small ghost" onClick={() => jump(s)} title={evIndex.get(s)?.text}>#{s}{evIndex.get(s) ? ` ${simTime(evIndex.get(s)!.simMs)}` : ""}</button>)}
                  </li>
                ))}
              </ol>
              {narrative.counterfactuals.length > 0 && <div className="section-title">Counterfactuals</div>}
              <ul>{narrative.counterfactuals.map((c, i) => <li key={i}>{c.text} {c.events.map((s) => <button key={s} className="small ghost" onClick={() => jump(s)}>#{s}</button>)}</li>)}</ul>
            </div>
          )}
          <div>
            <div className="section-title">Objective timeline</div>
            {m.objectiveTimeline.length === 0 ? <div className="dim">No objective changes.</div> : m.objectiveTimeline.map((o) => <div key={o.seq} style={{ fontSize: 12 }}><span className="mono dim">{simTime(o.simMs)}</span> {o.text}</div>)}
          </div>
        </div>
      )}
    </Console>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div><div className="section-title">{label}</div><b className="mono" style={{ fontSize: 16 }}>{value}</b></div>;
}
