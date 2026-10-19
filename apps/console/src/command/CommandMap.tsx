// The commander's map. Opens framed on the whole theater, labels objectives in plain words, shows
// own forces and enemy contacts (never ground truth), and supports tap-to-select and tap-to-order.
// The same component previews a scenario on the landing page.
import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import type { Scenario } from "@sentinel/protocol";
import { useStore } from "../store";
import { useGame } from "../game/store";
import { baseStyle, circle, controlCells, fc, fitScenario, maplibregl, onMissingImage, prefersReducedMotion, type Pad } from "../map/base";
import { affiliationOf, fillFor, symbolCanvas, symbolKey } from "../lib/symbols";
import { clsName } from "../lib/format";
import { km, placeName } from "../game/places";
import type { ObjectiveStatus, Side } from "../game/types";
import { Legend, type MapLayers } from "./Legend";
import { Icon } from "./Icons";

const ALT_SAT = 1_000_000;
const SIDE_COLOR: Record<Side, string> = { BLUE: "#56b4e9", RED: "#f08a4b" };

interface Props {
  variant: "command" | "landing";
  scenario: Scenario;
  side: Side;
  padding: Pad;
  /** Landing page: the objective list to label (the command map reads the live briefing). */
  objectives?: ObjectiveStatus[];
}

const hoverable = () => {
  try { return window.matchMedia("(hover: hover)").matches; } catch { return true; }
};

