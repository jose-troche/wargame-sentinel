// "Ask your staff": type or speak a question or an order. Answers appear in a bubble above the bar;
// orders that change the game wait for a confirm click.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { useGame, stepSpeed, canControlTime } from "../game/store";
import { answer, SUGGESTIONS, type Reply } from "../game/ask";
import { execute } from "../game/actions";
import { canListen, listen, speak } from "../game/voice";
import { controller } from "../session/controller";
import { Icon, SeverityIcon } from "./Icons";

/** The answer bubble. On desktop it floats over the map; on phones it sits above the input. */
export function AskReply() {
  const reply = useGame((s) => s.reply);
  if (!reply) return null;
  const confirm = () => {
    const g = useGame.getState();
    if (!reply.action || !g.side) return;
    const res = execute(reply.action.action, g.side);
    useStore.getState().notify(res.text, !res.ok);
    g.logEntry(`You ordered: ${reply.action.label}. ${res.ok ? "" : res.text}`.trim(), res.ok ? "info" : "warning");
    useGame.setState({ reply: null });
  };
  return (
    <div className={`reply tone-${reply.tone ?? "info"}`} role="status" aria-live="polite">
      <div className="reply-q">“{reply.q}”</div>
      <div className="reply-a">{reply.tone && reply.tone !== "info" && <SeverityIcon s={reply.tone} size={14} />} {reply.text}</div>
      {reply.bullets && <ul>{reply.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
      <div className="row wrap">
        {reply.action && <button className="primary small" onClick={confirm}><Icon name="arrow" size={12} /> {reply.action.label}</button>}
        {reply.drill && <button className="small" onClick={() => useGame.setState({ drawer: reply.drill!, sheet: null })}>Details</button>}
        <span className="grow" />
        <button className="ghost small" onClick={() => useGame.setState({ reply: null })} aria-label="Dismiss answer"><Icon name="close" size={12} /></button>
      </div>
    </div>
  );
}

export function AskBar({ autoFocus, inlineReply }: { autoFocus?: boolean; inlineReply?: boolean }) {
  const [q, setQ] = useState("");
  const [listening, setListening] = useState(false);
  const [focused, setFocused] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const reply = useGame((s) => s.reply);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement)?.closest("input, textarea, select")) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("ws:listen", toggleMic as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("ws:listen", toggleMic as EventListener);
    };
  });
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);

  const ask = (text: string) => {
    const g = useGame.getState();
    const st = useStore.getState();
    if (!g.side || !st.scenario) return;
    const c2 = st.c2.find((c) => c.faction === g.side);
    const r = answer(text, { side: g.side, scenario: st.scenario, simMs: st.simMs, tick: st.tick, entities: st.entities, tracks: st.tracks, politics: st.politics, brief: g.brief, cards: g.cards, unreachable: c2?.unreachable ?? [] });
    apply(r);
    useGame.setState({ reply: { ...r, q: text } });
    if (g.voice) speak(r.text);
    setQ("");
  };

  const apply = (r: Reply) => {
    if (r.control) {
      if (!canControlTime()) useStore.getState().notify("Only the host controls time in this game.", true);
      else if (r.control === "pause") controller.play(false);
      else if (r.control === "play") controller.play(true);
      else stepSpeed(r.control === "faster" ? 1 : -1);
    }
    if (r.focus) useGame.getState().focusOn(r.focus.center, r.focus.zoom);
    if (r.select) useStore.getState().select(r.select);
  };

  function toggleMic() {
    if (listening) {
      stop.current?.();
      return;
    }
    setListening(true);
    stop.current = listen(
      (t) => setQ(t),
      (t) => ask(t),
      (err) => {
        setListening(false);
        stop.current = null;
        if (err) useStore.getState().notify(err, true);
      },
    );
  }

  return (
    <div className="askbar" data-tour="ask">
      {inlineReply && <AskReply />}
      {focused && !q && !reply && (
        <div className="suggestions" role="listbox" aria-label="Suggestions">
          {SUGGESTIONS.map((s) => <button key={s} className="chip" onMouseDown={(e) => { e.preventDefault(); ask(s); }}>{s}</button>)}
        </div>
      )}
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q.trim()); }}>
        <Icon name="chat" size={16} className="dim" />
        <input ref={input} type="text" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder={listening ? "Listening…" : "Ask your staff or give an order — “where is the enemy fleet?”"} aria-label="Ask your staff" enterKeyHint="send" />
        {canListen() && (
          <button type="button" className={`icon-btn${listening ? " live" : ""}`} onClick={toggleMic} aria-label={listening ? "Stop listening" : "Speak"} title="Speak (M)">
            <Icon name="mic" />
          </button>
        )}
        <button type="submit" className="icon-btn" aria-label="Send" disabled={!q.trim()}><Icon name="send" /></button>
      </form>
    </div>
  );
}
