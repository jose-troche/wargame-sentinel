// Console 7 — Land Operations Console: front-line trace, force-ratio heat map, terrain overlay and
// supply badges. Shows combat power ratios, terrain and sustainment effects.
import { useMemo, useState } from "react";
import { cellToBoundary, cellsToDirectedEdge, directedEdgeToBoundary, gridDisk, latLngToCell } from "h3-js";
import { WorldMap, type TerrainClass } from "@sentinel/engine";
import { getClass, hasClass } from "@sentinel/catalog";
import { useStore } from "../store";
import { Console, LandShapes, useProjection, useResize, useVersion } from "./common";
import { affiliationOf, fillFor, symbolDataUrl, symbolKey } from "../lib/symbols";

const TERRAIN_COLOR: Record<TerrainClass, string> = { WATER: "transparent", PLAINS: "#5b7b4a", FOREST: "#2f5d3a", HILLS: "#8a7a52", MOUNTAINS: "#9c8f86", URBAN: "#7d7f8c", DESERT: "#b59c62" };
const power = (cls?: string) => (cls && hasClass(cls) ? getClass(cls).combatPower : 40);

export function LandOpsConsole() {
  const v = useVersion();
  const [ref, size] = useResize<HTMLDivElement>();
  const { project } = useProjection(size.w, size.h);
  const view = useStore((s) => s.view);
  const scenario = useStore((s) => s.scenario);
  const meta = useStore((s) => s.meta);
  const entities = useStore((s) => s.entities);
  const tracks = useStore((s) => s.tracks);
  const select = useStore((s) => s.select);
  const selected = useStore((s) => s.selected);
  const [showTerrain, setShowTerrain] = useState(false);
  const [showRatio, setShowRatio] = useState(true);

  const terrain = useMemo(() => {
    if (!scenario || !showTerrain) return [];
    const map = new WorldMap(scenario, meta?.seed ?? 1);
    const [w, s, e, n] = scenario.map.bbox;
    const step = Math.max(0.15, (e - w) / 120);
    const out: { lat: number; lon: number; t: TerrainClass }[] = [];
    for (let lat = s; lat <= n; lat += step) for (let lon = w; lon <= e; lon += step) {
      const t = map.terrainAt(lat, lon);
      if (t !== "WATER") out.push({ lat, lon, t });
    }
    return out;
  }, [scenario, meta?.seed, showTerrain]);

  const { cells, front, units } = useMemo(() => {
    const own = view === "WHITE" ? "BLUE" : view;
    const ps = new Map<string, { own: number; enemy: number }>();
    const add = (lat: number, lon: number, side: "own" | "enemy", p: number) => {
      const c = latLngToCell(lat, lon, 5);
      const x = ps.get(c) ?? { own: 0, enemy: 0 };
      x[side] += p;
      ps.set(c, x);
    };
    const units = [...entities.values()].filter((e) => !e.destroyed && (e.domain === "LAND" || e.cls === "ugv"));
    for (const e of units) if (hasClass(e.cls) && getClass(e.cls).combatPower > 0) add(e.lat, e.lon, e.faction === own ? "own" : "enemy", power(e.cls) * (e.strength ?? e.health));
    if (view !== "WHITE") for (const t of tracks) if (t.affiliation === "HOSTILE" && t.believedDomain === "LAND") add(t.lat, t.lon, "enemy", power(t.believedClass));
    // Spread influence one ring out so the heat map reads as areas rather than dots.
    const spread = new Map<string, { own: number; enemy: number }>();
    for (const [c, x] of ps) for (const nb of gridDisk(c, 1)) {
      const y = spread.get(nb) ?? { own: 0, enemy: 0 };
      const w = nb === c ? 1 : 0.4;
      y.own += x.own * w;
      y.enemy += x.enemy * w;
      spread.set(nb, y);
    }
    const ctrl = new Map<string, number>();
    for (const [c, x] of spread) ctrl.set(c, x.own > x.enemy * 1.2 ? 1 : x.enemy > x.own * 1.2 ? -1 : 0);
    const front: [number, number][][] = [];
    for (const [c, sgn] of ctrl) {
      if (sgn !== 1) continue;
      for (const nb of gridDisk(c, 1)) {
        if (nb === c || ctrl.get(nb) !== -1) continue;
        try {
          front.push(directedEdgeToBoundary(cellsToDirectedEdge(c, nb)) as [number, number][]);
        } catch { /* not neighbors */ }
      }
    }
    return { cells: [...spread.entries()], front, units };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, view]);

  const ratioColor = (o: number, e: number) => {
    const r = Math.log2((o + 1) / (e + 1));
    const a = Math.min(0.55, Math.abs(r) / 6);
    return r >= 0 ? `rgba(0,114,178,${a})` : `rgba(213,94,0,${a})`;
  };

  return (
    <Console title="Land Operations Console" concept="Combat power ratios, terrain and sustainment effects" flush
      tools={
        <>
          <button className={`small ${showRatio ? "primary" : ""}`} onClick={() => setShowRatio((x) => !x)}>force ratio</button>
          <button className={`small ${showTerrain ? "primary" : ""}`} onClick={() => setShowTerrain((x) => !x)}>terrain</button>
          <div className="legend"><span><i style={{ background: "#0072B2", opacity: 0.5 }} />{view === "WHITE" ? "Blue" : "own"} superiority</span><span><i style={{ background: "#D55E00", opacity: 0.5 }} />{view === "WHITE" ? "Red" : "enemy"} superiority</span><span><i style={{ background: "var(--accent-2)" }} />front line</span><span>● supply: green &gt;3 d, amber 1–3, red &lt;1</span></div>
        </>
      }>
      <div ref={ref} style={{ position: "absolute", inset: 0 }}>
        <svg width={size.w} height={size.h} role="img" aria-label="Land operations map">
          <rect width={size.w} height={size.h} fill="var(--ocean)" />
          <LandShapes project={project} />
          {terrain.map((p, i) => { const [x, y] = project(p.lat, p.lon); return <rect key={i} x={x - 2} y={y - 2} width={4} height={4} fill={TERRAIN_COLOR[p.t]} opacity={0.55} />; })}
          {showRatio && cells.map(([c, x]) => (
            <path key={c} d={"M" + cellToBoundary(c).map(([la, lo]) => project(la, lo).join(",")).join("L") + "Z"} fill={ratioColor(x.own, x.enemy)} stroke="none" />
          ))}
          {front.map((seg, i) => <path key={i} d={"M" + seg.map(([la, lo]) => project(la, lo).join(",")).join("L")} stroke="var(--accent-2)" strokeWidth={3} fill="none" strokeLinecap="round" />)}
          {units.map((e) => {
            const [x, y] = project(e.lat, e.lon);
            const affil = affiliationOf(e.faction, view);
            const sup = e.supplyDays > 3 ? "#3fb68b" : e.supplyDays >= 1 ? "#e6b800" : "#e5533d";
            return (
              <g key={e.id} onClick={() => select(e.id)} style={{ cursor: "pointer" }}>
                <image href={symbolDataUrl(symbolKey(affil, e.cls, fillFor(affil, e.faction, view)))} x={x - 12} y={y - 12} width={24} height={24} opacity={e.strength !== undefined && e.strength < 0.3 ? 0.5 : 1} />
                <circle cx={x + 11} cy={y - 9} r={3.5} fill={sup}><title>{`${e.callsign}: ${e.supplyDays.toFixed(1)} days of supply, strength ${Math.round((e.strength ?? e.health) * 100)}%`}</title></circle>
                {selected === e.id && <circle cx={x} cy={y} r={15} fill="none" stroke="var(--accent-2)" strokeWidth={2} />}
              </g>
            );
          })}
          {view !== "WHITE" && tracks.filter((t) => t.believedDomain === "LAND" && t.affiliation !== "NEUTRAL").map((t) => {
            const [x, y] = project(t.lat, t.lon);
            const affil = t.affiliation === "HOSTILE" ? "H" : "U";
            return <image key={t.id} href={symbolDataUrl(symbolKey(affil, t.believedClass ?? "LAND", fillFor(affil, undefined, view)))} x={x - 11} y={y - 11} width={22} height={22} opacity={0.8} onClick={() => select(t.id)} />;
          })}
        </svg>
      </div>
    </Console>
  );
}
