import type { EventView } from "@sentinel/protocol";

/** FNV-1a over the canonical JSON of an event log: equal hashes mean byte-identical logs. */
export function hashEvents(events: EventView[]): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const s = JSON.stringify(events);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + ":" + s.length;
}
