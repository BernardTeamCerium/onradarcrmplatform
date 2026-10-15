"use client";

import { useEffect, useRef, useState } from "react";

export interface ChartMetric {
  key: string;
  label: string;
  money?: boolean;
  /** One value per month (null = no data). */
  values: (number | null)[];
}

const fmt = (v: number, money?: boolean) =>
  money
    ? v >= 1_000_000 ? `$${Number((v / 1_000_000).toFixed(2))}M` : v >= 1_000 ? `$${Number((v / 1_000).toFixed(1))}K` : `$${Math.round(v)}`
    : v >= 10_000 ? `${Math.round(v / 1_000)}K` : (Math.round(v * 10) / 10).toLocaleString("en-US");

/** Axis top as 4 round steps (e.g. 0, 10K, 20K, 30K, 40K). */
function niceMax(v: number) {
  const raw = Math.max(v, 1) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((x) => x * pow).find((x) => x >= raw) ?? raw;
  return step * 4;
}

const M = { top: 18, right: 8, bottom: 28, left: 52 };

/** One metric by month (pick the metric with the chips). Single series, so no legend box. */
export function ReportChart({ months, metrics }: { months: string[]; metrics: ChartMetric[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  const [key, setKey] = useState(metrics[0]?.key);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const m = metrics.find((x) => x.key === key) ?? metrics[0];
  if (!m) return null;
  const H = 240;
  const max = niceMax(Math.max(1, ...m.values.map((v) => v ?? 0)) * 1.02);
  const ih = H - M.top - M.bottom;
  const iw = W - M.left - M.right;
  const y = (v: number) => M.top + ih - (v / max) * ih;
  const band = iw / months.length;
  const bw = Math.max(4, Math.min(30, band - 6));
  const label = (mm: string) => new Date(`${mm}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const bar = (x: number, top: number, bottom: number) => {
    const h = Math.max(0, bottom - top);
    const r = Math.min(4, h, bw / 2);
    return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${bottom}Z`;
  };
  const hx = hover !== null ? M.left + band * hover + band / 2 : 0;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <nav className="chips" aria-label="Chart metric">
        {metrics.map((x) => (
          <button key={x.key} className={x.key === m.key ? "chip on" : "chip"} onClick={() => setKey(x.key)}>{x.label}</button>
        ))}
      </nav>
      <div className="chart" ref={wrap}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${m.label} by month`} onPointerLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={M.left} x2={W - M.right} y1={y(max * f)} y2={y(max * f)} stroke={f === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
              <text x={M.left - 8} y={y(max * f) + 4} textAnchor="end" className="tick">{fmt(max * f, m.money)}</text>
            </g>
          ))}
          {months.map((mm, i) => {
            const v = m.values[i];
            const x = M.left + band * i + (band - bw) / 2;
            return (
              <g key={mm} onPointerEnter={() => setHover(i)}>
                {v !== null && v > 0 && <path d={bar(x, y(v), y(0))} fill="var(--series-1)" opacity={hover !== null && hover !== i ? 0.55 : 1} />}
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="tick">{label(mm)}</text>
                <rect x={M.left + band * i} y={M.top} width={band} height={ih} fill="transparent" />
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div className="tooltip" style={{ left: `${(hx / W) * 100}%`, top: 30, transform: hx / W > 0.6 ? "translateX(calc(-100% - 14px))" : "translateX(14px)" }}>
            <div className="t-title">{new Date(`${months[hover]}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
            <div className="t-row"><span>{m.label}</span><b>{m.values[hover] === null ? "—" : m.money ? `$${Math.round(m.values[hover]!).toLocaleString("en-US")}` : Math.round(m.values[hover]!).toLocaleString("en-US")}</b></div>
          </div>
        )}
      </div>
    </div>
  );
}
