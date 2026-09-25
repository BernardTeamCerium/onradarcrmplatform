"use client";

import { useEffect, useRef, useState } from "react";

export interface YearBarSeries {
  key: string;
  name: string;
  color: string;
}

export interface YearBarGroup {
  year: number;
  ytd: boolean;
  values: Record<string, { actual: number; projected?: number; target?: number; lowerIsBetter?: boolean }>;
}

const M = { top: 22, right: 8, bottom: 30, left: 52 };

function short(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

function niceMax(v: number) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const m = Math.ceil(v / (step * pow)) * step * pow;
    if (m / (step * pow) <= 6) return m;
  }
  return v;
}

/** Grouped columns per year with a target tick on each bar and, for the current year, the projected full-year pace. */
export function YearBars({ series, groups, label }: { series: YearBarSeries[]; groups: YearBarGroup[]; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  const [hover, setHover] = useState<{ g: number; s: number } | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = W < 520 ? 260 : 300;
  const all = groups.flatMap((g) => Object.values(g.values).flatMap((v) => [v.actual, v.projected ?? 0, v.target ?? 0]));
  const max = niceMax(Math.max(1, ...all) * 1.08);
  const ih = H - M.top - M.bottom;
  const iw = W - M.left - M.right;
  const y = (v: number) => M.top + ih - (v / max) * ih;
  const band = iw / groups.length;
  const bw = Math.min(24, (band * 0.62 - 2 * (series.length - 1)) / series.length);
  const groupW = bw * series.length + 2 * (series.length - 1);
  const bx = (g: number, s: number) => M.left + band * g + (band - groupW) / 2 + s * (bw + 2);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const r = 4;

  const bar = (x: number, top: number, bottom: number) => {
    const h = Math.max(0, bottom - top);
    const rr = Math.min(r, h, bw / 2);
    return `M${x},${bottom}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + bw - rr}Q${x + bw},${top} ${x + bw},${top + rr}V${bottom}Z`;
  };

  const hv = hover ? { group: groups[hover.g], ser: series[hover.s] } : null;
  const hvVal = hv ? hv.group.values[hv.ser.key] : null;

  return (
    <div className="chart" ref={wrap}>
      <div className="legend" style={{ marginBottom: 8 }}>
        {series.map((s) => (
          <span key={s.key}>
            <span className="sw" style={{ background: s.color, height: 10, width: 10, borderRadius: 2 }} />
            {s.name}
          </span>
        ))}
        <span>
          <span className="sw" style={{ background: "var(--ink)", height: 2, width: 14 }} />
          Target
        </span>
        <span>
          <span className="sw" style={{ background: "var(--ink-muted)", opacity: 0.35, height: 10, width: 10, borderRadius: 2 }} />
          Projected full year (at current pace)
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="tick">{short(t)}</text>
          </g>
        ))}
        {groups.map((g, gi) => (
          <g key={g.year}>
            <text x={M.left + band * gi + band / 2} y={H - 8} textAnchor="middle" className="tick" style={{ fontSize: 12, fill: "var(--ink-2)", fontWeight: 600 }}>
              {g.year}{g.ytd ? " YTD" : ""}
            </text>
            {series.map((s, si) => {
              const v = g.values[s.key];
              if (!v) return null;
              const x = bx(gi, si);
              const top = y(v.actual);
              // Label sits on the bar (or its projected extension); hop over the target tick only if they would collide.
              let labelTop = Math.min(top, v.projected ? y(v.projected) : top);
              if (v.target && labelTop - y(v.target) >= -2 && labelTop - y(v.target) < 16) labelTop = y(v.target);
              return (
                <g key={s.key} onPointerEnter={() => setHover({ g: gi, s: si })}>
                  {v.projected && v.projected > v.actual && (
                    <path d={bar(x, y(v.projected), top)} fill={s.color} opacity={0.28} />
                  )}
                  <path d={bar(x, top, y(0))} fill={s.color} />
                  {v.target ? (
                    <line x1={x - 3} x2={x + bw + 3} y1={y(v.target)} y2={y(v.target)} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />
                  ) : null}
                  {bw >= 16 && (
                    <text x={x + bw / 2} y={labelTop - 6} textAnchor="middle" className="tick" style={{ fontSize: 10, fill: "var(--ink-2)" }}>
                      {short(v.actual)}
                    </text>
                  )}
                  {/* generous hit target */}
                  <rect x={x - 1} y={M.top} width={bw + 2} height={ih} fill="transparent" />
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      {hv && hvVal && hover && (
        <div
          className="tooltip"
          style={{
            left: `${((bx(hover.g, hover.s) + bw / 2) / W) * 100}%`,
            top: 40,
            transform: bx(hover.g, hover.s) / W > 0.6 ? "translateX(calc(-100% - 14px))" : "translateX(14px)",
          }}
        >
          <div className="t-title">{hv.ser.name} · {hv.group.year}{hv.group.ytd ? " YTD" : ""}</div>
          <div className="t-row"><span>Actual</span><b>{short(hvVal.actual)}</b></div>
          {hvVal.projected !== undefined && <div className="t-row"><span>Full-year pace</span><b>{short(hvVal.projected)}</b></div>}
          {hvVal.target !== undefined && (
            <>
              <div className="t-row"><span>{hvVal.lowerIsBetter ? "Limit" : "Target"}</span><b>{short(hvVal.target)}</b></div>
              <div className="t-row">
                <span>{hvVal.lowerIsBetter ? "Of limit" : "Of target"}</span>
                <b>{Math.round(((hvVal.projected ?? hvVal.actual) / hvVal.target) * 100)}%{hvVal.projected !== undefined ? " (pace)" : ""}</b>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
