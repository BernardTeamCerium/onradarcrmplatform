"use client";

import { useMemo, useState } from "react";
import { OUTCOME_COLOR } from "./PipelineCharts";

export interface DealRow {
  id: string;
  name: string;
  stage: string;
  outcome: "open" | "won" | "lost";
  owners: string[];
  value: number;
  closeDate?: string;
  source?: string;
  product?: string;
  url?: string;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const date = (d?: string) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

/** Every prospect on the board, searchable and filterable by outcome. */
export function PipelineDeals({ deals, showSource, showProduct }: { deals: DealRow[]; showSource: boolean; showProduct: boolean }) {
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState<"all" | DealRow["outcome"]>("all");
  const [limit, setLimit] = useState(25);
  const [sort, setSort] = useState<"value" | "close" | "name">("value");
  const shown = useMemo(() => {
    const s = q.toLowerCase();
    return deals
      .filter((d) => outcome === "all" || d.outcome === outcome)
      .filter((d) => !s || [d.name, d.stage, d.owners.join(" "), d.source, d.product].some((v) => v?.toLowerCase().includes(s)))
      .sort((a, b) =>
        sort === "value" ? b.value - a.value : sort === "close" ? (b.closeDate ?? "").localeCompare(a.closeDate ?? "") : a.name.localeCompare(b.name),
      );
  }, [deals, q, outcome, sort]);
  const n = (o: DealRow["outcome"]) => deals.filter((d) => d.outcome === o).length;
  return (
    <>
      <div className="row" style={{ padding: "0 20px 12px", gap: 10 }}>
        <input type="search" placeholder="Search prospect, stage, rep…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} aria-label="Search prospects" />
        <nav className="chips" aria-label="Show">
          {([["all", `All ${deals.length}`], ["open", `Open ${n("open")}`], ["won", `Won ${n("won")}`], ["lost", `Lost ${n("lost")}`]] as const).map(([k, l]) => (
            <button key={k} className={outcome === k ? "chip on" : "chip"} onClick={() => setOutcome(k)}>{l}</button>
          ))}
        </nav>
        <label className="small secondary row" style={{ gap: 6 }}>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ height: 30, width: 130 }}>
            <option value="value">Value</option>
            <option value="close">Close date</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>Prospect</th><th>Stage</th><th>Rep</th><th className="num">Value</th><th>Close date</th>
              {showSource && <th>Source</th>}
              {showProduct && <th>Product</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((d) => (
              <tr key={d.id}>
                <td><b>{d.name}</b></td>
                <td>
                  <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: OUTCOME_COLOR[d.outcome], display: "inline-block" }} />
                    {d.stage}
                  </span>
                </td>
                <td>{d.owners.join(", ") || "—"}</td>
                <td className="num">{money(d.value)}</td>
                <td>{date(d.closeDate)}</td>
                {showSource && <td>{d.source ?? "—"}</td>}
                {showProduct && <td>{d.product ?? "—"}</td>}
                <td>{d.url && <a className="small" href={d.url} target="_blank" rel="noreferrer">Open in Monday ↗</a>}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={8} className="muted">No prospects match.</td></tr>}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <div style={{ padding: "12px 20px" }}>
          <button className="btn sm" onClick={() => setLimit((l) => l + 100)}>Show more ({shown.length - limit} left)</button>
        </div>
      )}
    </>
  );
}
