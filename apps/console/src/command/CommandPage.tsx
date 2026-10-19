// The command post: map in the middle, staff briefing and actions beside it, the status board and
// the Ask bar below. On phones the map fills the screen and the panels open as bottom sheets.
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useGame, tickGame, canControlTime, type Sheet } from "../game/store";
import { SPEED_PRESETS } from "../game/levels";
import { controller } from "../session/controller";
import { ExplainModal } from "../session/Explain";
import { CommandBar } from "./CommandBar";
import { CommandMap } from "./CommandMap";
import { Briefing } from "./Briefing";
import { Actions } from "./Actions";
import { StatusBoard } from "./StatusBoard";
import { AskBar, AskReply } from "./AskBar";
import { UnitCard } from "./UnitCard";
import { Drawer } from "./Drawer";
import { Intro, Tour } from "./Intro";
import { EndScreen } from "./EndScreen";
import { Icon } from "./Icons";

const useNarrow = () => {
  const q = "(max-width: 860px)";
  const [narrow, setNarrow] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
};

export function CommandPage({ onExpert }: { onExpert: (review?: boolean) => void }) {
  const scenario = useStore((s) => s.scenario)!;
  const side = useGame((s) => s.side)!;
  const sheet = useGame((s) => s.sheet);
  const cards = useGame((s) => s.cards.length);
  const intro = useGame((s) => s.intro);
  const explain = useStore((s) => s.explain);
  const toast = useStore((s) => s.toast);
  const narrow = useNarrow();
  const [panel, setPanel] = useState<"brief" | "actions">("brief");

  // The command-post loop: once a second, and right away when something important changes.
  useEffect(() => {
    tickGame();
    const id = setInterval(tickGame, 1000);
    return () => clearInterval(id);
  }, []);

  // First visit: the introduction.
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem("ws.intro") === "1"; } catch { /* storage unavailable */ }
    if (!seen) useGame.setState({ intro: true });
  }, []);

  // A recruit's decision cards open the briefing sheet on phones.
  useEffect(() => {
    if (narrow && cards > 0 && useGame.getState().pausedFor) useGame.setState({ sheet: "brief" });
  }, [cards, narrow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const st = useStore.getState();
      if (e.key === "Escape") {
        if (st.pick) st.set({ pick: null });
        else if (useGame.getState().reply) useGame.setState({ reply: null });
        else if (useGame.getState().sheet) useGame.setState({ sheet: null });
        else st.select(null);
        st.set({ explain: null });
        return;
      }
      if (e.key === "?") return useGame.setState({ tour: 0 });
      if (e.key === "c" || e.key === "C") return document.querySelector<HTMLButtonElement>(".map-btn.recenter")?.click();
      if (e.key === "m" || e.key === "M") return window.dispatchEvent(new Event("ws:listen"));
      if (!canControlTime()) return;
      if (e.key === " ") {
        e.preventDefault();
        controller.play(!st.playing);
      }
      const n = Number(e.key);
      if (n >= 1 && n <= SPEED_PRESETS.length) controller.setSpeed(SPEED_PRESETS[n - 1].speed);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sheetH = typeof window !== "undefined" ? Math.round(window.innerHeight * 0.62) - 54 : 0;
  const pad = narrow ? { top: 40, bottom: sheet ? sheetH : 40, left: 20, right: 50 } : { top: 50, bottom: 40, left: 40, right: 60 };
  const tab = (s: Exclude<Sheet, null>) => useGame.setState({ sheet: sheet === s ? null : s });

  return (
    <div className={`cpost side-${side.toLowerCase()}${narrow ? " narrow" : ""}`}>
      <CommandBar onExpert={() => onExpert()} />
      <main className="cpost-map">
        <CommandMap variant="command" scenario={scenario} side={side} padding={pad} />
        <UnitCard />
        {!narrow && <AskReply />}
      </main>
      {!narrow && (
        <>
          <aside className="cpost-side">
            <div className="segmented side-tabs" role="tablist">
              <button role="tab" aria-selected={panel === "brief"} className={panel === "brief" ? "on" : ""} onClick={() => setPanel("brief")}>Briefing{cards > 0 && <span className="badge">{cards}</span>}</button>
              <button role="tab" aria-selected={panel === "actions"} className={panel === "actions" ? "on" : ""} onClick={() => setPanel("actions")}>Actions</button>
            </div>
            <div className="side-body">{panel === "brief" ? <Briefing /> : <Actions />}</div>
          </aside>
          <div className="cpost-status"><StatusBoard /></div>
          <div className="cpost-ask"><AskBar /></div>
        </>
      )}
      {narrow && (
        <>
          {sheet && (
            <div className="sheet" role="dialog" aria-label={sheet}>
              <div className="sheet-head"><span className="grow" /><button className="ghost" onClick={() => useGame.setState({ sheet: null })} aria-label="Close"><Icon name="down" /></button></div>
              <div className="sheet-body">
                {sheet === "brief" && <Briefing limit={8} />}
                {sheet === "status" && <StatusBoard compact />}
                {sheet === "actions" && <Actions />}
                {sheet === "ask" && <AskBar autoFocus inlineReply />}
              </div>
            </div>
          )}
          <nav className="tabbar" aria-label="Panels">
            <button className={sheet === "brief" ? "on" : ""} onClick={() => tab("brief")}><Icon name="list" />Briefing{cards > 0 && <span className="badge">{cards}</span>}</button>
            <button className={sheet === "status" ? "on" : ""} onClick={() => tab("status")}><Icon name="gauge" />Status</button>
            <button className={sheet === "actions" ? "on" : ""} onClick={() => tab("actions")}><Icon name="bolt" />Actions</button>
            <button className={sheet === "ask" ? "on" : ""} onClick={() => tab("ask")}><Icon name="chat" />Ask</button>
          </nav>
        </>
      )}
      <Drawer />
      {toast && <div className={`toast${toast.bad ? " bad" : ""}`} role="status">{toast.text}</div>}
      {explain && <ExplainModal />}
      {intro && <Intro />}
      <Tour />
      <EndScreen onReview={() => onExpert(true)} />
    </div>
  );
}
