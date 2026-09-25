"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface TrendPoint {
  label: string;
  [series: string]: number | string;
}

export interface TrendSeries {
  key: string;
  name: string;
  color: string;
}

const M = { top: 16, right: 16, bottom: 28, left: 40 };

const DEFAULT_SERIES: TrendSeries[] = [
  { key: "leads", name: "Leads", color: "var(--series-1)" },
  { key: "appointments", name: "Appointments", color: "var(--series-2)" },
];

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const m = Math.ceil(v / (step * pow)) * step * pow;
    if (m / (step * pow) <= 5) return m;
  }
  return Math.ceil(v / pow) * pow;
}

export function TrendChart({
  points,
  bucket,
  series: SERIES = DEFAULT_SERIES,
  label = "Leads and appointments",
}: {
  points: TrendPoint[];
  bucket: "day" | "week";
  series?: TrendSeries[];
  label?: string;
}) {
  const val = (p: TrendPoint, k: string) => Number(p[k] ?? 0);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(760);
  const ref = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const H = W < 500 ? 220 : 260;

  // Draw at the container's real pixel width so axis text stays legible on phones.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { max, x, y } = useMemo(() => {
    const max = niceMax(Math.max(1, ...points.flatMap((p) => SERIES.map((s) => val(p, s.key)))));
    const iw = W - M.left - M.right;
    const ih = H - M.top - M.bottom;
    const x = (i: number) => M.left + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const y = (v: number) => M.top + ih - (v / max) * ih;
    return { max, x, y };
  }, [points, W, H]);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(3, Math.floor(W / 110))));

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = ref.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  }

  const hp = hover !== null ? points[hover] : null;
  const leftPct = hover !== null ? (x(hover) / W) * 100 : 0;

  return (
    <div className="chart" ref={wrap}>
      <div className="legend" style={{ marginBottom: 8 }}>
        {SERIES.map((s) => (
          <span key={s.key}>
            <span className="sw" style={{ background: s.color }} />
            {s.name} per {bucket}
          </span>
        ))}
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label} per ${bucket}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ touchAction: "pan-y" }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="tick">{t.toLocaleString()}</text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || (i === points.length - 1 && i % labelEvery >= labelEvery / 2) ? (
            <text key={p.label} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="tick">
              {p.label}
            </text>
          ) : null,
        )}
        {SERIES.map((s) => (
          <g key={s.key}>
            <path
              d={`M${points.map((p, i) => `${x(i)},${y(val(p, s.key))}`).join("L")}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`}
              fill={s.color}
              opacity={0.08}
            />
            <polyline
              points={points.map((p, i) => `${x(i)},${y(val(p, s.key))}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
        {hover !== null && hp && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={H - M.bottom} stroke="var(--axis)" strokeWidth={1} />
            {SERIES.map((s) => (
              <circle key={s.key} cx={x(hover)} cy={y(val(hp, s.key))} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hp && (
        <div
          className="tooltip"
          style={{
            left: `${leftPct}%`,
            top: 36,
            transform: leftPct > 60 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
          }}
        >
          <div className="t-title">{hp.label}</div>
          {SERIES.map((s) => (
            <div className="t-row" key={s.key}>
              <span><span className="sw" style={{ background: s.color, display: "inline-block", width: 10, height: 3, marginRight: 6, verticalAlign: "middle", borderRadius: 2 }} />{s.name}</span>
              <b>{val(hp, s.key).toLocaleString()}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
