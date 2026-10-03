import type { ControlFrame, OrderBatch, ScenarioSummary, SessionMeta, View } from "@sentinel/protocol";
import type { User } from "./identity";

export interface CreatedSession { session: SessionMeta; tokens: Partial<Record<View, string>>; joinCode?: string; grant?: number }

async function req<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  scenarios: () => req<{ scenarios: ScenarioSummary[] }>("/api/scenarios"),
  config: () => req<{ turnstileSiteKey: string | null; archive: string; models: Record<string, string> }>("/api/config"),
  usage: () => req<{ day: string; neurons: number; dailyLimit: number; doRequests: number; sessions: number; llmCalls: number; grants: { session: string; granted: number; used: number }[] }>("/api/admin/usage"),
  createSession: (body: { scenarioId: string; profile: "A" | "B"; seed?: number; rulesOnly: boolean; user: User; turnstile?: string }) =>
    req<CreatedSession>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),
  sessions: (owner?: string) => req<{ sessions: { id: string; scenario_id: string; owner_name: string; profile: string; status: string; created_at: number; parent: string | null }[] }>(`/api/sessions${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`),
  session: (id: string) => req<{ session: SessionMeta }>(`/api/sessions/${id}`),
  join: (id: string, view: View, user: User, code?: string) => req<CreatedSession>(`/api/sessions/${id}/join`, { method: "POST", body: JSON.stringify({ view, user, code }) }),
  control: (id: string, token: string, frame: Omit<ControlFrame, "t">) => req<{ ok: boolean; error?: string }>(`/api/sessions/${id}/control`, { method: "POST", body: JSON.stringify(frame) }, token),
  order: (id: string, token: string, seat: string, batch: OrderBatch) => req<{ ok: boolean; error?: string }>(`/api/sessions/${id}/orders`, { method: "POST", body: JSON.stringify({ seat, batch }) }, token),
  seat: (id: string, token: string, agentId: string, take: boolean) => req<{ ok: boolean; error?: string }>(`/api/sessions/${id}/seats/${agentId}`, { method: "POST", body: JSON.stringify({ take }) }, token),
  aar: (id: string, token: string) => req<{ report: unknown; narrative: unknown }>(`/api/sessions/${id}/aar`, {}, token),
  events: (id: string, token: string, from: number) => req<{ events: unknown[]; lastSeq: number }>(`/api/sessions/${id}/events?from=${from}`, {}, token),
  audit: (id: string, token: string, faction: string) => req<{ log: { id: string; role: string; sim_ms: number; model: string; prompt: string; response: string; neurons: number; source: string }[] }>(`/api/sessions/${id}/audit?faction=${faction}`, {}, token),
  branch: (id: string, token: string, tick: number) => req<CreatedSession>(`/api/sessions/${id}/branch`, { method: "POST", body: JSON.stringify({ tick }) }, token),
  montecarlo: () => req<{ runs: { id: string; scenario_id: string; seeds: number; created_at: number; summary: unknown }[] }>("/api/montecarlo"),
  uploadMontecarlo: (body: { scenarioId: string; seeds: number; summary: unknown; user: User }) => req<{ id: string }>("/api/montecarlo", { method: "POST", body: JSON.stringify(body) }),
};