export function CommandMap({ variant, scenario, side, padding, objectives }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  const markers = useRef(new Map<string, { m: maplibregl.Marker; el: HTMLElement; sig: string }>());
  const controlKey = useRef("");
  const userMoved = useRef(false);
  const padRef = useRef(padding);
  padRef.current = padding;
  const [layers, setLayers] = useState<MapLayers>({ contacts: true, uncertainty: true, control: true, jamming: true, satellites: false });
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const version = useStore((s) => s.version);
  const selected = useStore((s) => s.selected);
  const pick = useStore((s) => s.pick);
  const brief = useGame((s) => s.brief);
  const focus = useGame((s) => s.focus);

  // Create the map once per scenario.
  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current, style: baseStyle(), center: [scenario.map.center[1], scenario.map.center[0]], zoom: scenario.map.zoom - 1, attributionControl: false,
      maxPitch: 0, dragRotate: false, renderWorldCopies: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Natural Earth · fictional factions" }), "bottom-right");
    // Start the attribution folded to its (i) button so it never covers the map.
    map.once("load", () => setTimeout(() => map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"), 800));
    onMissingImage(map, (id) => symbolCanvas(id).canvas);
    fitScenario(map, scenario, padRef.current);
    if (variant === "command") {
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "map-tip" });
      const hover = hoverable();
      for (const layer of ["entities", "tracks"]) {
        map.on("mouseenter", layer, (e: MapLayerMouseEvent) => {
          map.getCanvas().style.cursor = "pointer";
          const f = e.features?.[0];
          if (f && hover) popup.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setText(String(f.properties?.tip ?? "")).addTo(map);
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = useStore.getState().pick ? "crosshair" : "";
          popup.remove();
        });
      }
      map.on("click", (e: MapMouseEvent) => {
        const st = useStore.getState();
        if (st.pick) {
          st.pick.cb([Math.round(e.lngLat.lat * 1e4) / 1e4, Math.round(e.lngLat.lng * 1e4) / 1e4]);
          st.set({ pick: null });
          map.getCanvas().style.cursor = "";
          return;
        }
        const hit = map.queryRenderedFeatures(e.point, { layers: ["entities", "tracks"] })[0];
        st.select(hit?.properties?.id ? String(hit.properties.id) : null);
      });
    }
    map.on("load", () => {
      loaded.current = true;
      // Panels may have opened while the style loaded: frame the theater for the space available now.
      if (!userMoved.current) fitScenario(map, scenario, padRef.current);
      drawStatic(map);
      if (variant === "command") drawDynamic(map);
      else drawPreview(map);
    });
    mapRef.current = map;
    if (variant === "command") (window as unknown as { __map?: unknown }).__map = map; // for e2e tests
    userMoved.current = false;
    map.on("dragstart", () => { userMoved.current = true; });
    map.on("zoomstart", (e) => { if ((e as { originalEvent?: unknown }).originalEvent) userMoved.current = true; });
    let lastW = 0, lastH = 0;
    const ro = new ResizeObserver(() => {
      map.resize();
      const el = map.getContainer();
      if (!userMoved.current && (Math.abs(el.clientWidth - lastW) > 40 || Math.abs(el.clientHeight - lastH) > 40)) fitScenario(map, scenario, padRef.current);
      lastW = el.clientWidth;
      lastH = el.clientHeight;
    });
    ro.observe(ref.current);
    const marks = markers.current;
    return () => {
      ro.disconnect();
      for (const x of marks.values()) x.m.remove();
      marks.clear();
      map.remove();
      mapRef.current = null;
      loaded.current = false;
      controlKey.current = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, variant]);

  // Landing: re-frame and redraw when the scenario or side changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current || variant !== "landing") return;
    drawPreview(map);
    fitScenario(map, scenario, padRef.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, objectives]);

  function drawStatic(map: maplibregl.Map) {
    (map.getSource("cities") as GeoJSONSource).setData(fc(scenario.map.cities.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [c.at[1], c.at[0]] } }))));
    (map.getSource("theater") as GeoJSONSource).setData(fc(scenario.map.land.map((l) => ({ type: "Feature", properties: { name: l.name }, geometry: { type: "Polygon", coordinates: [l.ring] } }))));
    for (const c of scenario.map.cities) upsertMarker(map, `city:${c.name}`, `<div class="city-label">${escapeHtml(c.name)}</div>`, [c.at[1], c.at[0]], "left");
  }

  /**
   * HTML labels on the map. MapLibre owns the outer element (its classes position it), so updates only
   * replace the inner HTML, and only when it actually changed.
   */
  function upsertMarker(map: maplibregl.Map, key: string, html: string, at: [number, number], anchor: maplibregl.PositionAnchor = "center") {
    const prev = markers.current.get(key);
    if (prev) {
      if (prev.sig !== html) {
        prev.el.innerHTML = html;
        prev.sig = html;
      }
      prev.m.setLngLat(at);
      return;
    }
    const el = document.createElement("div");
    el.className = "map-label";
    el.innerHTML = html;
    const m = new maplibregl.Marker({ element: el, anchor, offset: anchor === "left" ? [6, 0] : [0, 0] }).setLngLat(at).addTo(map);
    markers.current.set(key, { m, el, sig: html });
  }

  function drawObjectives(map: maplibregl.Map, objs: ObjectiveStatus[]) {
    (map.getSource("objectives") as GeoJSONSource).setData(fc(objs.map((o) => ({
      type: "Feature", properties: { color: SIDE_COLOR[o.owner], width: o.mine ? 2.5 : 1.5 },
      geometry: { type: "Polygon", coordinates: [circle(o.center[0], o.center[1], o.radiusKm)] },
    }))));
    // One label per place: own objectives first (they carry the number); an enemy aim centred on the
    // same spot merges into that label instead of stacking on top of it.
    const groups: ObjectiveStatus[][] = [];
    for (const o of objs) {
      const g = groups.find((x) => km(x[0].center, o.center) < Math.max(8, Math.min(x[0].radiusKm, o.radiusKm) * 0.3));
      if (g) g.push(o);
      else groups.push([o]);
    }
    let n = 0;
    for (const list of groups) {
      const mine = list.find((o) => o.mine);
      const theirs = list.find((o) => !o.mine);
      const place = (mine ?? theirs)!.place;
      const num = mine ? ++n : 0;
      const title = [mine && `Your objective: ${mine.name} — ${mine.stateText}`, theirs && `Enemy aim: ${theirs.name} — ${theirs.stateText}`].filter(Boolean).join("\n");
      const html = `<div class="obj-marker ${mine ? `mine st-${mine.state}` : "enemy"}" title="${escapeHtml(title)}">${mine ? `<span class="obj-num">${num}</span>` : `<span class="obj-num enemy">!</span>`}<span class="obj-text"><b>${escapeHtml(place)}</b><small>${mine ? escapeHtml(mine.stateText) : "Enemy aim"}</small></span></div>`;
      // Large areas carry their label near the top edge so it does not cover smaller objectives inside.
      const o = (mine ?? theirs)!;
      const at: [number, number] = o.radiusKm >= 60 ? [o.center[0] + (o.radiusKm * 0.8) / 111.2, o.center[1]] : o.center;
      upsertMarker(map, `obj:${place}`, html, [at[1], at[0]]);
    }
  }

  function drawPreview(map: maplibregl.Map) {
    const objs: ObjectiveStatus[] = objectives ?? [];
    drawObjectives(map, objs);
    const feats: GeoJSON.Feature[] = [];
    for (const g of scenario.orbat) {
      if (g.decoy) continue;
      const affil = affiliationOf(g.faction, side);
      feats.push({ type: "Feature", properties: { icon: symbolKey(affil, g.cls, fillFor(affil, g.faction, side)) }, geometry: { type: "Point", coordinates: [g.at[1], g.at[0]] } });
    }
    (map.getSource("preview") as GeoJSONSource).setData(fc(feats));
  }

  function drawDynamic(map: maplibregl.Map) {
    if (!loaded.current) return;
    const st = useStore.getState();
    const lay = layersRef.current;
    const v = st.view;
    const ents: GeoJSON.Feature[] = [];
    const sats: GeoJSON.Feature[] = [];
    for (const e of st.entities.values()) {
      if (e.destroyed) continue;
      if (e.domain === "SPACE" && e.alt > ALT_SAT) {
        sats.push({ type: "Feature", properties: { color: fillFor(affiliationOf(e.faction, v), e.faction, v) }, geometry: { type: "Point", coordinates: [e.lon, e.lat] } });
        continue;
      }
      const affil = affiliationOf(e.faction, v);
      const tip = `${e.callsign} · ${clsName(e.cls)} · ${e.task.toLowerCase()} · ${Math.round((e.strength ?? e.health) * 100)}%${e.comms === "CUT" ? " · out of contact" : ""}`;
      ents.push({ type: "Feature", properties: { id: e.id, icon: symbolKey(affil, e.cls, fillFor(affil, e.faction, v)), opacity: e.comms === "CUT" ? 0.5 : 1, tip }, geometry: { type: "Point", coordinates: [e.lon, e.lat] } });
    }
    (map.getSource("entities") as GeoJSONSource).setData(fc(ents));
    (map.getSource("sats") as GeoJSONSource).setData(fc(lay.satellites ? sats : []));
    const trs: GeoJSON.Feature[] = [];
    const ells: GeoJSON.Feature[] = [];
    if (lay.contacts && v !== "WHITE") {
      for (const t of st.tracks) {
        const affil = t.affiliation === "HOSTILE" ? "H" : t.affiliation === "NEUTRAL" ? "N" : "U";
        const age = Math.round((st.simMs - t.lastSeenMs) / 60000);
        const tip = `${t.affiliation === "HOSTILE" ? "Enemy" : t.affiliation === "NEUTRAL" ? "Neutral" : "Unknown"} ${t.believedClass ? clsName(t.believedClass).toLowerCase() : t.believedDomain.toLowerCase()} · ${t.quality.toLowerCase()} · seen ${age} min ago · ±${Math.round(t.ellipse[0])} km`;
        trs.push({ type: "Feature", properties: { id: t.id, icon: symbolKey(affil, t.believedClass ?? t.believedDomain, fillFor(affil, undefined, v)), opacity: t.quality === "DETECTED" ? 0.5 : t.quality === "CLASSIFIED" ? 0.75 : 1, tip }, geometry: { type: "Point", coordinates: [t.lon, t.lat] } });
        if ((lay.uncertainty || t.id === st.selected) && t.ellipse[0] > 2) ells.push({ type: "Feature", properties: { color: fillFor(affil, undefined, v) }, geometry: { type: "Polygon", coordinates: [circle(t.lat, t.lon, Math.min(300, t.ellipse[0]), 32)] } });
      }
    }
    (map.getSource("tracks") as GeoJSONSource).setData(fc(trs));
    (map.getSource("ellipses") as GeoJSONSource).setData(fc(ells));
    (map.getSource("ew") as GeoJSONSource).setData(fc(lay.jamming ? st.ew.map((f) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circle(f.lat, f.lon, f.radiusKm, 32)] } })) : []));
    if (lay.control) {
      const cells = controlCells(st.entities, st.tracks, v);
      if (cells.key !== controlKey.current) {
        controlKey.current = cells.key;
        (map.getSource("control") as GeoJSONSource).setData(cells.data);
      }
    } else if (controlKey.current) {
      controlKey.current = "";
      (map.getSource("control") as GeoJSONSource).setData(fc([]));
    }
    // Selection ring and, for own units, a dashed line to where they were told to go.
    const sel = st.selected ? st.entities.get(st.selected) : undefined;
    const tsel = st.selected && !sel ? st.tracks.find((t) => t.id === st.selected) : undefined;
    const p = sel ? [sel.lon, sel.lat] : tsel ? [tsel.lon, tsel.lat] : null;
    (map.getSource("sel") as GeoJSONSource).setData(fc(p ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } }] : []));
    (map.getSource("tasks") as GeoJSONSource).setData(fc(sel?.taskPoint ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[sel.lon, sel.lat], [sel.taskPoint[1], sel.taskPoint[0]]] } }] : []));
  }

  useEffect(() => {
    const map = mapRef.current;
    if (map && variant === "command") drawDynamic(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, layers, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded.current && variant === "command" && brief) drawObjectives(map, brief.objectives);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief]);

  // Bring a newly selected unit into view if it is off-screen (once, not on every update).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current || !selected) return;
    const st = useStore.getState();
    const e = st.entities.get(selected);
    const t = e ? undefined : st.tracks.find((x) => x.id === selected);
    const p: [number, number] | null = e ? [e.lon, e.lat] : t ? [t.lon, t.lat] : null;
    if (p && !map.getBounds().contains(p)) map.easeTo({ center: p, duration: prefersReducedMotion() ? 0 : 500 });
  }, [selected]);

  // Requests from the briefing or the Ask bar to look at a place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.easeTo({ center: [focus.center[1], focus.center[0]], zoom: focus.zoom ?? Math.max(map.getZoom(), 7), duration: prefersReducedMotion() ? 0 : 700, padding: padRef.current });
  }, [focus]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = pick ? "crosshair" : "";
  }, [pick]);

  // Phones: when a sheet covers the lower map, re-frame the theater into the space that is left.
  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded.current && variant === "command" && !userMoved.current) fitScenario(map, scenario, padRef.current, true, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padding.bottom]);

  const recenter = () => {
    userMoved.current = false;
    if (mapRef.current) fitScenario(mapRef.current, scenario, padRef.current, true, 700);
  };

  return (
    <div className={`cmap cmap-${variant}`}>
      <div ref={ref} className="cmap-canvas" />
      {variant === "command" && (
        <>
          <button className="map-btn recenter" onClick={recenter} title="Show the whole theater (C)" aria-label="Show the whole theater" data-tour="recenter"><Icon name="recenter" /></button>
          <Legend side={side} layers={layers} onLayers={setLayers} />
          {pick && <div className="pick-banner" role="status">{pick.label} — tap the map <button className="small" onClick={() => useStore.getState().set({ pick: null })}>Cancel</button></div>}
        </>
      )}
      {variant === "landing" && <Legend side={side} compact />}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Objective list for a scenario before play starts (landing page). */
export function scenarioObjectives(scn: Scenario, side: Side): ObjectiveStatus[] {
  return scn.factions.flatMap((f) => f.objectives.map((o) => ({
    id: o.id, name: o.name, place: placeName(scn, o), owner: f.id as Side, mine: f.id === side, kind: o.kind, state: "open" as const,
    stateText: f.id === side ? (o.weight > 1 ? "Main objective" : "Objective") : "Enemy aim", weight: o.weight, heldHours: 0, center: o.center, radiusKm: o.radiusKm,
  }))).sort((a, b) => Number(b.mine) - Number(a.mine) || b.weight - a.weight);
}
