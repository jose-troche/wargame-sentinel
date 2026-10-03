// Minimal history router: paths are served by the Worker's SPA fallback.
import { useEffect, useState } from "react";

const listeners = new Set<() => void>();

export function navigate(path: string, state?: unknown) {
  history.pushState(state ?? null, "", path);
  for (const l of listeners) l();
}

export function useRoute() {
  const [loc, setLoc] = useState({ path: location.pathname, search: new URLSearchParams(location.search), state: history.state as unknown });
  useEffect(() => {
    const update = () => setLoc({ path: location.pathname, search: new URLSearchParams(location.search), state: history.state });
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return loc;
}
