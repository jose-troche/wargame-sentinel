// Turns a commander's choice (a decision option, a play, an intent, a direct order) into one order
// batch from the commander's seat. It then goes through the same path as every agent order: the C2
// network, authority checks and applyOrderBatch.
import type { Order, Roe } from "@sentinel/protocol";
import { buildPlay, PLAYS } from "@sentinel/agents-rules";
import { useStore } from "../store";
import { controller } from "../session/controller";
import { copFromView } from "./cop";
import type { Action, Side } from "./types";

export const commanderSeat = (side: Side) => `${side.toLowerCase()}.nca`;

const ROE_FOR: Record<string, Roe> = { AGGRESSIVE: "WEAPONS_FREE", BALANCED: "WEAPONS_TIGHT", DEFENSIVE: "WEAPONS_TIGHT" };

/** Orders for an action, or a plain reason it cannot be done. */
export function ordersFor(action: Action, side: Side): { orders: Order[]; rationale: string } | { reason: string } | null {
  const f = side.toLowerCase();
  const st = useStore.getState();
  switch (action.kind) {
    case "none":
      return null;
    case "play": {
      const r = buildPlay(action.play, copFromView(side, st), action.objective, action.target);
      return r.ok ? { orders: r.orders, rationale: `${PLAYS[action.play].title}: ${r.rationale}` } : { reason: r.reason ?? "Nothing could be ordered." };
    }
    case "intent": {
      const orders: Order[] = [{ type: "INTENT", to: `${f}.jfc`, posture: action.posture, objective: action.objective }];
      if (action.posture) orders.push({ type: "ROE", to: `${f}.jfc`, roe: ROE_FOR[action.posture] });
      return { orders, rationale: `Commander's intent${action.posture ? `: ${action.posture.toLowerCase()} posture` : ""}${action.objective ? `, main effort ${action.objective}` : ""}.` };
    }
    case "escalate": {
      const n = Math.abs(action.steps);
      const type = action.steps > 0 ? "ESCALATE" : "DEESCALATE";
      return { orders: Array.from({ length: n }, () => ({ type, to: `${f}.nca` }) as Order), rationale: `${action.steps > 0 ? "Escalate" : "De-escalate"} ${n} rung${n === 1 ? "" : "s"}.` };
    }
    case "orders":
      return { orders: action.orders, rationale: action.rationale };
    case "multi": {
      const parts = action.actions.map((a) => ordersFor(a, side));
      const bad = parts.find((p): p is { reason: string } => !!p && "reason" in p);
      if (bad) return bad;
      const ok = parts.filter((p): p is { orders: Order[]; rationale: string } => !!p && "orders" in p);
      return ok.length ? { orders: ok.flatMap((p) => p.orders).slice(0, 24), rationale: ok.map((p) => p.rationale).join(" ") } : null;
    }
  }
}

/** Executes an action from the commander's seat. Returns what to tell the player. */
export function execute(action: Action, side: Side): { ok: boolean; text: string } {
  const r = ordersFor(action, side);
  if (!r) return { ok: true, text: "No orders issued; the staff keep the current plan." };
  if ("reason" in r) return { ok: false, text: r.reason };
  controller.order(commanderSeat(side), { orders: r.orders, rationale: r.rationale, confidence: 0.75 });
  const units = new Set(r.orders.filter((o) => !o.to.includes(".")).map((o) => o.to)).size;
  return { ok: true, text: `${r.rationale}${units ? ` ${units} unit${units === 1 ? "" : "s"} ordered; orders travel over the network before they take effect.` : ""}` };
}
