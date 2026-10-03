import { z } from "zod";
import { ROE_LEVELS, TASKS, ROLES } from "./core";

/** One order as produced by an agent (LLM or rules) or a human seat. */
export const OrderSchema = z.object({
  type: z.enum(["OPORD", "FRAGO", "ATO", "STO", "ROE", "ESCALATE", "DEESCALATE", "PRIORITY"]),
  /** A unit id, a unit group (e.g. "blue.air.*") or a role agent id. */
  to: z.string().min(1).max(64),
  task: z.enum(TASKS).optional(),
  area_h3: z.string().max(20).optional(),
  /** Alternative to area_h3: a point, used by the console's order form. */
  point: z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]).optional(),
  target: z.string().max(64).optional(),
  window_sim_h: z.tuple([z.number(), z.number()]).optional(),
  roe: z.enum(ROE_LEVELS).optional(),
  note: z.string().max(200).optional(),
});
export type Order = z.infer<typeof OrderSchema>;

export const OrderBatchSchema = z.object({
  orders: z.array(OrderSchema).max(24),
  rationale: z.string().min(1).max(600),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type OrderBatch = z.infer<typeof OrderBatchSchema>;

export type DecisionSource = "LLM" | "RULES" | "HUMAN" | "CACHE";

export interface Decision extends OrderBatch {
  id: string;
  agent: string;
  role: (typeof ROLES)[number];
  faction: string;
  simMs: number;
  source: DecisionSource;
  model?: string;
  neurons?: number;
  budgetLeft?: number;
  /** COAs considered (J5) — shown in the Agent Reasoning Console. */
  coas?: { name: string; score: number; summary: string }[];
}

/** JSON schema for Workers AI `response_format`, kept in sync with OrderBatchSchema by hand (small and stable). */
export const ORDER_BATCH_JSON_SCHEMA = {
  type: "object",
  properties: {
    orders: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["OPORD", "FRAGO", "ATO", "STO", "ROE", "ESCALATE", "DEESCALATE", "PRIORITY"] },
          to: { type: "string" },
          task: { type: "string", enum: [...TASKS] },
          area_h3: { type: "string" },
          target: { type: "string" },
          window_sim_h: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
          roe: { type: "string", enum: [...ROE_LEVELS] },
        },
        required: ["type", "to"],
      },
    },
    rationale: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["orders", "rationale"],
} as const;

/** Pulls the first JSON object out of a model response (string, object or {response}). */
export function extractJson(res: unknown): unknown {
  if (res && typeof res === "object") {
    const r = res as Record<string, unknown>;
    if ("orders" in r) return r;
    if (typeof r.response === "object" && r.response) return r.response;
    if (typeof r.response === "string") return extractJson(r.response);
    const choices = r.choices as { message?: { content?: string } }[] | undefined;
    if (choices?.[0]?.message?.content) return extractJson(choices[0].message.content);
    // Responses-API style output (e.g. gpt-oss): find the first output_text.
    if (typeof r.output_text === "string") return extractJson(r.output_text);
    const output = r.output as { type?: string; content?: { type?: string; text?: string }[] }[] | undefined;
    if (Array.isArray(output)) {
      for (const o of output) for (const c of o.content ?? []) if (c.text && c.text.includes("{")) return extractJson(c.text);
    }
    return null;
  }
  if (typeof res !== "string") return null;
  const start = res.indexOf("{");
  const end = res.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(res.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Lenient parse of model output: normalizes common slips (a task used as the order type, missing
 * rationale) and keeps every individually valid order instead of rejecting the whole batch.
 */
export function parseOrderBatchLenient(raw: unknown): { batch: OrderBatch; dropped: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { orders?: unknown; rationale?: unknown; confidence?: unknown };
  const list = Array.isArray(r.orders) ? r.orders : [];
  const orders: Order[] = [];
  let dropped = 0;
  for (const o of list.slice(0, 24)) {
    const x = { ...(o as Record<string, unknown>) };
    if (typeof x.type === "string" && (TASKS as readonly string[]).includes(x.type)) {
      x.task = x.task ?? x.type;
      x.type = "FRAGO";
    }
    if (typeof x.target === "string" && x.target.length > 64) x.target = x.target.slice(0, 64);
    if (x.point && !Array.isArray(x.point)) delete x.point;
    for (const k of Object.keys(x)) if (x[k] === null || x[k] === "") delete x[k];
    const p = OrderSchema.safeParse(x);
    if (p.success) orders.push(p.data);
    else dropped++;
  }
  const rationale = typeof r.rationale === "string" && r.rationale.trim() ? r.rationale.slice(0, 600) : null;
  if (!rationale && !orders.length) return null;
  const confidence = typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1 ? r.confidence : 0.5;
  return { batch: { orders, rationale: rationale ?? "No rationale given.", confidence }, dropped };
}
