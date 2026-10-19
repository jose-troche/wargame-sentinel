import { useEffect, useState } from "react";
import type { View } from "@sentinel/protocol";
import { useRoute, navigate } from "./router";
import { Lobby } from "./pages/Lobby";
import { Landing } from "./pages/Landing";
import { useGame, type Opponent } from "./game/store";
import { LEVELS, type Level } from "./game/levels";
import { MonteCarloPage } from "./pages/MonteCarlo";
import { UsagePage } from "./pages/Usage";
import { SessionPage } from "./session/SessionPage";
import { controller } from "./session/controller";
import { api, type CreatedSession } from "./lib/api";
import { getUser, loadTokens } from "./lib/identity";
import { getScenario } from "@sentinel/scenarios";

/** Referee sandbox: ground truth and every view, rules agents on both sides. */
function LocalSession({ scenarioId, seed }: { scenarioId: string; seed: number }) {
  useEffect(() => {
    if (!getScenario(scenarioId)) {
      navigate("/");
      return;
    }
    useGame.getState().configure({ side: null, level: "officer", opponent: "computer" });
    controller.startLocal(scenarioId, seed);
    return () => controller.stop();
  }, [scenarioId, seed]);
  return <SessionPage />;
}

/** A local game as commander of one side against the computer. */
function LocalGame({ scenarioId, search }: { scenarioId: string; search: URLSearchParams }) {
  const side = search.get("side") === "RED" ? "RED" : "BLUE";
  const level = (["recruit", "officer", "commander"].includes(search.get("level") ?? "") ? search.get("level") : "recruit") as Level;
  const seed = Number(search.get("seed")) || 1;
  useEffect(() => {
    if (!getScenario(scenarioId)) {
      navigate("/");
      return;
    }
    useGame.getState().configure({ side, level, opponent: "computer" });
    controller.startLocal(scenarioId, seed, { side, speed: LEVELS[level].speed, opponentPosture: LEVELS[level].opponent });
    return () => controller.stop();
  }, [scenarioId, side, level, seed]);
  return <SessionPage />;
}

function OnlineSession({ id, state, search }: { id: string; state: unknown; search: URLSearchParams }) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let want = (search.get("view") as View | null) ?? undefined;
        let created = (state as CreatedSession | null) ?? loadTokens<CreatedSession>(id);
        // A commander's game: the owner plays the side chosen at creation; a guest plays the side in the invite.
        const game = (created as (CreatedSession & { game?: { side: "BLUE" | "RED"; level: Level; opponent: Opponent } }) | null)?.game;
        const side = game?.side ?? (want === "BLUE" || want === "RED" ? want : null);
        useGame.getState().configure({ side, level: game?.level ?? "officer", opponent: game?.opponent ?? "human" });
        if (game && !want) want = game.side;
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
  const play = path.match(/^\/play\/([a-z0-9-]+)$/);
  if (play) return <LocalGame key={path + search.toString()} scenarioId={play[1]} search={search} />;
  const local = path.match(/^\/local\/([a-z0-9-]+)\/(\d+)$/);
  if (local) return <LocalSession key={path} scenarioId={local[1]} seed={Number(local[2])} />;
  const sess = path.match(/^\/s\/([a-z0-9]{6,16})$/);
  if (sess) return <OnlineSession key={path} id={sess[1]} state={state} search={search} />;
  if (path === "/montecarlo") return <MonteCarloPage />;
  if (path === "/usage") return <UsagePage />;
  if (path === "/lobby") return <Lobby />;
  return <Landing />;
}
