// Console 6 — Maritime Console: task groups, anti-access/area-denial range bubbles, chokepoints and
// submarine probability areas. Shows sea control versus sea denial and layered fleet defense.
import { getClass, hasClass, RANGE_KM } from "@sentinel/catalog";
import { useStore } from "../store";
import { Console, LandShapes, useEntities, useProjection, useResize, useVersion } from "./common";
import { affiliationOf, fillFor, symbolDataUrl, symbolKey } from "../lib/symbols";

const A2AD = new Set(["lrad_bn", "coastal_ashm", "destroyer", "csg", "frigate"]);

function threatRange(cls?: string): number {
  if (!cls || !hasClass(cls)) return 0;
  return Math.max(0, ...getClass(cls).effectors.filter((e) => e.type === "MISSILE_AA" || e.type === "MISSILE_ASHM").map((e) => RANGE_KM[e.range]));
}

export function MaritimeConsole() {
  useVersion();
  const [ref, size] = useResize<HTMLDivElement>();
  const { project, kmToPx } = useProjection(size.w, size.h);
  const view = useStore((s) => s.view);
  const tracks = useStore((s) => s.tracks);
  const scenario = useStore((s) => s.scenario);
  const select = useStore((s) => s.select);
  const selected = useStore((s) => s.selected);
  const sea = useEntities((e) => !e.destroyed && (e.domain === "SEA" || e.cls === "usv" || e.cls === "uuv" || e.cls === "coastal_ashm" || e.cls === "lrad_bn"));

  // Bubbles: own A2AD in faction views from own units, enemy A2AD from identified tracks; White sees all.
  const bubbles: { lat: number; lon: number; km: number; color: string; key: string }[] = [];
  for (const e of sea) if (A2AD.has(e.cls)) bubbles.push({ lat: e.lat, lon: e.lon, km: threatRange(e.cls), color: fillFor(affiliationOf(e.faction, view), e.faction, view), key: e.id });
  if (view !== "WHITE") for (const t of tracks) if (t.believedClass && A2AD.has(t.believedClass)) bubbles.push({ lat: t.lat, lon: t.lon, km: threatRange(t.believedClass), color: fillFor("H", undefined, view), key: t.id });
  const subs = view === "WHITE" ? [] : tracks.filter((t) => t.believedDomain === "SEA" && (t.alt ?? 0) < -20 || t.believedClass === "ssn" || t.believedClass === "ssk");
  const seaTracks = view === "WHITE" ? [] : tracks.filter((t) => t.believedDomain === "SEA" || t.believedClass === "usv");

  return (
    <Console title="Maritime Console" concept="Sea control and denial; layered fleet defense"
      tools={<div className="legend"><span><i style={{ background: "#0072B2", opacity: 0.4 }} />friendly A2/AD</span><span><i style={{ background: "#D55E00", opacity: 0.4 }} />hostile A2/AD</span><span><i style={{ border: "1px dashed var(--accent-2)" }} />sub probability area</span></div>} flush>
      <div ref={ref} style={{ position: "absolute", inset: 0 }}>
        <svg width={size.w} height={size.h} role="img" aria-label="Maritime picture">
          <rect width={size.w} height={size.h} fill="var(--ocean)" />
          <LandShapes project={project} />
          {bubbles.map((b) => { const [x, y] = project(b.lat, b.lon); return <circle key={`b-${b.key}`} cx={x} cy={y} r={kmToPx(b.km)} fill={b.color} fillOpacity={0.07} stroke={b.color} strokeOpacity={0.5} />; })}
          {scenario?.map.chokepoints.map((c) => { const [x, y] = project(c.at[0], c.at[1]); return <g key={c.name}><circle cx={x} cy={y} r={kmToPx(c.radiusKm)} fill="none" stroke="var(--accent-2)" strokeWidth={1.5} strokeDasharray="6 4" /><text x={x} y={y - kmToPx(c.radiusKm) - 4} textAnchor="middle" fontSize={10} fill="var(--accent-2)">{c.name}</text></g>; })}
          {subs.map((t) => { const [x, y] = project(t.lat, t.lon); return <ellipse key={`s-${t.id}`} cx={x} cy={y} rx={Math.max(6, kmToPx(t.ellipse[0]))} ry={Math.max(4, kmToPx(t.ellipse[1]))} fill="var(--accent-2)" fillOpacity={0.08} stroke="var(--accent-2)" strokeDasharray="3 3" />; })}
          {seaTracks.map((t) => {
            const [x, y] = project(t.lat, t.lon);
            const affil = t.affiliation === "HOSTILE" ? "H" : t.affiliation === "NEUTRAL" ? "N" : "U";
            return <image key={`t-${t.id}`} href={symbolDataUrl(symbolKey(affil, t.believedClass ?? "SEA", fillFor(affil, undefined, view)))} x={x - 11} y={y - 11} width={22} height={22} opacity={0.85} onClick={() => select(t.id)} style={{ cursor: "pointer" }} />;
          })}
          {sea.map((e) => {
            const [x, y] = project(e.lat, e.lon);
            const affil = affiliationOf(e.faction, view);
            return (
              <g key={e.id} onClick={() => select(e.id)} style={{ cursor: "pointer" }}>
                <image href={symbolDataUrl(symbolKey(affil, e.cls, fillFor(affil, e.faction, view)))} x={x - 12} y={y - 12} width={24} height={24} opacity={e.alt < -20 ? 0.6 : 1} />
                {selected === e.id && <circle cx={x} cy={y} r={15} fill="none" stroke="var(--accent-2)" strokeWidth={2} />}
              </g>
            );
          })}
        </svg>
      </div>
    </Console>
  );
}
