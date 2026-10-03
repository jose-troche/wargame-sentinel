// Coalesces several per-view deltas into one (the host sends at most one DELTA per wall second).
import type { ViewDelta } from "@sentinel/protocol";

export function mergeDelta(a: ViewDelta | undefined, b: ViewDelta): ViewDelta {
  if (!a || b.full) return b;
  const out: ViewDelta = { ...a, ...b, view: b.view, tick: b.tick, simMs: b.simMs };
  if (a.entities || b.entities) {
    const m = new Map((a.entities ?? []).map((e) => [e.id, e]));
    for (const e of b.entities ?? []) m.set(e.id, e);
    out.entities = [...m.values()];
  }
  if (a.removed || b.removed) out.removed = [...(a.removed ?? []), ...(b.removed ?? [])];
  if (a.chains || b.chains) {
    const m = new Map((a.chains ?? []).map((c) => [c.id, c]));
    for (const c of b.chains ?? []) m.set(c.id, c);
    out.chains = [...m.values()];
  }
  if (a.events || b.events) out.events = [...(a.events ?? []), ...(b.events ?? [])];
  if (a.messages || b.messages) {
    const m = new Map((a.messages ?? []).map((x) => [x.id, x]));
    for (const x of b.messages ?? []) m.set(x.id, x);
    out.messages = [...m.values()];
  }
  // A full snapshot stays full after newer changes are folded into it.
  out.full = a.full;
  return out;
}
