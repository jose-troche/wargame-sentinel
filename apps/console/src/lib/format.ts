import { fmtSimTime } from "@sentinel/protocol";
import { getClass, hasClass } from "@sentinel/catalog";

export const simTime = fmtSimTime;
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const minutes = (ms: number) => `${Math.round(ms / 60000)} min`;
export const clsName = (id?: string) => (id && hasClass(id) ? getClass(id).name : id ?? "unknown");
export function dur(ms: number) {
  if (ms < 3_600_000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
