// Console 9 — C2 Network Graph: HQs, units, ground stations, satellites and relays with link latency
// as heat, jammed links dashed and unreachable units hollow. Shows command latency and single points
// of failure; selecting a unit traces its order path from the HQ.
import { useEffect, useMemo, useRef, useState } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { scaleSequential } from "d3-scale";
import type { C2View } from "@sentinel/protocol";
import { useStore } from "../store";
import { Console, FactionToggle, useResize } from "./common";
import { minutes } from "../lib/format";

interface N extends SimulationNodeDatum { id: string; kind: string; label: string; alive: boolean; cyber?: string; gx: number; gy: number }

const KIND_SHAPE: Record<string, string> = { HQ: "M-7,-7H7V7H-7Z", GROUND: "M0,-8L8,6H-8Z", SAT: "M0,-8L8,0L0,8L-8,0Z", RELAY: "M-8,0A8,8 0 1,0 8,0A8,8 0 1,0 -8,0", UNIT: "M-4,0A4,4 0 1,0 4,0A4,4 0 1,0 -4,0" };

function shortestPath(g: C2View, from: string, to: string): Set<string> {
  const adj = new Map<string, { to: string; w: number }[]>();
  for (const l of g.links) {
    const w = l.latencyMs / Math.max(0.05, l.reliability);
    (adj.get(l.a) ?? adj.set(l.a, []).get(l.a)!).push({ to: l.b, w });
    (adj.get(l.b) ?? adj.set(l.b, []).get(l.b)!).push({ to: l.a, w });
  }
  const dist = new Map([[from, 0]]), prev = new Map<string, string>(), done = new Set<string>();
  for (;;) {
    let cur: string | null = null, best = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < best) { best = d; cur = k; }
    if (cur === null || cur === to) break;
    done.add(cur);
    for (const e of adj.get(cur) ?? []) if (best + e.w < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, best + e.w); prev.set(e.to, cur); }
  }
  const edges = new Set<string>();
  let c = to;
  while (prev.has(c)) { const p = prev.get(c)!; edges.add(`${p}|${c}`); edges.add(`${c}|${p}`); c = p; }
  return edges;
}

