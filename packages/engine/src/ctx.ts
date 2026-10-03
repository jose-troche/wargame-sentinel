import type { EventView, Faction, Scenario, View } from "@sentinel/protocol";
import { getClass, type AssetClass } from "@sentinel/catalog";
import { Rng } from "./rng";
import type { Entity, WorldState } from "./types";
import type { WorldMap } from "./world";
import type { SubPoint } from "./orbit";
import { SpatialIndex } from "./spatial";

/** Transient (non-serialized) context passed through the phases of a tick. */
export class Ctx {
  rng: Rng;
  byId = new Map<string, Entity>();
  /** Entity ids changed since the last view drain. */
  dirty = new Set<string>();
  dirtyChains = new Set<string>();
  c2Dirty = true;
  logisticsDirty = true;
  satPos = new Map<string, SubPoint>();
  index = new SpatialIndex();
  /** Messages created or delivered since the last drain. */
  newMessages: string[] = [];
  satPosMs = -1;
  indexStamp = -1;
  /** Engine-to-agent triggers (unit loss, new threat...) that wake agents early. */
  constructor(public s: WorldState, public scn: Scenario, public map: WorldMap) {
    this.rng = new Rng(s.rng);
    this.rng.draws = s.rngDraws;
    this.reindex();
  }

  reindex() {
    this.byId.clear();
    for (const e of this.s.entities) this.byId.set(e.id, e);
  }

  cls(e: Entity): AssetClass {
    return getClass(e.cls);
  }

  touch(e: Entity) {
    this.dirty.add(e.id);
  }

  nextId(prefix: string): string {
    this.s.nextId += 1;
    return `${prefix}${this.s.nextId}`;
  }

  emit(ev: { type: string; vis: View[]; text: string; entities?: string[]; factors?: EventView["factors"]; causal?: number[]; notable?: boolean }, rngBefore?: number): EventView {
    this.s.eventSeq += 1;
    const out: EventView = {
      seq: this.s.eventSeq,
      simMs: this.s.simMs,
      type: ev.type,
      vis: ev.vis,
      text: ev.text,
    };
    if (ev.entities) out.entities = ev.entities;
    if (ev.factors) out.factors = ev.factors;
    if (ev.causal) out.causal = ev.causal;
    if (rngBefore !== undefined) out.rng = this.rng.draws - rngBefore;
    if (ev.notable) out.notable = true;
    this.s.events.push(out);
    return out;
  }

  /** Visibility list for an event about a faction's own activity. */
  vis(...factions: (Faction | undefined)[]): View[] {
    const v: View[] = ["WHITE"];
    for (const f of factions) if (f && f !== "GREEN" && !v.includes(f)) v.push(f);
    return v;
  }
}
