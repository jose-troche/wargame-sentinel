import type { Domain, Role } from "@sentinel/protocol";
import { getClass } from "./catalog";

/** Which units a role may task. Shared by the engine (order validation) and agents (prompting). */
export function roleCanCommand(role: Role | "human", u: { domain: Domain; cls: string }): boolean {
  if (role === "human" || role === "jfc" || role === "nca") return true;
  const c = getClass(u.cls);
  switch (role) {
    case "lcc": return u.domain === "LAND" && !c.tags.includes("JAMMER") && u.cls !== "cyber_unit" && u.cls !== "decoy_group" || u.cls === "ugv";
    case "mcc": return u.domain === "SEA" || u.cls === "usv" || u.cls === "uuv";
    case "acc": return u.domain === "AIR" || (u.domain === "DRONE" && !["usv", "uuv", "ugv"].includes(u.cls));
    case "scc": return u.domain === "SPACE";
    case "cyber": return c.tags.includes("JAMMER") || u.cls === "cyber_unit" || u.cls === "decoy_group";
    default: return false;
  }
}