export function C2Graph() {
  const view = useStore((s) => s.view);
  const c2 = useStore((s) => s.c2);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const [fac, setFac] = useState<"BLUE" | "RED">(view === "RED" ? "RED" : "BLUE");
  const g = c2.find((x) => x.faction === (view === "WHITE" ? fac : view)) ?? null;
  const [ref, size] = useResize<HTMLDivElement>();
  const nodesRef = useRef(new Map<string, N>());
  const [, setTick] = useState(0);
  const simRef = useRef<ReturnType<typeof forceSimulation<N>> | null>(null);

  const geo = useMemo(() => {
    if (!g) return (lat: number, lon: number) => [lat, lon];
    const ground = g.nodes.filter((n) => n.kind !== "SAT");
    const lats = ground.map((n) => n.lat), lons = ground.map((n) => n.lon);
    const [a, b, c, d] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
    return (lat: number, lon: number) => [40 + ((lon - c) / Math.max(0.01, d - c)) * (size.w - 80), 40 + ((b - lat) / Math.max(0.01, b - a)) * (size.h - 80)];
  }, [g, size.w, size.h]);

  useEffect(() => {
    if (!g) return;
    const map = nodesRef.current;
    const keep = new Set(g.nodes.map((n) => n.id));
    for (const id of [...map.keys()]) if (!keep.has(id)) map.delete(id);
    for (const n of g.nodes) {
      const [gx, gy] = n.kind === "SAT" ? [size.w / 2 + (map.size % 7) * 20, 20] : geo(n.lat, n.lon);
      const cur = map.get(n.id);
      if (cur) Object.assign(cur, { kind: n.kind, label: n.label, alive: n.alive, cyber: n.cyber, gx, gy });
      else map.set(n.id, { id: n.id, kind: n.kind, label: n.label, alive: n.alive, cyber: n.cyber, gx, gy, x: gx, y: gy });
    }
    const nodes = [...map.values()];
    const links = g.links.filter((l) => map.has(l.a) && map.has(l.b)).map((l) => ({ source: l.a, target: l.b, kind: l.kind }));
    simRef.current?.stop();
    const sim = forceSimulation<N>(nodes)
      .force("link", forceLink<N, { source: string; target: string; kind: string }>(links).id((d) => d.id).distance((l) => (l.kind === "HF" ? 140 : 50)).strength((l) => (l.kind === "HF" ? 0.01 : 0.3)))
      .force("charge", forceManyBody().strength(-40))
      .force("x", forceX<N>((d) => d.gx).strength(0.08))
      .force("y", forceY<N>((d) => d.gy).strength(0.08))
      .force("collide", forceCollide(9))
      .alpha(0.5)
      .on("tick", () => setTick((t) => t + 1));
    simRef.current = sim;
    return () => { sim.stop(); };
  }, [g, geo, size.w]);

  const path = useMemo(() => {
    if (!g || !selected) return new Set<string>();
    const root = g.nodes.find((n) => n.kind === "HQ" && n.alive);
    return root ? shortestPath(g, root.id, selected) : new Set<string>();
  }, [g, selected]);

  const heat = scaleSequential([60_000, 1_800_000], (t) => `hsl(${(1 - t) * 140}, 70%, 50%)`).clamp(true);
  const unreachable = new Set(g?.unreachable ?? []);
  const nodes = nodesRef.current;

  return (
    <Console title="C2 Network Graph" concept="Command latency, network resilience, single points of failure" flush
      tools={
        <>
          <FactionToggle value={fac} onChange={setFac} />
          {g && <span className="muted">mean order latency <b className="mono">{minutes(g.meanLatencyMs)}</b> · {g.unreachable.length} unreachable · {g.links.filter((l) => l.jammed).length} jammed links</span>}
        </>
      }>
      <div ref={ref} style={{ position: "absolute", inset: 0 }}>
        {!g ? <div className="empty">No network data yet.</div> : (
          <svg width={size.w} height={size.h} role="img" aria-label="C2 network graph">
            {g.links.map((l, i) => {
              const a = nodes.get(l.a), b = nodes.get(l.b);
              if (!a || !b || a.x === undefined || b.x === undefined) return null;
              const onPath = path.has(`${l.a}|${l.b}`);
              return (
                <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={onPath ? "var(--accent-2)" : heat(l.latencyMs)} strokeOpacity={onPath ? 1 : l.kind === "HF" ? 0.12 : 0.55}
                  strokeWidth={onPath ? 3 : l.kind === "FIBER" || l.kind === "LASER" ? 2 : 1} strokeDasharray={l.jammed ? "4 3" : undefined}>
                  <title>{`${l.kind} ${l.a}–${l.b}: ${minutes(l.latencyMs)}, reliability ${Math.round(l.reliability * 100)}%${l.jammed ? " (jammed)" : ""}`}</title>
                </line>
              );
            })}
            {[...nodes.values()].map((n) => (
              <g key={n.id} transform={`translate(${n.x ?? 0},${n.y ?? 0})`} onClick={() => select(n.id)} style={{ cursor: "pointer" }}>
                <path d={KIND_SHAPE[n.kind] ?? KIND_SHAPE.UNIT} fill={!n.alive || unreachable.has(n.id) ? "none" : n.kind === "HQ" ? "var(--accent)" : n.kind === "SAT" ? "#cc79a7" : n.kind === "GROUND" ? "#e6b800" : "var(--text-2)"}
                  stroke={unreachable.has(n.id) || !n.alive ? "var(--bad)" : selected === n.id ? "var(--accent-2)" : "var(--bg)"} strokeWidth={selected === n.id ? 3 : 1.2} />
                {n.cyber && <text x={8} y={-6} fontSize={10} fill="var(--bad)">⚡{n.cyber}</text>}
                {(n.kind !== "UNIT" || selected === n.id) && <text x={10} y={4} fontSize={10} fill="var(--text-2)">{n.label}</text>}
                <title>{`${n.label} (${n.kind})${unreachable.has(n.id) ? " — unreachable" : ""}${n.cyber ? ` — cyber ${n.cyber}` : ""}`}</title>
              </g>
            ))}
          </svg>
        )}
        <div className="legend" style={{ position: "absolute", bottom: 6, left: 10 }}>
          <span>■ HQ</span><span>▲ ground station</span><span>◆ satellite</span><span>○ relay</span><span>· unit</span>
          <span><i style={{ background: "hsl(140,70%,50%)" }} />fast</span><span><i style={{ background: "hsl(0,70%,50%)" }} />slow</span><span>– – jammed</span><span>hollow red = unreachable</span>
        </div>
      </div>
    </Console>
  );
}
