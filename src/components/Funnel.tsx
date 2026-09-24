import { count, percent } from "@/lib/format";
import type { Metrics } from "@/lib/types";

export function Funnel({ metrics }: { metrics: Metrics }) {
  const steps = [
    { name: "Leads", value: metrics.leads },
    { name: "Appointments", value: metrics.appointments },
    { name: "Applications", value: metrics.applicants },
    { name: "Sales", value: metrics.sales },
  ];
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="funnel" role="list" aria-label="Lead-to-sale funnel">
      {steps.map((s, i) => {
        const w = (s.value / max) * 78; // leave room for the label outside the bar end
        const rate = i === 0 ? null : steps[i - 1].value > 0 ? s.value / steps[i - 1].value : null;
        return (
          <div className="funnel-row" role="listitem" key={s.name}>
            <span className="name">{s.name}</span>
            <div className="funnel-track">
              <div className="funnel-bar" style={{ width: `${w}%` }} />
              <span className="funnel-val" style={{ left: `calc(${w}% + 8px)` }}>
                {count(s.value)}
                {rate !== null && <span className="muted"> · {percent(rate, 0)} of {steps[i - 1].name.toLowerCase()}</span>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
