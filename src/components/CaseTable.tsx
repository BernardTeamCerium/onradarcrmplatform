"use client";

import { useState, useTransition } from "react";
import { deleteEntry, setCaseStatus } from "@/app/actions/production";
import { CASE_STATUSES, type CaseStatus, type ProductionEntry } from "@/lib/types";

const money = (n?: number) => (n === undefined ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const date = (d?: string) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
const TONE: Record<CaseStatus, string> = { Submitted: "var(--series-1)", Paid: "var(--good)", Chargeback: "var(--bad)", Declined: "var(--ink-muted)" };

/** The case log, with status changes (Submitted → Paid → Chargeback) saved as you pick them. */
export function CaseTable({ clientId, entries }: { clientId: string; entries: ProductionEntry[] }) {
  const [rows, setRows] = useState(entries);
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState("");
  const shown = rows.filter((r) =>
    !filter || [r.clientName, r.agentName, r.carrier, r.product, r.status, r.source, r.caseNumber, r.carrierStatus].some((v) => v?.toLowerCase().includes(filter.toLowerCase())),
  );
  if (rows.length === 0) return <p className="muted" style={{ padding: 20 }}>No cases logged for this period yet.</p>;
  return (
    <>
      <div style={{ padding: "0 20px 10px" }}>
        <input type="search" placeholder="Search client, case number, agent, carrier…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 360 }} aria-label="Search cases" />
      </div>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Client</th>
              <th>Agent</th>
              <th>Product</th>
              <th>Carrier</th>
              <th className="num">Premium</th>
              <th>Status</th>
              <th>Paid</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} style={{ opacity: pending ? 0.85 : 1 }}>
                <td>{date(r.date)}</td>
                <td>
                  <b>{r.clientName ?? "—"}</b>
                  {r.sample && <span className="muted small"> · sample</span>}
                  {r.caseNumber && <div className="muted small">#{r.caseNumber}</div>}
                </td>
                <td>{r.agentName}</td>
                <td>{r.product ?? "—"}</td>
                <td>{r.carrier ?? "—"}</td>
                <td className="num">{money(r.premium)}</td>
                <td>
                  <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                    <span className="dot" style={{ width: 8, height: 8, borderRadius: "50%", background: TONE[r.status ?? "Submitted"], display: "inline-block" }} />
                    <select
                      value={r.status ?? "Submitted"}
                      aria-label={`Status for ${r.clientName ?? "case"}`}
                      style={{ height: 30, width: 130 }}
                      onChange={(e) => {
                        const status = e.target.value as CaseStatus;
                        const today = new Date().toISOString().slice(0, 10);
                        setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status, paidDate: status === "Paid" || status === "Chargeback" ? x.paidDate ?? today : undefined } : x)));
                        start(() => setCaseStatus(clientId, r.id, status));
                      }}
                    >
                      {CASE_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </span>
                  {r.carrierStatus && <div className="small secondary" style={{ marginTop: 4, maxWidth: 220 }}>{r.carrierStatus}</div>}
                  {r.updates && r.updates.length > 0 && (
                    <details className="small" style={{ marginTop: 2, maxWidth: 320 }}>
                      <summary className="muted" style={{ cursor: "pointer" }}>
                        {r.updates.length} email update{r.updates.length === 1 ? "" : "s"}
                      </summary>
                      <ol style={{ margin: "6px 0 0", paddingLeft: 16, display: "grid", gap: 6 }}>
                        {[...r.updates].reverse().map((u, i) => (
                          <li key={u.ref ?? i}>
                            <b>{u.status}</b>{" "}
                            <span className="muted">
                              {new Date(u.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                            {u.note && <div className="secondary" style={{ whiteSpace: "pre-line" }}>{u.note}</div>}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </td>
                <td>{date(r.paidDate)}</td>
                <td>{r.source ?? "—"}</td>
                <td>
                  <button
                    className="btn sm danger"
                    onClick={() => {
                      if (!confirm(`Delete this case${r.clientName ? ` for ${r.clientName}` : ""}?`)) return;
                      setRows((rs) => rs.filter((x) => x.id !== r.id));
                      start(() => deleteEntry(clientId, r.id));
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Historical totals list with delete. */
export function TotalsTable({ clientId, entries }: { clientId: string; entries: ProductionEntry[] }) {
  const [rows, setRows] = useState(entries);
  const [, start] = useTransition();
  if (rows.length === 0) return <p className="muted small" style={{ padding: "0 20px 16px" }}>No historical totals for this period.</p>;
  const label = (p?: string) =>
    !p ? "—" : p.length === 4 ? `${p} (full year)` : new Date(`${p}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th>Period</th>
            <th>Agent</th>
            <th className="num">Submitted</th>
            <th className="num">Paid</th>
            <th className="num">Chargebacks</th>
            <th className="num">Cases</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {label(r.period)}
                {r.sample && <span className="muted small"> · sample</span>}
              </td>
              <td>{r.agentName}</td>
              <td className="num">{money(r.submitted)}</td>
              <td className="num">{money(r.paid)}</td>
              <td className="num">{money(r.chargebacks)}</td>
              <td className="num">{r.cases ?? "—"}</td>
              <td>
                <button
                  className="btn sm danger"
                  onClick={() => {
                    if (!confirm("Delete these totals?")) return;
                    setRows((rs) => rs.filter((x) => x.id !== r.id));
                    start(() => deleteEntry(clientId, r.id));
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
