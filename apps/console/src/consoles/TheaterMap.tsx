// Console 1 — Global Theater Map: the common operational picture on a 3D globe. In a faction view
// enemies appear only as tracks with uncertainty ellipses; the White view shows ground truth.
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification, MapLayerMouseEvent, MapMouseEvent, MapStyleImageMissingEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 runs its tile/GeoJSON work in a separate module worker; let Vite bundle it.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { feature } from "topojson-client";
import countries50 from "world-atlas/countries-50m.json";
import { cellToBoundary, latLngToCell } from "h3-js";
import type { EntityView, TrackView } from "@sentinel/protocol";
import { useStore } from "../store";
import { Console } from "./common";
import { affiliationOf, fillFor, symbolCanvas, symbolKey } from "../lib/symbols";
import { clsName, simTime } from "../lib/format";

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({ type: "FeatureCollection", features });

function circle(lat: number, lon: number, km: number, n = 32): number[][] {
  const out: number[][] = [];
  const kx = Math.cos((lat * Math.PI) / 180) || 1e-6;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([lon + (Math.cos(a) * km) / (111.2 * kx), lat + (Math.sin(a) * km) / 111.2]);
  }
  return out;
}

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

maplibregl.setWorkerUrl(maplibreWorkerUrl);

let countriesFC: FC | null = null;
function countries(): FC {
  if (!countriesFC) {
    const topo = countries50 as unknown as { objects: { countries: unknown } };
    countriesFC = feature(topo as never, topo.objects.countries as never) as unknown as FC;
  }
  return countriesFC;
}

/** 10-degree graticule for a sense of the globe. */
function graticule(): FC {
  const f: GeoJSON.Feature[] = [];
  for (let lon = -180; lon <= 180; lon += 10) f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 33 }, (_, i) => [lon, -80 + i * 5]) } });
  for (let lat = -80; lat <= 80; lat += 10) f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]) } });
  return fc(f);
}

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    sources: {
      countries: { type: "geojson", data: countries() },
      graticule: { type: "geojson", data: graticule() },
      cities: { type: "geojson", data: fc([]) },
      theater: { type: "geojson", data: fc([]) },
      control: { type: "geojson", data: fc([]) },
      objectives: { type: "geojson", data: fc([]) },
      ew: { type: "geojson", data: fc([]) },
      ellipses: { type: "geojson", data: fc([]) },
      tracks: { type: "geojson", data: fc([]) },
      entities: { type: "geojson", data: fc([]) },
      sats: { type: "geojson", data: fc([]) },
      sel: { type: "geojson", data: fc([]) },
      stress: { type: "geojson", data: fc([]) },
    },
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
      { id: "control-fill", type: "fill", source: "control", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.22 } },
      { id: "objectives-line", type: "line", source: "objectives", paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [2, 2] } },
      { id: "ew-fill", type: "fill", source: "ew", paint: { "fill-color": "#cc79a7", "fill-opacity": 0.12 } },
      { id: "ew-line", type: "line", source: "ew", paint: { "line-color": "#cc79a7", "line-width": 1, "line-dasharray": [1, 2] } },
      { id: "ellipses-fill", type: "fill", source: "ellipses", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.07 } },
      { id: "ellipses-line", type: "line", source: "ellipses", paint: { "line-color": ["get", "color"], "line-width": 1, "line-opacity": 0.6, "line-dasharray": [3, 2] } },
      { id: "cities", type: "circle", source: "cities", paint: { "circle-radius": 3.5, "circle-color": cssVar("--text-2", "#9aa8c0"), "circle-stroke-color": cssVar("--bg", "#0a0f1a"), "circle-stroke-width": 1 } },
      { id: "sats", type: "circle", source: "sats", paint: { "circle-radius": 2.2, "circle-color": ["get", "color"], "circle-opacity": 0.7 } },
      { id: "stress", type: "symbol", source: "stress", layout: { "icon-image": ["get", "icon"], "icon-size": 0.4, "icon-allow-overlap": true, "icon-ignore-placement": true } },
      { id: "tracks", type: "symbol", source: "tracks", layout: { "icon-image": ["get", "icon"], "icon-size": 0.45, "icon-allow-overlap": true, "icon-ignore-placement": true }, paint: { "icon-opacity": ["get", "opacity"] } },
      { id: "entities", type: "symbol", source: "entities", layout: { "icon-image": ["get", "icon"], "icon-size": 0.5, "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "viewport" }, paint: { "icon-opacity": ["get", "opacity"] } },
      { id: "sel", type: "circle", source: "sel", paint: { "circle-radius": 16, "circle-color": "transparent", "circle-stroke-color": cssVar("--accent-2", "#e69f00"), "circle-stroke-width": 2.5 } },
    ],
  };
}

