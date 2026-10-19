// Shared MapLibre setup: the basemap style (Natural Earth, bundled), helpers for circles and H3
// control shading, and fitting the camera to a scenario so every map opens at the right zoom.
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 runs its tile/GeoJSON work in a separate module worker; let Vite bundle it.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { feature } from "topojson-client";
import countries50 from "world-atlas/countries-50m.json";
import { cellToBoundary, latLngToCell } from "h3-js";
import type { EntityView, Scenario, TrackView } from "@sentinel/protocol";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

export { maplibregl };
export type FC = GeoJSON.FeatureCollection;
export const fc = (features: GeoJSON.Feature[]): FC => ({ type: "FeatureCollection", features });

export function circle(lat: number, lon: number, km: number, n = 48): number[][] {
  const out: number[][] = [];
  const kx = Math.cos((lat * Math.PI) / 180) || 1e-6;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([lon + (Math.cos(a) * km) / (111.2 * kx), lat + (Math.sin(a) * km) / 111.2]);
  }
  return out;
}

export function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

let countriesFC: FC | null = null;
export function countries(): FC {
  if (!countriesFC) {
    const topo = countries50 as unknown as { objects: { countries: unknown } };
    countriesFC = feature(topo as never, topo.objects.countries as never) as unknown as FC;
  }
  return countriesFC;
}

/** 10-degree graticule for a sense of the globe. */
export function graticule(): FC {
  const f: GeoJSON.Feature[] = [];
  for (let lon = -180; lon <= 180; lon += 10) f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 33 }, (_, i) => [lon, -80 + i * 5]) } });
  for (let lat = -80; lat <= 80; lat += 10) f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]) } });
  return fc(f);
}

const SOURCES = ["cities", "theater", "control", "objectives", "ew", "ellipses", "tasks", "tracks", "entities", "sats", "sel", "stress", "preview"] as const;

export function baseStyle(): StyleSpecification {
  const sources: StyleSpecification["sources"] = {
    countries: { type: "geojson", data: countries() },
    graticule: { type: "geojson", data: graticule() },
  };
  for (const s of SOURCES) sources[s] = { type: "geojson", data: fc([]) };
  return {
    version: 8,
    projection: { type: "globe" },
    sources,
    sky: {
      "sky-color": "#0b1d36",
      "horizon-color": "#5d8fbf",
      "fog-color": "#a9c7e3",
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0],
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": cssVar("--ocean", "#12355a") } },
      { id: "graticule", type: "line", source: "graticule", paint: { "line-color": cssVar("--ocean-deep", "#0b2440"), "line-width": 0.6, "line-opacity": 0.8 } },
      { id: "countries-fill", type: "fill", source: "countries", paint: { "fill-color": cssVar("--land", "#3b4a36") } },
      { id: "coast-line", type: "line", source: "countries", paint: { "line-color": cssVar("--land-line", "#627556"), "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.4, 8, 1.4] } },
      { id: "borders", type: "line", source: "countries", paint: { "line-color": cssVar("--border-line", "#7d8f6e"), "line-width": 0.5, "line-dasharray": [3, 2], "line-opacity": 0.7 } },
      { id: "theater-fill", type: "fill", source: "theater", paint: { "fill-color": cssVar("--theater-land", "#263a2c") } },
      { id: "theater-line", type: "line", source: "theater", paint: { "line-color": cssVar("--land-line", "#2f4262"), "line-width": 1 } },
      { id: "control-fill", type: "fill", source: "control", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.16 } },
      { id: "objectives-fill", type: "fill", source: "objectives", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.06 } },
      { id: "objectives-line", type: "line", source: "objectives", paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-dasharray": [2, 1.5], "line-opacity": 0.95 } },
      { id: "ew-fill", type: "fill", source: "ew", paint: { "fill-color": "#cc79a7", "fill-opacity": 0.07 } },
      { id: "ew-line", type: "line", source: "ew", paint: { "line-color": "#cc79a7", "line-width": 1, "line-dasharray": [1, 2] } },
      { id: "ellipses-fill", type: "fill", source: "ellipses", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.07 } },
      { id: "ellipses-line", type: "line", source: "ellipses", paint: { "line-color": ["get", "color"], "line-width": 1, "line-opacity": 0.6, "line-dasharray": [3, 2] } },
      { id: "tasks", type: "line", source: "tasks", paint: { "line-color": cssVar("--accent-2", "#e69f00"), "line-width": 2, "line-dasharray": [2, 2] } },
      { id: "cities", type: "circle", source: "cities", paint: { "circle-radius": 3.5, "circle-color": cssVar("--text-2", "#9aa8c0"), "circle-stroke-color": cssVar("--bg", "#0a0f1a"), "circle-stroke-width": 1 } },
      { id: "sats", type: "circle", source: "sats", paint: { "circle-radius": 2.2, "circle-color": ["get", "color"], "circle-opacity": 0.7 } },
      { id: "stress", type: "symbol", source: "stress", layout: { "icon-image": ["get", "icon"], "icon-size": 0.4, "icon-allow-overlap": true, "icon-ignore-placement": true } },
      { id: "preview", type: "symbol", source: "preview", layout: { "icon-image": ["get", "icon"], "icon-size": 0.5, "icon-allow-overlap": true, "icon-ignore-placement": true } },
      { id: "tracks", type: "symbol", source: "tracks", layout: { "icon-image": ["get", "icon"], "icon-size": 0.45, "icon-allow-overlap": true, "icon-ignore-placement": true }, paint: { "icon-opacity": ["get", "opacity"] } },
      { id: "entities", type: "symbol", source: "entities", layout: { "icon-image": ["get", "icon"], "icon-size": 0.5, "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "viewport" }, paint: { "icon-opacity": ["get", "opacity"] } },
      { id: "sel", type: "circle", source: "sel", paint: { "circle-radius": 16, "circle-color": "transparent", "circle-stroke-color": cssVar("--accent-2", "#e69f00"), "circle-stroke-width": 2.5 } },
    ],
  };
}

/** Bounds that frame a scenario: its theater box, widened to include every objective. */
export function scenarioBounds(scn: Scenario): [[number, number], [number, number]] {
  let [w, s, e, n] = scn.map.bbox;
  for (const f of scn.factions) for (const o of f.objectives) {
    const dLat = o.radiusKm / 111.2, dLon = o.radiusKm / (111.2 * Math.cos((o.center[0] * Math.PI) / 180));
    w = Math.min(w, o.center[1] - dLon); e = Math.max(e, o.center[1] + dLon);
    s = Math.min(s, o.center[0] - dLat); n = Math.max(n, o.center[0] + dLat);
  }
  return [[w, s], [e, n]];
}

export const prefersReducedMotion = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};

