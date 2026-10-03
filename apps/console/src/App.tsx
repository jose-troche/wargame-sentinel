import { useEffect, useState } from "react";
import type { View } from "@sentinel/protocol";
import { useRoute, navigate } from "./router";
import { Lobby } from "./pages/Lobby";
import { MonteCarloPage } from "./pages/MonteCarlo";
import { UsagePage } from "./pages/Usage";
import { SessionPage } from "./session/SessionPage";
import { controller } from "./session/controller";
import { api, type CreatedSession } from "./lib/api";
import { getUser, loadTokens } from "./lib/identity";
import { getScenario } from "@sentinel/scenarios";

function LocalSession({ scenarioId, seed }: { scenarioId: string; seed: number }) {
  useEffect(() => {
    if (!getScenario(scenarioId)) {
      navigate("/");
      return;
    }
    controller.startLocal(scenarioId, seed);
    return () => controller.stop();
  }, [scenarioId, seed]);
  return <SessionPage />;
}

function OnlineSession({ id, state, search }: { id: string; state: unknown; search: URLSearchParams }) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const want = (search.get("view") as View | null) ?? undefined;
        let created = (state as CreatedSession | null) ?? loadTokens<CreatedSession>(id);
        const user = getUser();
        if (created && want && !created.tokens[want]) created = null;
        if (!created) {
          const { session } = await api.session(id);
          const view: View = session.owner === user.id ? "WHITE" : want ?? "BLUE";
          created = await api.join(id, view, user, search.get("code") ?? undefined);
          if (session.owner === user.id) created = { ...created, joinCode: loadTokens<CreatedSession>(id)?.joinCode };
        } else {
          const { session } = await api.session(id);
          created = { ...created, session };
        }
        if (cancelled) return;
        controller.startOnline(created, want);
        setReady(true);
      } catch (e) {
        setError(String((e as Error).message));
      }
    })();
    return () => {
      cancelled = true;
      controller.stop();
    };
  }, [id]);
  if (error) {
    return (
      <div className="lobby">
        <div className="card">
          <h3>Could not open session {id}</h3>
          <p className="muted">{error}</p>
          <button onClick={() => navigate("/")}>Back to lobby</button>
        </div>
      </div>
    );
  }
  return ready ? <SessionPage /> : <div className="empty">Connecting to session {id}…</div>;
}

export function App() {
  const { path, state, search } = useRoute();
  const local = path.match(/^\/local\/([a-z0-9-]+)\/(\d+)$/);
  if (local) return <LocalSession key={path} scenarioId={local[1]} seed={Number(local[2])} />;
  const sess = path.match(/^\/s\/([a-z0-9]{6,16})$/);
  if (sess) return <OnlineSession key={path} id={sess[1]} state={state} search={search} />;
  if (path === "/montecarlo") return <MonteCarloPage />;
  if (path === "/usage") return <UsagePage />;
  return <Lobby />;
}
