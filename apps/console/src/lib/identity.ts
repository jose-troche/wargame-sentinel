// Anonymous per-browser identity (id + display name). Stored locally only as a convenience.
export interface User { id: string; name: string }

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
}

export function getUser(): User {
  let id = safeGet("ws.user.id");
  if (!id) {
    id = `u-${crypto.getRandomValues(new Uint32Array(2)).join("").slice(0, 14)}`;
    safeSet("ws.user.id", id);
  }
  return { id, name: safeGet("ws.user.name") ?? "Player" };
}
export function setUserName(name: string) {
  safeSet("ws.user.name", name.slice(0, 40));
}

export function saveTokens(sid: string, data: unknown) {
  safeSet(`ws.session.${sid}`, JSON.stringify(data));
}
export function loadTokens<T>(sid: string): T | null {
  const v = safeGet(`ws.session.${sid}`);
  if (!v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}
