"use client";

import { useEffect, useRef, useState } from "react";

type Outcome = "open" | "won" | "lost";
export const OUTCOME_COLOR: Record<Outcome, string> = { open: "var(--series-1)", won: "var(--series-3)", lost: "var(--ink-muted)" };
export const OUTCOME_LABEL: Record<Outcome, string> = { open: "Open", won: "Won (paid)", lost: "Lost" };

function short(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

/** Deals per stage, coloured by whether the stage is open, won or lost. */
export function StageBars({ rows }: { rows: { stage: string; outcome: Outcome; count: number; value: number }[] }) {
  const [by, setBy] = useState<"value" | "count">("value");
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => (by === "value" ? r.value : r.count)));
  const outcomes = (["open", "won", "lost"] as Outcome[]).filter((o) => rows.some((r) => r.outcome === o));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <nav className="chips" aria-label="Measure stages by">
          <button className={by === "value" ? "chip on" : "chip"} onClick={() => setBy("value")}>Value</button>
          <button className={by === "count" ? "chip on" : "chip"} onClick={() => setBy("count")}>Deals</button>
        </nav>
        <div className="legend">
          {outcomes.map((o) => (
            <span key={o}><span className="sw" style={{ background: OUTCOME_COLOR[o], height: 10, width: 10 }} />{OUTCOME_LABEL[o]}</span>
          ))}
        </div>
      </div>
      <div className="funnel" role="list" aria-label={`Deals by stage, by ${by === "value" ? "value" : "number of deals"}`}>
        {rows.map((r) => {
          const v = by === "value" ? r.value : r.count;
          const w = (v / max) * 58;
          return (
            <div className="funnel-row" role="listitem" key={r.stage} style={{ gridTemplateColumns: "minmax(96px, 150px) 1fr" }}
              onPointerEnter={() => setHover(r.stage)} onPointerLeave={() => setHover(null)}>
              <span className="name" style={{ fontWeight: hover === r.stage ? 650 : undefined }}>{r.stage}</span>
              <div className="funnel-track">
                <div className="funnel-bar" style={{ width: `${w}%`, background: OUTCOME_COLOR[r.outcome], opacity: hover && hover !== r.stage ? 0.55 : 1 }} />
                <span className="funnel-val" style={{ left: `calc(${w}% + 8px)` }}>
                  {by === "value" ? short(r.value) : r.count}
                  <span className="muted"> · {by === "value" ? `${r.count} deal${r.count === 1 ? "" : "s"}` : short(r.value)}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const M = { top: 18, right: 8, bottom: 28, left: 52 };

function niceMax(v: number) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const m = Math.ceil(v / (step * pow)) * step * pow;
    if (m / (step * pow) <= 5) return m;
  }
  return v;
}

const monthLabel = (m: string, withYear = false) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });

/** Won (paid) value per month. */
export function MonthBars({ rows }: { rows: { month: string; value: number; count: number }[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (rows.length === 0) return <p className="muted small">No won deals with a date yet.</p>;
  const H = 240;
  const max = niceMax(Math.max(...rows.map((r) => r.value)) * 1.05);
  const ih = H - M.top - M.bottom;
  const iw = W - M.left - M.right;
  const y = (v: number) => M.top + ih - (v / max) * ih;
  const band = iw / rows.length;
  const bw = Math.max(3, Math.min(28, band - 2));
  const every = Math.ceil(rows.length / Math.max(1, Math.floor(iw / 56)));
  const bar = (x: number, top: number, bottom: number) => {
    const h = Math.max(0, bottom - top);
    const r = Math.min(4, h, bw / 2);
    return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${bottom}Z`;
  };
  const h = hover !== null ? rows[hover] : null;
  const hx = hover !== null ? M.left + band * hover + band / 2 : 0;
  return (
    <div className="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Won value by month" onPointerLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={M.left} x2={W - M.right} y1={y(max * f)} y2={y(max * f)} stroke={f === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={M.left - 8} y={y(max * f) + 4} textAnchor="end" className="tick">{short(max * f)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = M.left + band * i + (band - bw) / 2;
          return (
            <g key={r.month} onPointerEnter={() => setHover(i)}>
              <path d={bar(x, y(r.value), y(0))} fill="var(--series-3)" opacity={hover !== null && hover !== i ? 0.55 : 1} />
              {i % every === 0 && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="tick">
                  {monthLabel(r.month)}{i === 0 || rows[i - every]?.month.slice(0, 4) !== r.month.slice(0, 4) ? ` ’${r.month.slice(2, 4)}` : ""}
                </text>
              )}
              <rect x={M.left + band * i} y={M.top} width={band} height={ih} fill="transparent" />
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${(hx / W) * 100}%`, top: 30, transform: hx / W > 0.6 ? "translateX(calc(-100% - 14px))" : "translateX(14px)" }}>
          <div className="t-title">{monthLabel(h.month, true)}</div>
          <div className="t-row"><span>Won</span><b>{short(h.value)}</b></div>
          <div className="t-row"><span>Deals</span><b>{h.count}</b></div>
        </div>
      )}
    </div>
  );
}
