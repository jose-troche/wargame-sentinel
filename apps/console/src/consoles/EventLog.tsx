// Event log with filters, linked selection and the Explain button on every outcome with factors.
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Console } from "./common";
import { simTime } from "../lib/format";

export function EventLog() {
  const events = useStore((s) => s.events);
  const select = useStore((s) => s.select);
  const selected = useStore((s) => s.selected);
  const set = useStore((s) => s.set);
  const [q, setQ] = useState("");
  const [notable, setNotable] = useState(false);
  const [onlySel, setOnlySel] = useState(false);
  const list = useMemo(() => {
    const ql = q.toLowerCase();
    return events
      .filter((e) => e.type !== "METRICS" && (!notable || e.notable) && (!onlySel || (selected && e.entities?.includes(selected))) && (!ql || e.text.toLowerCase().includes(ql) || e.type.toLowerCase().includes(ql)))
      .slice(-400)
      .reverse();
  }, [events, q, notable, onlySel, selected]);
  return (
    <Console title="Event Log" concept="Append-only, seeded and replayable"
      tools={
        <>
          <input type="text" placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter events" style={{ width: 140 }} />
          <label className="row"><input type="checkbox" checked={notable} onChange={(e) => setNotable(e.target.checked)} /> notable</label>
          <label className="row"><input type="checkbox" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} /> selected</label>
        </>
      }>
      <table className="grid">
        <tbody>
          {list.map((e) => (
            <tr key={`${e.seq}-${e.type}`} className={`click${e.entities?.includes(selected ?? "") ? " sel" : ""}`} onClick={() => e.entities?.[0] && select(e.entities[0])}>
              <td className="mono dim" style={{ width: 70 }}>{simTime(e.simMs)}</td>
              <td style={{ width: 130 }}><span className={`pill ${e.notable ? "warn" : ""}`}>{e.type.replace(/_/g, " ").toLowerCase()}</span></td>
              <td>{e.text}</td>
              <td style={{ width: 70 }}>{e.factors && <button className="small" onClick={(ev) => { ev.stopPropagation(); set({ explain: e }); }}>Explain</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 && <div className="empty">No events yet.</div>}
    </Console>
  );
}
