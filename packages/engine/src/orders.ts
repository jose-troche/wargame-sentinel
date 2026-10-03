// Order intake: validates an order batch against the sender's role and turns each order into
// a C2 message that reaches its unit only after network latency (or is held if unreachable).
import { HOUR_MS, parseAgentId, ROLE_INFO, type Faction, type Order, type Role } from "@sentinel/protocol";
import { roleCanCommand } from "@sentinel/catalog";
import type { Ctx } from "./ctx";
import { sendOrder } from "./c2";
import { resolvePoint } from "./tactical";
import { setEscalation } from "./politics";
import type { Entity, PendingOrder, TaskState } from "./types";

function resolveUnits(ctx: Ctx, faction: Faction, to: string): Entity[] {
  if (to.startsWith("cls:")) {
    const cls = to.slice(4);
    return ctx.s.entities.filter((e) => e.faction === faction && !e.destroyed && e.cls === cls);
  }
  const e = ctx.byId.get(to) ?? ctx.s.entities.find((x) => x.callsign === to && x.faction === faction);
  return e && e.faction === faction && !e.destroyed ? [e] : [];
}

export function applyOrderBatch(ctx: Ctx, p: PendingOrder): { applied: number; rejected: string[] } {
  const fs = ctx.s.factions[p.faction];
  const parsed = parseAgentId(p.from);
  const role: Role | "human" = p.source === "HUMAN" && !parsed ? "human" : parsed?.role ?? "human";
  const rejected: string[] = [];
  let applied = 0;
  const corr = ctx.nextId(`${p.from}.`);
  for (const o of p.batch.orders as Order[]) {
    switch (o.type) {
      case "ROE":
        if (o.roe && (role === "nca" || role === "jfc" || role === "human")) {
          if (fs.roe !== o.roe) {
            fs.roe = o.roe;
            ctx.emit({ type: "ROE", vis: ctx.vis(p.faction), text: `${p.faction} ROE set to ${o.roe} by ${p.from}` });
          }
          applied++;
        } else rejected.push(`${o.type}: not permitted for ${role}`);
        continue;
      case "ESCALATE":
      case "DEESCALATE":
        if (role === "nca" || role === "human") {
          setEscalation(ctx, p.faction, fs.escalation + (o.type === "ESCALATE" ? 1 : -1), p.from);
          applied++;
        } else rejected.push(`${o.type}: only the NCA may change escalation`);
        continue;
      case "PRIORITY":
        fs.priority = o.note ?? o.task ?? o.to;
        applied++;
        continue;
    }
    if (parseAgentId(o.to)) {
      applied++; // coordination with a subordinate commander: recorded in the trace only
      continue;
    }
    const units = resolveUnits(ctx, p.faction, o.to);
    if (!units.length) {
      rejected.push(`${o.to}: unknown or destroyed unit`);
      continue;
    }
    for (const u of units.slice(0, 24)) {
      if (!roleCanCommand(role, u)) {
        rejected.push(`${u.id}: outside ${role} authority`);
        continue;
      }
      const task: TaskState = { kind: o.task ?? "HOLD", issuedMs: ctx.s.simMs, target: o.target };
      const pt = resolvePoint({ kind: task.kind, issuedMs: 0, point: o.point }, o.area_h3);
      if (pt) task.point = pt;
      if (o.window_sim_h) task.window = [Math.round(o.window_sim_h[0] * HOUR_MS), Math.round(o.window_sim_h[1] * HOUR_MS)];
      sendOrder(ctx, p.faction, p.from, u, o.type, task, { rationale: p.batch.rationale, correlation: corr, roe: o.roe, priority: o.type === "FRAGO" ? "IMMEDIATE" : "PRIORITY" });
      applied++;
    }
  }
  ctx.emit({
    type: "ORDER", vis: ctx.vis(p.faction),
    text: `${p.from} [${p.source}] issued ${applied} order(s)${rejected.length ? `, ${rejected.length} rejected` : ""}: ${p.batch.rationale.slice(0, 140)}`,
    factors: { applied, rejected: rejected.length, source: p.source, role: ROLE_INFO[role as Role]?.title ?? "Human" },
  });
  return { applied, rejected };
}
