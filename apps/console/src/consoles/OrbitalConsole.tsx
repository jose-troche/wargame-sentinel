// Console 2 — Orbital Console: satellites propagated client-side from orbital elements (same code
// as the engine), ground tracks, ISR footprints, and a pass timeline over the theater that exposes
// revisit gaps — the windows an adversary can exploit.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { feature } from "topojson-client";
import land110 from "world-atlas/land-110m.json";
import { propagate, footprintKm, periodMin } from "@sentinel/engine";
import { getClass } from "@sentinel/catalog";
import { FACTION_COLORS, type SatelliteView } from "@sentinel/protocol";
import { liveSimMs, useStore } from "../store";
import { Console, useResize } from "./common";
import { simTime } from "../lib/format";

const R = 1;
const toXYZ = (lat: number, lon: number, altKm = 0): THREE.Vector3 => {
  const r = R * (1 + altKm / 6371);
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
};

function coastlines(): THREE.BufferGeometry {
  const topo = land110 as unknown as { objects: { land: unknown } };
  const fc = feature(topo as never, topo.objects.land as never) as unknown as GeoJSON.FeatureCollection;
  const pts: number[] = [];
  for (const f of fc.features) {
    const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) for (const ring of poly) {
      for (let i = 1; i < ring.length; i++) {
        const a = toXYZ(ring[i - 1][1], ring[i - 1][0], 2), b = toXYZ(ring[i][1], ring[i][0], 2);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

const ISR = (cls: string) => getClass(cls).tags.includes("ISR");

export function OrbitalConsole() {
  const [ref, size] = useResize<HTMLDivElement>({ w: 600, h: 320 });
  const sats = useStore((s) => s.satellites);
  const debris = useStore((s) => s.debris);
  const scenario = useStore((s) => s.scenario);
  const simMs = useStore((s) => s.simMs);
  const view = useStore((s) => s.view);
  const [onlyIsr, setOnlyIsr] = useState(false);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; points: THREE.Points; orbits: THREE.Group; feet: THREE.Group; debris: THREE.Group } | null>(null);
  const satsRef = useRef<SatelliteView[]>([]);
  satsRef.current = sats.filter((s) => s.alive && (!onlyIsr || ISR(s.cls)));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    camera.position.set(0, 1.2, 4.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.4;
    controls.maxDistance = 14;
    const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), new THREE.MeshBasicMaterial({ color: 0x0d2140 }));
    scene.add(earth);
    scene.add(new THREE.LineSegments(coastlines(), new THREE.LineBasicMaterial({ color: 0x3d5a80, transparent: true, opacity: 0.8 })));
    const grid = new THREE.Mesh(new THREE.SphereGeometry(R * 1.001, 24, 12), new THREE.MeshBasicMaterial({ color: 0x1f3557, wireframe: true, transparent: true, opacity: 0.25 }));
    scene.add(grid);
    const pgeo = new THREE.BufferGeometry();
    const points = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, sizeAttenuation: true }));
    scene.add(points);
    const orbits = new THREE.Group(), feet = new THREE.Group(), deb = new THREE.Group();
    scene.add(orbits, feet, deb);
    three.current = { renderer, scene, camera, points, orbits, feet, debris: deb };
    let raf = 0;
    const loop = () => {
      const t = liveSimMs();
      const list = satsRef.current;
      const pos = new Float32Array(list.length * 3);
      const col = new Float32Array(list.length * 3);
      list.forEach((s, i) => {
        const sp = propagate(s.elements, t);
        const v = toXYZ(sp.lat, sp.lon, Math.min(sp.altKm, 42000) * (sp.altKm > 30000 ? 0.12 : 1));
        pos.set([v.x, v.y, v.z], i * 3);
        const c = new THREE.Color(FACTION_COLORS[s.faction]);
        col.set([c.r, c.g, c.b], i * 3);
      });
      pgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      pgeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      three.current = null;
    };
  }, [ref]);

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.renderer.setSize(size.w, size.h);
    t.camera.aspect = size.w / size.h;
    t.camera.updateProjectionMatrix();
  }, [size]);

  // Ground tracks (one period ahead) and ISR footprints, rebuilt at the delta rate.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    for (const g of [t.orbits, t.feet, t.debris]) while (g.children.length) g.remove(g.children[0]);
    const list = sats.filter((s) => s.alive && (!onlyIsr || ISR(s.cls)));
    for (const s of list.slice(0, 120)) {
      const per = periodMin(s.elements.a) * 60_000;
      if (per > 6 * 3_600_000) continue; // GEO/HEO: no useful ground track
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 80; k++) {
        const sp = propagate(s.elements, simMs + (per * k) / 80);
        pts.push(toXYZ(sp.lat, sp.lon, 3));
      }
      t.orbits.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: FACTION_COLORS[s.faction], transparent: true, opacity: 0.25 })));
      if (ISR(s.cls)) {
        const sp = propagate(s.elements, simMs);
        const ring: THREE.Vector3[] = [];
        const km = s.footprintKm;
        for (let a = 0; a <= 48; a++) {
          const ang = (a / 48) * Math.PI * 2;
          const lat = sp.lat + (Math.sin(ang) * km) / 111.2;
          const lon = sp.lon + (Math.cos(ang) * km) / (111.2 * Math.max(0.1, Math.cos((sp.lat * Math.PI) / 180)));
          ring.push(toXYZ(lat, lon, 4));
        }
        t.feet.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: FACTION_COLORS[s.faction], transparent: true, opacity: 0.8 })));
      }
    }
    for (const d of debris) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * (1 + d.altKm / 6371), 0.004 + d.risk * 0.3, 6, 96), new THREE.MeshBasicMaterial({ color: 0xe5533d, transparent: true, opacity: 0.6 }));
      ring.rotation.x = Math.PI / 2 - (d.incDeg * Math.PI) / 180;
      t.debris.add(ring);
    }
  }, [sats, debris, simMs, onlyIsr]);

  // Pass timeline over the theater center for the next 12 simulated hours.
  const passes = useMemo(() => {
    if (!scenario) return [];
    const [lat, lon] = scenario.map.center;
    const horizon = 12 * 3_600_000, stepMs = 120_000;
    const groups = new Map<string, { label: string; faction: string; spans: [number, number][] }>();
    for (const s of sats) {
      if (!s.alive || !ISR(s.cls)) continue;
      const key = `${s.faction}:${s.cls}`;
      const g = groups.get(key) ?? { label: `${s.faction} ${getClass(s.cls).name}`, faction: s.faction, spans: [] };
      let open: number | null = null;
      for (let t = 0; t <= horizon; t += stepMs) {
        const sp = propagate(s.elements, simMs + t);
        const dLat = (sp.lat - lat) * 111.2, dLon = (sp.lon - lon) * 111.2 * Math.cos((lat * Math.PI) / 180);
        const inside = Math.sqrt(dLat * dLat + dLon * dLon) <= footprintKm(sp.altKm, 20);
        if (inside && open === null) open = t;
        if (!inside && open !== null) { g.spans.push([open, t]); open = null; }
      }
      if (open !== null) g.spans.push([open, horizon]);
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => {
      const spans = g.spans.sort((a, b) => a[0] - b[0]);
      let maxGap = 0, last = 0;
      for (const [a, b] of spans) { maxGap = Math.max(maxGap, a - last); last = Math.max(last, b); }
      maxGap = Math.max(maxGap, 12 * 3_600_000 - last);
      return { ...g, spans, maxGap };
    });
    // Recompute about every simulated 10 minutes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sats, scenario, Math.floor(simMs / 600_000)]);

  const W = 100;
  return (
    <Console
      title="Orbital Console"
      concept="Space as an enabler: passes, footprints and revisit gaps"
      flush
      tools={
        <>
          <label className="row small"><input type="checkbox" checked={onlyIsr} onChange={(e) => setOnlyIsr(e.target.checked)} /> ISR only</label>
          <span className="muted">{sats.filter((s) => s.alive).length} satellites · {debris.length} debris fields</span>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div ref={ref} style={{ flex: 1, minHeight: 160, position: "relative" }} aria-label="3D Earth with satellites" />
        <div style={{ padding: "6px 10px", borderTop: "1px solid var(--line)", maxHeight: "45%", overflow: "auto" }}>
          <div className="section-title">ISR passes over the theater center · next 12 h from {simTime(simMs)} {view !== "WHITE" ? "(space catalogue is public)" : ""}</div>
          {passes.length === 0 && <div className="dim">No imaging satellites.</div>}
          {passes.map((p) => (
            <div key={p.label} className="row" style={{ marginBottom: 3 }}>
              <div style={{ width: 190, fontSize: 11 }} className={p.faction === "BLUE" ? "badge-blue" : "badge-red"}>{p.label}</div>
              <svg viewBox={`0 0 ${W} 6`} preserveAspectRatio="none" style={{ flex: 1, height: 12, background: "var(--line)", borderRadius: 3 }} role="img" aria-label={`passes for ${p.label}`}>
                {p.spans.map(([a, b], i) => <rect key={i} x={(a / (12 * 3_600_000)) * W} width={Math.max(0.4, ((b - a) / (12 * 3_600_000)) * W)} y={0} height={6} fill={FACTION_COLORS[p.faction as "BLUE"]} />)}
              </svg>
              <div style={{ width: 92, fontSize: 11, textAlign: "right" }} className={p.maxGap > 4 * 3_600_000 ? "badge-red" : "muted"} title="Longest revisit gap">gap {(p.maxGap / 3_600_000).toFixed(1)} h</div>
            </div>
          ))}
        </div>
      </div>
    </Console>
  );
}
