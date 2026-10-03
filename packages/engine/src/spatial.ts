// One-degree bucket index for candidate pre-filtering (sensor–target pairs, contact checks).
import { cos, DEG } from "./dmath";
import type { Entity } from "./types";

const key = (la: number, lo: number) => ((la + 90) * 361 + (((lo % 360) + 360) % 360)) | 0;

export class SpatialIndex {
  private buckets = new Map<number, Entity[]>();

  rebuild(entities: Entity[]) {
    this.buckets.clear();
    for (const e of entities) {
      if (e.destroyed || e.domain === "SPACE") continue;
      const k = key(Math.floor(e.lat), Math.floor(e.lon));
      let b = this.buckets.get(k);
      if (!b) this.buckets.set(k, (b = []));
      b.push(e);
    }
  }

  /** Entities in buckets overlapping a radius (km) around a point, in deterministic insertion order. */
  near(lat: number, lon: number, radiusKm: number, out: Entity[] = []): Entity[] {
    const dLat = Math.ceil(radiusKm / 111) + 0;
    const c = cos(Math.min(85, Math.abs(lat)) * DEG);
    const dLon = Math.min(179,Math.ceil(radiusKm / (111 * Math.max(0.05, c))));
    const la0 = Math.floor(lat), lo0 = Math.floor(lon);
    for (let la = Math.max(-90, la0 - dLat); la <= Math.min(89, la0 + dLat); la++) {
      for (let lo = lo0 - dLon; lo <= lo0 + dLon; lo++) {
        const b = this.buckets.get(key(la, lo));
        if (b) for (const e of b) out.push(e);
      }
    }
    return out;
  }
}
