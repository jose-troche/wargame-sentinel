import { agentId, ROLE_INFO, ROLES, type CopForAgents, type Decision, type Faction, type Role } from "@sentinel/protocol";
import { rulePolicy } from "./policies";

export { rulePolicy, POLICIES, type PolicyResult } from "./policies";
export * from "./util";

/** Roles due for a decision this simulated hour: by cadence, or early on event triggers (debounced). */
export function rolesDue(cop: CopForAgents, last: Partial<Record<Role, number>>, humanSeats: Set<string> = new Set()): Role[] {
  const hour = Math.round(cop.simMs / 3_600_000);
  const due: Role[] = [];
  const triggered = cop.triggers.length > 0;
  for (const role of ROLES) {
    if (humanSeats.has(agentId(cop.faction, role))) continue;
    const prev = last[role];
    const cadence = ROLE_INFO[role].cadenceH;
    // Stagger first decisions so each staff cell reports before commanders act.
    const offset = role === "j2" ? 0 : ROLE_INFO[role].tier === "STAFF" ? 1 : role === "nca" ? 0 : 1;
    const byCadence = prev === undefined ? hour >= offset : hour - prev >= cadence;
    const byTrigger = triggered && prev !== undefined && hour - prev >= 1 && ["jfc", "lcc", "mcc", "acc", "nca"].includes(role) && cop.triggers.some((t) => /lost|escalat|hit|contact|ceasefire|warning/.test(t));
    if (byCadence || byTrigger) due.push(role);
  }
  return due;
}

/** In-process rules-only commander for both factions: used by local play, Monte Carlo and tests. */
export class RulesCommander {
  private last: Record<Faction, Partial<Record<Role, number>>> = { BLUE: {}, RED: {}, GREEN: {} };
  private seq = 0;
  constructor(public humanSeats: Set<string> = new Set()) {}

  decide(cop: CopForAgents): Decision[] {
    const out: Decision[] = [];
    const hour = Math.round(cop.simMs / 3_600_000);
    for (const role of rolesDue(cop, this.last[cop.faction], this.humanSeats)) {
      this.last[cop.faction][role] = hour;
      const r = rulePolicy(role, cop);
      out.push({
        ...r, id: `D-${cop.faction[0]}-${++this.seq}`, agent: agentId(cop.faction, role), role, faction: cop.faction, simMs: cop.simMs, source: "RULES",
      });
    }
    return out;
  }
}