/** Puts the whole theater in view, leaving room for any panels that overlap the map. */
export interface Pad { top: number; bottom: number; left: number; right: number }

export function fitScenario(map: maplibregl.Map, scn: Scenario, padding: Pad, animate = false, duration = 1400) {
  const el = map.getContainer();
  const w = el.clientWidth, h = el.clientHeight;
  // Never ask for more padding than the map has room for.
  const p = { top: Math.min(padding.top, h * 0.4), bottom: Math.min(padding.bottom, h * 0.72), left: Math.min(padding.left, w * 0.6), right: Math.min(padding.right, w * 0.4) };
  map.fitBounds(scenarioBounds(scn), { padding: p, animate: animate && !prefersReducedMotion(), duration, maxZoom: 8.5 });
}

/** Adds milsymbol images on demand. */
export function onMissingImage(map: maplibregl.Map, render: (id: string) => HTMLCanvasElement) {
  map.on("styleimagemissing", (e: maplibregl.MapStyleImageMissingEvent) => {
    if (map.hasImage(e.id)) return;
    const canvas = render(e.id);
    const c2d = canvas.getContext("2d")!;
    map.addImage(e.id, c2d.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 1 });
  });
}

/** H3 control shading: the faction with more presence in each resolution-4 cell colors it. */
export function controlCells(entities: Map<string, EntityView>, tracks: TrackView[], view: string): { data: FC; key: string } {
  const cells = new Map<string, { b: number; r: number }>();
  const add = (lat: number, lon: number, f: string, w: number) => {
    const c = latLngToCell(lat, lon, 4);
    const x = cells.get(c) ?? { b: 0, r: 0 };
    if (f === "BLUE") x.b += w;
    else if (f === "RED") x.r += w;
    cells.set(c, x);
  };
  for (const e of entities.values()) {
    if (e.destroyed || (e.domain !== "LAND" && e.domain !== "SEA")) continue;
    add(e.lat, e.lon, e.faction, e.health);
  }
  if (view !== "WHITE") for (const t of tracks) if (t.affiliation === "HOSTILE" && (t.believedDomain === "LAND" || t.believedDomain === "SEA")) add(t.lat, t.lon, view === "BLUE" ? "RED" : "BLUE", 0.8);
  const feats: GeoJSON.Feature[] = [];
  const keys: string[] = [];
  for (const [c, x] of cells) {
    const color = x.b > x.r * 1.2 ? "#0072B2" : x.r > x.b * 1.2 ? "#D55E00" : "#999999";
    keys.push(`${c}${color[1]}`);
    feats.push({ type: "Feature", properties: { color }, geometry: { type: "Polygon", coordinates: [cellToBoundary(c, true)] } });
  }
  return { data: fc(feats), key: keys.sort().join(",") };
}
