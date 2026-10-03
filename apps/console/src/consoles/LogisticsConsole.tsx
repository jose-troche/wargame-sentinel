// Console 10 — Logistics Console: Sankey of supply flows from depots to units, interdicted routes in
// red, and days-of-supply bars. Shows sustainment as the limit of operational reach.
import { useMemo, useState } from "react";
import { sankey, sankeyLinkHorizontal, type SankeyGraph } from "d3-sankey";
import { useStore } from "../store";
import { Bar, Console, FactionToggle, useEntities, useResize } from "./common";
import { clsName } from "../lib/format";

interface SN { name: string; kind: "source" | "sink" }
interface SL { source: number; target: number; value: number; interdicted: boolean; kind: string }

export function LogisticsConsole() {
  const view = useStore((s) => s.view);
  const logistics = useStore((s) => s.logistics);
  const entities = useStore((s) => s.entities);
  const [fac, setFac] = useState<"BLUE" | "RED">(view === "RED" ? "RED" : "BLUE");
  const f = view === "WHITE" ? fac : (view as "BLUE" | "RED");
  const lv = logistics.find((x) => x.faction === f);
  const [ref, size] = useResize<HTMLDivElement>({ w: 600, h: 260 });
  const units = useEntities((e) => e.faction === f && !e.destroyed && e.domain !== "SPACE" && e.cls !== "hq");

  const graph = useMemo(() => {
    if (!lv || !lv.flows.length) return null;
    const nodes: SN[] = [];
    const idx = new Map<string, number>();
    const node = (name: string, kind: SN["kind"]) => {
      const k = `${kind}:${name}`;
      if (!idx.has(k)) { idx.set(k, nodes.length); nodes.push({ name, kind }); }
      return idx.get(k)!;
    };
    const agg = new Map<string, SL>();
    for (const fl of lv.flows) {
      const src = entities.get(fl.from);
      const dst = entities.get(fl.to);
      const s = node(src ? src.callsign : fl.from, "source");
      const t = node(dst ? `${clsName(dst.cls)}` : fl.to, "sink");
      const key = `${s}-${t}-${fl.interdicted}`;
      const cur = agg.get(key) ?? { source: s, target: t, value: 0, interdicted: fl.interdicted, kind: fl.kind };
      cur.value += fl.interdicted ? 0.4 : Math.max(0.05, fl.amount);
      agg.set(key, cur);
    }
    const h = Math.max(160, Math.min(520, nodes.length * 22));
    try {
      const gen = sankey<SN, SL>().nodeWidth(10).nodePadding(8).extent([[120, 6], [size.w - 160, h - 6]]);
      return { g: gen({ nodes: nodes.map((n) => ({ ...n })), links: [...agg.values()].map((l) => ({ ...l })) }) as SankeyGraph<SN, SL>, h };
    } catch {
      return null;
    }
  }, [lv, entities, size.w]);

  const sorted = [...units].sort((a, b) => a.supplyDays - b.supplyDays).slice(0, 40);
  const cut = lv?.flows.filter((x) => x.interdicted).length ?? 0;
  return (
    <Console title="Logistics Console" concept="Sustainment as the limit of operational reach"
      tools={<><FactionToggle value={fac} onChange={setFac} /><span className="muted">{lv?.flows.length ?? 0} flows last hour · <b className={cut ? "badge-red" : ""}>{cut} interdicted</b> · {lv?.shortfallHours ?? 0} unit-hours out of supply</span></>}>
      <div ref={ref} style={{ width: "100%" }}>
        {!graph ? <div className="empty">Supply flows are computed every simulated hour.</div> : (
          <svg width={size.w} height={graph.h} role="img" aria-label="Supply Sankey">
            {graph.g.links.map((l, i) => (
              <path key={i} d={sankeyLinkHorizontal()(l as never) ?? ""} fill="none" stroke={l.interdicted ? "var(--bad)" : l.kind === "SEA" ? "#56b4e9" : l.kind === "AIR" ? "#cc79a7" : "#3fb68b"}
                strokeOpacity={l.interdicted ? 0.8 : 0.4} strokeWidth={Math.max(1, l.width ?? 1)} strokeDasharray={l.interdicted ? "5 4" : undefined}>
                <title>{`${(l.source as unknown as SN).name} → ${(l.target as unknown as SN).name}: ${l.interdicted ? "INTERDICTED" : `${l.value.toFixed(2)} unit-days`} (${l.kind})`}</title>
              </path>
            ))}
            {graph.g.nodes.map((n, i) => (
              <g key={i}>
                <rect x={n.x0} y={n.y0} width={(n.x1 ?? 0) - (n.x0 ?? 0)} height={Math.max(1, (n.y1 ?? 0) - (n.y0 ?? 0))} fill={n.kind === "source" ? "var(--accent-2)" : "var(--accent)"} />
                <text x={n.kind === "source" ? (n.x0 ?? 0) - 4 : (n.x1 ?? 0) + 4} y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2 + 3} fontSize={10} fill="var(--text-2)" textAnchor={n.kind === "source" ? "end" : "start"}>{n.name}</text>
              </g>
            ))}
          </svg>
        )}
      </div>
      <div className="legend"><span><i style={{ background: "#3fb68b" }} />road</span><span><i style={{ background: "#56b4e9" }} />sea</span><span><i style={{ background: "#cc79a7" }} />air</span><span><i style={{ background: "var(--bad)" }} />interdicted (dashed)</span></div>
      <div className="section-title" style={{ marginTop: 8 }}>Days of supply (lowest first)</div>
      <table className="grid">
        <tbody>
          {sorted.map((u) => (
            <tr key={u.id} className="click" onClick={() => useStore.getState().select(u.id)}>
              <td style={{ width: 160 }}>{u.callsign}</td><td style={{ width: 160 }} className="dim">{clsName(u.cls)}</td>
              <td><Bar value={u.supplyDays} max={10} color={u.supplyDays > 3 ? "var(--ok)" : u.supplyDays >= 1 ? "var(--warn)" : "var(--bad)"} label={`${u.supplyDays} days`} /></td>
              <td style={{ width: 60 }} className="mono">{u.supplyDays.toFixed(1)} d</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Console>
  );
}
