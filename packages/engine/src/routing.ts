// Route planning: A* over the H3 grid for land (terrain cost) and constrained sea movement.
import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import { distKm, approxDistKm } from "./geo";
import { TERRAIN_MOVE_COST, type WorldMap } from "./world";

const LAND_RES = 5;
const SEA_RES = 4;

class Heap {
  private a: { f: number; s: number; v: string }[] = [];
  private seq = 0;
  get size() {
    return this.a.length;
  }
  push(v: string, f: number) {
    const a = this.a;
    a.push({ f, s: this.seq++, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop(): string {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top.v;
  }
  private less(x: { f: number; s: number }, y: { f: number; s: number }) {
    return x.f < y.f || (x.f === y.f && x.s < y.s);
  }
}

const center = (c: string): [number, number] => {
  const [la, lo] = cellToLatLng(c);
  return [Math.round(la * 1e6) / 1e6, Math.round(lo * 1e6) / 1e6];
};

function astar(
  from: [number, number], to: [number, number], res: number,
  passable: (lat: number, lon: number) => boolean, cost: (lat: number, lon: number) => number, maxNodes: number,
): [number, number][] | null {
  const start = latLngToCell(from[0], from[1], res);
  const goal = latLngToCell(to[0], to[1], res);
  if (start === goal) return [to];
  const g = new Map<string, number>([[start, 0]]);
  const came = new Map<string, string>();
  const open = new Heap();
  open.push(start, 0);
  let expanded = 0;
  while (open.size && expanded < maxNodes) {
    const cur = open.pop();
    if (cur === goal) {
      const path: [number, number][] = [];
      let c: string | undefined = cur;
      while (c && c !== start) {
        path.push(center(c));
        c = came.get(c);
      }
      path.reverse();
      path[path.length - 1] = to;
      return simplify(path);
    }
    expanded++;
    const [cl, co] = center(cur);
    const gc = g.get(cur)!;
    for (const nb of gridDisk(cur, 1)) {
      if (nb === cur) continue;
      const [nl, no] = center(nb);
      if (nb !== goal && !passable(nl, no)) continue;
      const step = approxDistKm(cl, co, nl, no) * cost(nl, no);
      const ng = gc + step;
      const old = g.get(nb);
      if (old === undefined || ng < old) {
        g.set(nb, ng);
        came.set(nb, cur);
        open.push(nb, ng + approxDistKm(nl, no, to[0], to[1]));
      }
    }
  }
  return null;
}

/** Drops collinear-ish intermediate points to keep paths short. */
function simplify(path: [number, number][]): [number, number][] {
  if (path.length <= 2) return path;
  const out: [number, number][] = [];
  for (let i = 0; i < path.length; i += 2) out.push(path[i]);
  if (out[out.length - 1] !== path[path.length - 1]) out.push(path[path.length - 1]);
  return out;
}

function lineClear(map: WorldMap, from: [number, number], to: [number, number], wantLand: boolean): boolean {
  const d = distKm(from[0], from[1], to[0], to[1]);
  const n = Math.min(200, Math.max(2, Math.ceil(d / 12)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const la = from[0] + (to[0] - from[0]) * t;
    const lo = from[1] + (to[1] - from[1]) * t;
    if (map.isLand(la, lo) !== wantLand) return false;
  }
  return true;
}

export function planRoute(map: WorldMap, medium: "LAND" | "SEA" | "AIR" | "SPACE", from: [number, number], to: [number, number], landmass?: string | null): [number, number][] {
  if (medium === "AIR" || medium === "SPACE") return [to];
  if (medium === "SEA") {
    if (map.isLand(to[0], to[1])) {
      // Head for the nearest water short of a land target (e.g. an amphibious objective).
      let found: [number, number] | null = null;
      for (let i = 1; i <= 40 && !found; i++) {
        const t = i / 40;
        const p: [number, number] = [to[0] + (from[0] - to[0]) * t, to[1] + (from[1] - to[1]) * t];
        if (!map.isLand(p[0], p[1])) found = p;
      }
      if (!found) return [from];
      to = found;
    }
    if (lineClear(map, from, to, false)) return [to];
    return astar(from, to, SEA_RES, (la, lo) => !map.isLand(la, lo), () => 1, 3000) ?? [from];
  }
  // LAND: stay on land (and on the same fictional landmass, if any).
  const ok = (la: number, lo: number) => map.isLand(la, lo) && (landmass == null || map.landmassAt(la, lo) === landmass);
  if (!ok(to[0], to[1])) return [from];
  return astar(from, to, LAND_RES, ok, (la, lo) => TERRAIN_MOVE_COST[map.terrainAt(la, lo)], 2500) ?? [from];
}
