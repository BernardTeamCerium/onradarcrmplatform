"use client";

import { useState, useTransition } from "react";
import { setCaseStage } from "@/app/actions/production";

export interface PendingCard {
  id: string;
  clientName: string;
  agentName: string;
  premium: number;
  product?: string;
  carrier?: string;
  caseNumber?: string;
  carrierStatus?: string;
  stage: string;
  daysInStage: number;
  daysPending: number;
}

const short = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}K` : `$${Math.round(v)}`;
const full = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

/** Pending business by stage. Drag a card to another column (or use its menu) to move it. */
export function PendingBoard({ clientId, stages, cards, stuckDays }: { clientId: string; stages: string[]; cards: PendingCard[]; stuckDays: number }) {
  const [rows, setRows] = useState(cards);
  const [agent, setAgent] = useState("");
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const agents = [...new Set(rows.map((r) => r.agentName))].sort();
  const shown = rows.filter((r) => !agent || r.agentName === agent);

  const move = (id: string, stage: string) => {
    const card = rows.find((r) => r.id === id);
    if (!card || card.stage === stage) return;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, stage, daysInStage: 0 } : r)));
    start(() => setCaseStage(clientId, id, stage));
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      {agents.length > 1 && (
        <nav className="chips" aria-label="Agent">
          <button className={!agent ? "chip on" : "chip"} onClick={() => setAgent("")}>All agents</button>
          {agents.map((a) => (
            <button key={a} className={agent === a ? "chip on" : "chip"} onClick={() => setAgent(a)}>{a}</button>
          ))}
        </nav>
      )}
      <div className="board" style={{ opacity: pending ? 0.9 : 1 }}>
        {stages.map((stage) => {
          const col = shown.filter((r) => r.stage === stage).sort((a, b) => b.daysInStage - a.daysInStage);
          const total = col.reduce((a, r) => a + r.premium, 0);
          return (
            <section
              key={stage}
              className={over === stage ? "board-col over" : "board-col"}
              aria-label={`${stage}: ${col.length} cases`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (drag) move(drag, stage);
                setDrag(null);
                setOver(null);
              }}
            >
              <header>
                <b>{stage}</b> <span className="muted">{col.length}</span>
                <div className="small secondary">{col.length ? full(total) : "—"}</div>
              </header>
              {col.map((r) => {
                const stuck = r.daysInStage >= stuckDays;
                return (
                  <article
                    key={r.id}
                    className="board-card"
                    draggable
                    onDragStart={() => setDrag(r.id)}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    style={{ opacity: drag === r.id ? 0.5 : 1 }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 6 }}>
                      <b className="board-name">{r.clientName}</b>
                      <span className="board-amt">{short(r.premium)}</span>
                    </div>
                    <div className="small secondary">{r.agentName}</div>
                    {(r.product || r.carrier) && <div className="small muted">{[r.product, r.carrier].filter(Boolean).join(" · ")}</div>}
                    {r.caseNumber && <div className="small muted">#{r.caseNumber}</div>}
                    {r.carrierStatus && <div className="small secondary" style={{ marginTop: 2 }}>{r.carrierStatus}</div>}
                    <div className="stack" style={{ marginTop: 6, gap: 6 }}>
                      <span className={stuck ? "board-age stuck" : "board-age"} title={`${r.daysPending} days since submitted`}>
                        {stuck ? "⚠ Stuck " : ""}
                        {r.daysInStage === 0 ? "Today" : `${r.daysInStage}d in stage`}
                      </span>
                      <select
                        aria-label={`Move ${r.clientName} to stage`}
                        value={r.stage}
                        onChange={(e) => move(r.id, e.target.value)}
                        className="board-move"
                      >
                        {stages.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
