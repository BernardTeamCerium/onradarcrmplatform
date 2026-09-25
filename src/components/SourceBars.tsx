"use client";

import { useState } from "react";

export interface SourceMetric {
  key: string;
  label: string;
  /** Lower is better (costs); bars still show magnitude, sorting puts the best first. */
  lowerIsBetter?: boolean;
  values: { source: string; value: number | null; display: string }[];
}

/** Ranks sources on one chosen metric at a time (single series, so no legend box is needed). */
export function SourceBars({ metrics }: { metrics: SourceMetric[] }) {
  const [key, setKey] = useState(metrics[0]?.key);
  const [hover, setHover] = useState<string | null>(null);
  const m = metrics.find((x) => x.key === key) ?? metrics[0];
  if (!m) return null;
  const rows = [...m.values]
    .filter((v) => v.value !== null)
    .sort((a, b) => (m.lowerIsBetter ? (a.value ?? 0) - (b.value ?? 0) : (b.value ?? 0) - (a.value ?? 0)));
  const missing = m.values.filter((v) => v.value === null);
  const max = Math.max(1e-9, ...rows.map((r) => r.value ?? 0));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <nav className="chips" aria-label="Compare sources by">
        {metrics.map((x) => (
          <button key={x.key} className={x.key === m.key ? "chip on" : "chip"} onClick={() => setKey(x.key)}>
            {x.label}
          </button>
        ))}
      </nav>
      <p className="muted small" style={{ margin: 0 }}>
        {m.label} by source, {m.lowerIsBetter ? "lowest (best) first" : "highest first"}
      </p>
      <div className="funnel" role="list" aria-label={`${m.label} by source`}>
        {rows.map((r, i) => {
          const w = ((r.value ?? 0) / max) * 74;
          return (
            <div
              className="funnel-row"
              role="listitem"
              key={r.source}
              onPointerEnter={() => setHover(r.source)}
              onPointerLeave={() => setHover(null)}
              style={{ gridTemplateColumns: "150px 1fr" }}
            >
              <span className="name" style={{ fontWeight: hover === r.source ? 650 : undefined }}>
                {r.source}
              </span>
              <div className="funnel-track">
                <div className="funnel-bar" style={{ width: `${w}%`, opacity: hover && hover !== r.source ? 0.55 : 1 }} />
                <span className="funnel-val" style={{ left: `calc(${w}% + 8px)` }}>
                  {r.display}
                  {i === 0 && rows.length > 1 && <span className="muted"> · {m.lowerIsBetter ? "best" : "top"}</span>}
                </span>
              </div>
            </div>
          );
        })}
        {missing.length > 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            No value for {missing.map((x) => x.source).join(", ")} (nothing to divide by yet).
          </p>
        )}
      </div>
    </div>
  );
}
