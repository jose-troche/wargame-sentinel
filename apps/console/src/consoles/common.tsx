import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "../store";
import type { EntityView, Faction, View } from "@sentinel/protocol";
import { FACTION_COLORS } from "@sentinel/protocol";
import { feature } from "topojson-client";
import land50 from "world-atlas/land-50m.json";

export function Console(props: { title: string; concept: string; tools?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="console" aria-label={props.title}>
      <header className="console-head">
        {props.tools}
        <span className="concept">{props.concept}</span>
      </header>
      <div className={`console-body${props.flush ? " flush" : ""}`}>{props.children}</div>
    </section>
  );
}

/** Re-render on every applied delta (throttled by the delta rate itself, ≤5 Hz). */
export function useVersion() {
  return useStore((s) => s.version);
}

export function useEntities(filter?: (e: EntityView) => boolean): EntityView[] {
  const v = useVersion();
  const entities = useStore((s) => s.entities);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => [...entities.values()].filter((e) => !filter || filter(e)), [v, entities]);
}

export function factionColor(f: Faction | "WHITE" | "UNKNOWN") {
  return FACTION_COLORS[f];
}

/** Factions whose own data (C2, logistics) a view may inspect. */
export function ownFactions(view: View): ("BLUE" | "RED")[] {
  return view === "WHITE" ? ["BLUE", "RED"] : [view];
}

export function FactionToggle(props: { value: "BLUE" | "RED"; onChange: (f: "BLUE" | "RED") => void }) {
  const view = useStore((s) => s.view);
  if (view !== "WHITE") return null;
  return (
    <div className="row" role="group" aria-label="Faction">
      {(["BLUE", "RED"] as const).map((f) => (
        <button key={f} className={`small ${props.value === f ? "primary" : ""}`} onClick={() => props.onChange(f)} aria-pressed={props.value === f}>
          {f === "BLUE" ? "■ Blue" : "◆ Red"}
        </button>
      ))}
    </div>
  );
}

/** Equirectangular projection over the scenario bounding box for 2D teaching maps. */
export function useProjection(width: number, height: number) {
  const scenario = useStore((s) => s.scenario);
  return useMemo(() => {
    const [w, s, e, n] = scenario?.map.bbox ?? [-180, -60, 180, 60];
    const span = e - w;
    const kx = Math.cos((((s + n) / 2) * Math.PI) / 180);
    const scale = Math.min(width / (span * kx), height / (n - s));
    const ox = (width - span * kx * scale) / 2, oy = (height - (n - s) * scale) / 2;
    const project = (lat: number, lon: number): [number, number] => [ox + (lon - w) * kx * scale, oy + (n - lat) * scale];
    const kmToPx = (km: number) => (km / 111.2) * scale;
    return { project, kmToPx, bbox: [w, s, e, n] as const };
  }, [scenario, width, height]);
}

let realLand: { bbox: [number, number, number, number]; rings: number[][][] }[] | null = null;
function realLandPolys() {
  if (!realLand) {
    const topo = land50 as unknown as { objects: { land: unknown } };
    const f = feature(topo as never, topo.objects.land as never) as unknown as GeoJSON.FeatureCollection;
    realLand = [];
    for (const ft of f.features) {
      const g = ft.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      for (const poly of g.type === "Polygon" ? [g.coordinates] : g.coordinates) {
        let a = 180, b = 90, c = -180, d = -90;
        for (const [x, y] of poly[0]) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
        realLand.push({ bbox: [a, b, c, d], rings: poly });
      }
    }
  }
  return realLand;
}

/** Real coastlines (Natural Earth 50m) inside the scenario box, plus any fictional landmasses and cities. */
export function LandShapes(props: { project: (lat: number, lon: number) => [number, number] }) {
  const scenario = useStore((s) => s.scenario);
  const real = useMemo(() => {
    if (!scenario) return [];
    const [w, s, e, n] = scenario.map.bbox;
    return realLandPolys()
      .filter((p) => p.bbox[2] >= w - 2 && p.bbox[0] <= e + 2 && p.bbox[3] >= s - 2 && p.bbox[1] <= n + 2)
      .map((p) => p.rings.map((r) => "M" + r.map(([lon, lat]) => props.project(lat, lon).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join(""));
  }, [scenario, props.project]);
  if (!scenario) return null;
  return (
    <g>
      {real.map((d, i) => <path key={`r${i}`} d={d} fill="var(--land)" stroke="var(--land-line)" strokeWidth={0.8} fillRule="evenodd" />)}
      {scenario.map.land.map((l) => (
        <path key={l.name} d={"M" + l.ring.map(([lon, lat]) => props.project(lat, lon).join(",")).join("L") + "Z"} fill="var(--theater-land)" stroke="var(--land-line)" strokeWidth={1} />
      ))}
      {scenario.map.cities.map((c) => {
        const [x, y] = props.project(c.at[0], c.at[1]);
        return <g key={c.name}><rect x={x - 2.5} y={y - 2.5} width={5} height={5} fill="var(--text-3)" /><text x={x + 5} y={y + 3} fontSize={9} fill="var(--text-3)">{c.name}</text></g>;
      })}
    </g>
  );
}

/** Element size via ResizeObserver (panels are resizable and dockable). */
export function useResize<T extends HTMLElement>(fallback = { w: 600, h: 360 }) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(160, el.clientHeight) });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function Bar(props: { value: number; max: number; color?: string; label?: string }) {
  const p = Math.max(0, Math.min(1, props.max ? props.value / props.max : 0));
  return (
    <div title={props.label} style={{ background: "var(--line)", borderRadius: 3, height: 8, width: "100%", overflow: "hidden" }}>
      <div style={{ width: `${p * 100}%`, height: "100%", background: props.color ?? "var(--accent)" }} />
    </div>
  );
}
