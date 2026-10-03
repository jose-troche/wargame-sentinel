// Console 3 — Kill Chain Console: one swimlane per engagement across F2T2EA, time per stage,
// the break point highlighted with its reason, and C2 approval latency.
import { useMemo, useState } from "react";
import { KILL_CHAIN_STAGES, type KillChainView } from "@sentinel/protocol";
import { useStore } from "../store";
import { Console, useVersion } from "./common";
import { dur } from "../lib/format";

type Filter = "ALL" | "ACTIVE" | "SUCCESS" | "BROKEN";

export function KillChainConsole() {
  const v = useVersion();
  const chains = useStore((s) => s.chains);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const entities = useStore((s) => s.entities);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [onlySel, setOnlySel] = useState(false);
  const simMs = useStore((s) => s.simMs);

  const list = useMemo(() => {
    let arr = [...chains.values()];
    if (filter !== "ALL") arr = arr.filter((c) => c.status === filter);
    if (onlySel && selected) arr = arr.filter((c) => c.shooter === selected || c.track === selected);
    return arr.sort((a, b) => b.stages[0].startMs - a.stages[0].startMs).slice(0, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, filter, onlySel, selected]);

  const stats = useMemo(() => {
    const all = [...chains.values()];
    const broken: Record<string, number> = {};
    for (const s of KILL_CHAIN_STAGES) broken[s] = 0;
    let ok = 0, s2s = 0, n = 0, lat = 0;
    for (const c of all) {
      if (c.status === "BROKEN" && c.brokenAt) broken[c.brokenAt]++;
      if (c.status === "SUCCESS") {
        ok++;
        const eng = c.stages.find((x) => x.stage === "ENGAGE");
        if (eng?.endMs) { s2s += eng.endMs - c.stages[0].startMs; n++; }
      }
      lat += c.c2LatencyMs;
    }
    const total = all.filter((c) => c.status !== "ACTIVE").length;
    return { broken, ok, total, meanS2S: n ? s2s / n : 0, meanLat: all.length ? lat / all.length : 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  const maxBroken = Math.max(1, ...Object.values(stats.broken));
  return (
    <Console
      title="Kill Chain Console"
      concept="Sensor-to-shooter latency: which link failed and why"
      tools={
        <>
          {(["ALL", "ACTIVE", "SUCCESS", "BROKEN"] as Filter[]).map((f) => (
            <button key={f} className={`small ${filter === f ? "primary" : ""}`} onClick={() => setFilter(f)}>{f.toLowerCase()}</button>
          ))}
          <label className="row"><input type="checkbox" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} /> selected unit</label>
        </>
      }
    >
      <div className="row wrap" style={{ gap: 16, marginBottom: 8 }}>
        <div><div className="section-title">Completed</div><b className="mono">{stats.ok}</b> / {stats.total}</div>
        <div><div className="section-title">Mean sensor-to-shooter</div><b className="mono">{dur(stats.meanS2S)}</b></div>
        <div><div className="section-title">Mean C2 approval latency</div><b className="mono">{dur(stats.meanLat)}</b></div>
        <div className="grow" style={{ minWidth: 220 }}>
          <div className="section-title">Broken chains by link</div>
          <div className="row" style={{ alignItems: "flex-end", height: 34, gap: 4 }}>
            {KILL_CHAIN_STAGES.map((s) => (
              <div key={s} style={{ flex: 1, textAlign: "center" }} title={`${stats.broken[s]} broke at ${s}`}>
                <div style={{ height: (stats.broken[s] / maxBroken) * 22, background: "var(--bad)", borderRadius: 2, minHeight: stats.broken[s] ? 2 : 0 }} />
                <div style={{ fontSize: 9 }} className="dim">{s}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {list.length === 0 && <div className="empty">No engagements yet. Kill chains start when a shooter has a hostile track in range and the ROE and escalation rung allow it.</div>}
      {list.map((c) => <Lane key={c.id} c={c} simMs={simMs} sel={selected === c.shooter || selected === c.track} label={entities.get(c.shooter)?.callsign ?? c.shooter} onClick={() => select(c.shooter)} />)}
    </Console>
  );
}

function Lane({ c, simMs, sel, label, onClick }: { c: KillChainView; simMs: number; sel: boolean; label: string; onClick: () => void }) {
  return (
    <div className={`lane${sel ? " sel" : ""}`} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClick()}>
      <div style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <b>{label}</b> → {c.track} <span className="dim">{c.weapon}</span>
      </div>
      <div className="stages">
        {KILL_CHAIN_STAGES.map((st) => {
          const s = c.stages.find((x) => x.stage === st);
          const cls = !s ? "todo" : s.ok === false ? "broken" : s.ok ? "ok" : "active";
          const d = s ? (s.endMs ?? simMs) - s.startMs : 0;
          const title = s ? `${st}: ${dur(d)}${s.reason ? ` — ${s.reason}` : ""}` : `${st}: not reached`;
          return <div key={st} className={`stage ${cls}`} title={title} aria-label={title}>{s ? (s.ok === false ? `✕ ${st}` : dur(d)) : st}</div>;
        })}
      </div>
      <div style={{ fontSize: 11, textAlign: "right" }}>
        {c.status === "SUCCESS" ? (c.believedKill ? (c.actualKill === false ? <span className="badge-red" title="BDA believes a kill that did not happen">kill? ✗</span> : "kill ✓") : "survived") : c.status === "BROKEN" ? <span className="badge-red">broken</span> : <span className="muted">active</span>}
        {c.c2LatencyMs > 0 && <div className="dim">C2 {dur(c.c2LatencyMs)}</div>}
      </div>
    </div>
  );
}
