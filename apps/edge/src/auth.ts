// Signed join tokens (HMAC-SHA256 via Web Crypto) and optional Turnstile verification.
import type { JoinClaims } from "@sentinel/protocol";

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signToken(claims: JoinClaims, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifyToken(token: string | null | undefined, secret: string): Promise<JoinClaims | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig), enc.encode(body));
  if (!ok) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as JoinClaims;
    if (claims.exp < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return new URL(req.url).searchParams.get("t");
}

/** Turnstile is enforced only when a secret is configured (see README). */
export async function checkTurnstile(env: Env, token: string | undefined, ip: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = (await res.json()) as { success: boolean };
  return data.success;
}

export function randomId(len = 10): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
