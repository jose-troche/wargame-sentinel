// Cloudflare Turnstile widget (managed mode). Tokens are single-use: verified server-side by the
// Worker's siteverify call on POST /api/sessions, then the widget is reset for the next attempt.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface TurnstileHandle { reset(): void }

export const Turnstile = forwardRef<TurnstileHandle, { siteKey: string; onToken: (token: string | null) => void }>(function Turnstile({ siteKey, onToken }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const id = useRef<string | undefined>(undefined);
  const cb = useRef(onToken);
  cb.current = onToken;
  useImperativeHandle(ref, () => ({ reset: () => { cb.current(null); if (id.current) window.turnstile?.reset(id.current); } }), []);
  useEffect(() => {
    let cancelled = false;
    loadScript().then(() => {
      if (cancelled || !el.current || !window.turnstile) return;
      id.current = window.turnstile.render(el.current, {
        sitekey: siteKey,
        action: "turnstile-spin-v1",
        theme: "auto",
        callback: (t: string) => cb.current(t),
        "expired-callback": () => cb.current(null),
        "error-callback": () => cb.current(null),
      });
    }).catch(() => cb.current(null));
    return () => {
      cancelled = true;
      if (id.current) window.turnstile?.remove(id.current);
    };
  }, [siteKey]);
  return <div ref={el} className="cf-turnstile" data-action="turnstile-spin-v1" />;
});
