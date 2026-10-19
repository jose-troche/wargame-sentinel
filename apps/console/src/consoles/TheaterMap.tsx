// Console 1 — Global Theater Map: the common operational picture on a 3D globe. In a faction view
// enemies appear only as tracks with uncertainty ellipses; the White view shows ground truth.
import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import { useStore } from "../store";
import { baseStyle, circle, controlCells, fc, fitScenario, maplibregl, onMissingImage } from "../map/base";
import { Console } from "./common";
import { affiliationOf, fillFor, symbolCanvas, symbolKey } from "../lib/symbols";
import { clsName, simTime } from "../lib/format";

const ALT_SAT = 1_000_000;

export function TheaterMap() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  const lastControl = useRef(0);
  const lastControlKey = useRef("");
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
    if (st.scenario) fitScenario(map, st.scenario, { top: 50, bottom: 30, left: 30, right: 60 });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Basemap: Natural Earth 1:50m (public domain). Factions, forces and place names are fictional." }));
    onMissingImage(map, (id) => symbolCanvas(id).canvas);
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
      fc(layers.objectives ? (st.politics?.objectives ?? []).map((o) => ({ type: "Feature", properties: { color: o.owner === "BLUE" ? "#56b4e9" : "#e69f00", name: o.name, width: 2 }, geometry: { type: "Polygon", coordinates: [circle(o.center[0], o.center[1], o.radiusKm)] } })) : []),
    );
    const t = performance.now();
    if (layers.control && (force || t - lastControl.current > 2000)) {
      lastControl.current = t;
      const cells = controlCells(st.entities, st.tracks, v);
      if (cells.key !== lastControlKey.current) {
        lastControlKey.current = cells.key;
        (map.getSource("control") as GeoJSONSource).setData(cells.data);
      }
    } else if (!layers.control) {
      lastControlKey.current = "";
      (map.getSource("control") as GeoJSONSource).setData(fc([]));
    }
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
      if (scenario) fitScenario(map, scenario, { top: 50, bottom: 30, left: 30, right: 60 });
      drawDynamic(map, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, view]);

  // Linked selection: ring the selected unit or track, and bring it into view once when it is selected
  // (not on every delta, which would fight the user's own panning).
  const selPos = () => {
    const st = useStore.getState();
    const e = selected ? st.entities.get(selected) : undefined;
    const t = selected && !e ? st.tracks.find((x) => x.id === selected) : undefined;
    return e ? [e.lon, e.lat] as [number, number] : t ? [t.lon, t.lat] as [number, number] : null;
  };
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    const p = selPos();
    (map.getSource("sel") as GeoJSONSource).setData(fc(p ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } }] : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, version]);
  useEffect(() => {
    const map = mapRef.current;
    const p = selPos();
    if (map && loaded.current && p && !map.getBounds().contains(p)) map.easeTo({ center: p, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

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