const ALT_SAT = 1_000_000;

export function TheaterMap() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  const lastControl = useRef(0);
  const version = useStore((s) => s.version);
  const view = useStore((s) => s.view);
  const scenario = useStore((s) => s.scenario);
  const selected = useStore((s) => s.selected);
  const pick = useStore((s) => s.pick);
  const [layers, setLayers] = useState({ tracks: true, ellipses: true, control: true, ew: true, objectives: true, space: false });
  const [stress, setStress] = useState(false);
  const [fps, setFps] = useState(0);

  // Create the map once.
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const st = useStore.getState();
    const center = st.scenario?.map.center ?? [-40, -130];
    const map = new maplibregl.Map({
      container: ref.current, style: baseStyle(), center: [center[1], center[0]], zoom: st.scenario?.map.zoom ?? 3.5, attributionControl: false,
      maxPitch: 60, renderWorldCopies: false,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Basemap: Natural Earth 1:50m (public domain). Factions, forces and place names are fictional." }));
    map.on("styleimagemissing", (e: MapStyleImageMissingEvent) => {
      if (map.hasImage(e.id)) return;
      const { canvas } = symbolCanvas(e.id);
      const c2d = canvas.getContext("2d")!;
      map.addImage(e.id, c2d.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 1 });
    });
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    for (const layer of ["entities", "tracks"]) {
      map.on("mouseenter", layer, (e: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (f) popup.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setHTML(String(f.properties?.html ?? "")).addTo(map);
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = useStore.getState().pick ? "crosshair" : "";
        popup.remove();
      });
      map.on("click", layer, (e: MapLayerMouseEvent) => {
        if (useStore.getState().pick) return;
        const id = e.features?.[0]?.properties?.id;
        if (id) useStore.getState().select(String(id));
      });
    }
    map.on("click", (e: MapMouseEvent) => {
      const p = useStore.getState().pick;
      if (p) {
        p.cb([Math.round(e.lngLat.lat * 1e4) / 1e4, Math.round(e.lngLat.lng * 1e4) / 1e4]);
        useStore.getState().set({ pick: null });
        map.getCanvas().style.cursor = "";
      }
    });
    map.on("load", () => {
      loaded.current = true;
      drawStatic(map);
      drawDynamic(map, true);
    });
    mapRef.current = map;
    (window as unknown as { __map?: unknown }).__map = map; // for e2e tests
    // FPS meter (NFR-04 check): counts rendered frames per second.
    let frames = 0;
    let t0 = performance.now();
    let raf = 0;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - t0 >= 1000) {
        setFps(Math.round((frames * 1000) / (now - t0)));
        frames = 0;
        t0 = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(ref.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      loaded.current = false;
    };
  }, []);

  function drawStatic(map: maplibregl.Map) {
    const scn = useStore.getState().scenario;
    if (!scn) return;
    (map.getSource("cities") as GeoJSONSource).setData(fc(scn.map.cities.map((c) => ({ type: "Feature", properties: { html: `<b>${c.name}</b> (fictional) · ${c.faction}` }, geometry: { type: "Point", coordinates: [c.at[1], c.at[0]] } }))));
    (map.getSource("theater") as GeoJSONSource).setData(
      fc(scn.map.land.map((l) => ({ type: "Feature", properties: { name: l.name }, geometry: { type: "Polygon", coordinates: [l.ring] } }))),
    );
  }

  function drawDynamic(map: maplibregl.Map, force = false) {
    if (!loaded.current) return;
    const st = useStore.getState();
    const v = st.view;
    const now = st.simMs;
    const ents: GeoJSON.Feature[] = [];
    const sats: GeoJSON.Feature[] = [];
    for (const e of st.entities.values()) {
      if (e.destroyed) continue;
      if (e.domain === "SPACE" && e.alt > ALT_SAT) {
        sats.push({ type: "Feature", properties: { color: fillFor(affiliationOf(e.faction, v), e.faction, v) }, geometry: { type: "Point", coordinates: [e.lon, e.lat] } });
        continue;
      }
      const affil = affiliationOf(e.faction, v);
      const key = symbolKey(affil, e.cls, fillFor(affil, e.faction, v));
      const html = `<b>${e.callsign}</b> · ${clsName(e.cls)}<br/>Task ${e.task}${e.taskTarget ? ` → ${e.taskTarget}` : ""}<br/>Health ${Math.round(e.health * 100)}% · Supply ${e.supplyDays.toFixed(1)} d · Comms ${e.comms}${e.count ? `<br/>Members ${e.count}` : ""}${e.decoy ? "<br/><i>Decoy</i>" : ""}`;
      ents.push({ type: "Feature", properties: { id: e.id, icon: key, opacity: e.comms === "CUT" ? 0.55 : 1, html }, geometry: { type: "Point", coordinates: [e.lon, e.lat] } });
    }
    (map.getSource("entities") as GeoJSONSource).setData(fc(ents));
    (map.getSource("sats") as GeoJSONSource).setData(fc(layers.space ? sats : []));

    const trs: GeoJSON.Feature[] = [];
    const ells: GeoJSON.Feature[] = [];
    if (layers.tracks) {
      for (const t of st.tracks) {
        if (v === "WHITE") continue; // ground truth already shows the real entity
        const affil = t.affiliation === "HOSTILE" ? "H" : t.affiliation === "NEUTRAL" ? "N" : "U";
        const key = symbolKey(affil, t.believedClass ?? t.believedDomain, fillFor(affil, undefined, v));
        const age = Math.round((now - t.lastSeenMs) / 60000);
        const html = `<b>Track ${t.id}</b> · ${t.believedClass ? clsName(t.believedClass) : t.believedDomain}<br/>${t.quality} · ${t.affiliation} · seen ${age} min ago<br/>Uncertainty ±${t.ellipse[0]} km · sources ${t.sources.join(", ")}`;
        trs.push({ type: "Feature", properties: { id: t.id, icon: key, opacity: t.quality === "DETECTED" ? 0.5 : t.quality === "CLASSIFIED" ? 0.75 : 1, html }, geometry: { type: "Point", coordinates: [t.lon, t.lat] } });
        if (layers.ellipses && t.ellipse[0] > 0.5) ells.push({ type: "Feature", properties: { color: fillFor(affil, undefined, v) }, geometry: { type: "Polygon", coordinates: [circle(t.lat, t.lon, Math.min(400, t.ellipse[0]))] } });
      }
      if (v === "WHITE") {
        // In the White view, show both factions' uncertainty ellipses around the truth they believe.
        for (const t of st.tracks) if (layers.ellipses && t.ellipse[0] > 1) ells.push({ type: "Feature", properties: { color: t.owner === "BLUE" ? "#56b4e9" : "#e69f00" }, geometry: { type: "Polygon", coordinates: [circle(t.lat, t.lon, Math.min(400, t.ellipse[0]))] } });
      }
    }
    (map.getSource("tracks") as GeoJSONSource).setData(fc(trs));
    (map.getSource("ellipses") as GeoJSONSource).setData(fc(ells));
    (map.getSource("ew") as GeoJSONSource).setData(fc(layers.ew ? st.ew.map((f) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circle(f.lat, f.lon, f.radiusKm)] } })) : []));
    (map.getSource("objectives") as GeoJSONSource).setData(
      fc(layers.objectives ? (st.politics?.objectives ?? []).map((o) => ({ type: "Feature", properties: { color: o.owner === "BLUE" ? "#56b4e9" : "#e69f00", name: o.name }, geometry: { type: "Polygon", coordinates: [circle(o.center[0], o.center[1], o.radiusKm)] } })) : []),
    );
    const t = performance.now();
    if (layers.control && (force || t - lastControl.current > 2000)) {
      lastControl.current = t;
      (map.getSource("control") as GeoJSONSource).setData(controlCells(st.entities, st.tracks, v));
    } else if (!layers.control) (map.getSource("control") as GeoJSONSource).setData(fc([]));
  }

  useEffect(() => {
    const map = mapRef.current;
    if (map) drawDynamic(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, layers]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded.current) {
      drawStatic(map);
      if (scenario) map.jumpTo({ center: [scenario.map.center[1], scenario.map.center[0]], zoom: scenario.map.zoom });
      drawDynamic(map, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, view]);

  // Linked selection: fly to and ring the selected unit or track.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    const st = useStore.getState();
    const e = selected ? st.entities.get(selected) : undefined;
    const t = selected && !e ? st.tracks.find((x) => x.id === selected) : undefined;
    const p = e ? [e.lon, e.lat] : t ? [t.lon, t.lat] : null;
    (map.getSource("sel") as GeoJSONSource).setData(fc(p ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } }] : []));
    if (p) map.easeTo({ center: p as [number, number], duration: 600 });
  }, [selected, version]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = pick ? "crosshair" : "";
  }, [pick]);

  // Rendering stress test: 5,000 instanced symbols moving at the delta rate.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    const src = map.getSource("stress") as GeoJSONSource;
    if (!stress) {
      src.setData(fc([]));
      return;
    }
    const [w, s, e, n] = useStore.getState().scenario?.map.bbox ?? [-150, -50, -110, -30];
    const pts = Array.from({ length: 5000 }, (_, i) => ({ lat: s + Math.random() * (n - s), lon: w + Math.random() * (e - w), i }));
    const keys = ["F|fighter_mr|#0072B2", "H|destroyer|#D55E00", "F|armored_bde|#0072B2", "H|quad_swarm|#D55E00", "N|oiler|#009E73"];
    const draw = () => {
      for (const p of pts) { p.lat += (Math.random() - 0.5) * 0.02; p.lon += (Math.random() - 0.5) * 0.02; }
      src.setData(fc(pts.map((p) => ({ type: "Feature", properties: { icon: keys[p.i % keys.length] }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } }))));
    };
    draw();
    const id = setInterval(draw, 200);
    return () => clearInterval(id);
  }, [stress]);

  const toggle = (k: keyof typeof layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const simMs = useStore((s) => s.simMs);
  return (
    <Console
      title="Global Theater Map"
      concept={view === "WHITE" ? "Ground truth (White cell)" : `${view} common operational picture — fog of war`}
      flush
      tools={<span className="muted mono">{simTime(simMs)}</span>}
    >
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      <div className="map-tools">
        {(Object.keys(layers) as (keyof typeof layers)[]).map((k) => (
          <button key={k} className={layers[k] ? "on" : ""} onClick={() => toggle(k)} aria-pressed={layers[k]}>{k}</button>
        ))}
        <button className={stress ? "on" : ""} onClick={() => setStress((x) => !x)} title="Render 5,000 extra symbols to check the 60 fps target">5k stress</button>
      </div>
      {pick && <div className="pick-banner">{pick.label} — click the map (Esc to cancel)</div>}
      <div className="fps" aria-label="frames per second">{fps} fps{stress ? " · 5,000 test symbols" : ""}</div>
    </Console>
  );
}

/** H3 control shading: the faction with more presence in each resolution-4 cell colors it. */
function controlCells(entities: Map<string, EntityView>, tracks: TrackView[], view: string): FC {
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
  for (const [c, x] of cells) {
    const color = x.b > x.r * 1.2 ? "#0072B2" : x.r > x.b * 1.2 ? "#D55E00" : "#999999";
    feats.push({ type: "Feature", properties: { color }, geometry: { type: "Polygon", coordinates: [cellToBoundary(c, true)] } });
  }
  return fc(feats);
}
