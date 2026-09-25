import { count, money, percent } from "@/lib/format";
import type { Metrics } from "@/lib/types";

type Kind = "money" | "money2" | "count" | "percent";

interface KpiDef {
  key: keyof Metrics;
  label: string;
  kind: Kind;
  /** Whether an increase is good news. Costs go the other way. */
  upIsGood: boolean;
  formula?: string;
  hero?: boolean;
}

const KPIS: KpiDef[] = [
  { key: "premium", label: "Submitted premium", kind: "money", upIsGood: true, hero: true, formula: "Premium on submitted applications" },
  { key: "estimatedReturn", label: "Estimated return", kind: "percent", upIsGood: true, hero: true, formula: "(Premium − Marketing spend) ÷ Marketing spend" },
  { key: "spend", label: "Marketing spend", kind: "money", upIsGood: false },
  { key: "leads", label: "Leads", kind: "count", upIsGood: true, formula: "New contacts" },
  { key: "costPerLead", label: "Cost per lead", kind: "money2", upIsGood: false, formula: "Marketing spend ÷ Leads" },
  { key: "conversations", label: "Conversations", kind: "count", upIsGood: true, formula: "New conversations" },
  { key: "apptsSet", label: "Appointments set", kind: "count", upIsGood: true, formula: "Booked on the calendar" },
  { key: "appointments", label: "Connected appointments", kind: "count", upIsGood: true, formula: "Held, not cancelled or no-show" },
  { key: "connectRate", label: "Connected rate", kind: "percent", upIsGood: true, formula: "Connected ÷ Appointments set" },
  { key: "costPerAppointment", label: "Cost per appointment", kind: "money2", upIsGood: false, formula: "Marketing spend ÷ Connected appts" },
  { key: "applicants", label: "Applications submitted", kind: "count", upIsGood: true, formula: "Reached application stage" },
  { key: "salesConversion", label: "Sales conversion", kind: "percent", upIsGood: true, formula: "Sales ÷ Leads" },
];

function fmt(kind: Kind, v: number | null) {
  if (kind === "money") return money(v);
  if (kind === "money2") return money(v, true);
  if (kind === "percent") return percent(v, v !== null && Math.abs(v) >= 1 ? 0 : 1);
  return v === null ? "—" : count(v);
}

function Delta({ def, now, prev }: { def: KpiDef; now: number | null; prev: number | null }) {
  if (now === null || prev === null) return <span className="delta">No prior-period comparison</span>;
  let text: string;
  let change: number;
  if (def.kind === "percent") {
    change = now - prev;
    text = `${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toLocaleString("en-US", { maximumFractionDigits: Math.abs(change) >= 0.1 ? 0 : 1 })} pts`;
  } else {
    if (prev === 0) return <span className="delta">New this period</span>;
    change = (now - prev) / Math.abs(prev);
    text = `${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(0)}%`;
  }
  if (Math.abs(change) < 0.005) return <span className="delta">— Flat vs prior period</span>;
  const good = change > 0 === def.upIsGood;
  return (
    <span className={`delta ${good ? "good" : "bad"}`}>
      <span aria-hidden="true">{change > 0 ? "▲" : "▼"}</span>
      {text} <span className="muted">vs prior period</span>
    </span>
  );
}

export function KpiGrid({ metrics, previous, agent }: { metrics: Metrics; previous: Metrics; agent?: string }) {
  const tile = (def: KpiDef) => (
    <div key={def.key} className={`kpi${def.hero ? " hero" : ""}`}>
      <div className="label">{def.label}</div>
      <div className="value" style={def.hero ? { fontSize: 34 } : undefined}>{fmt(def.kind, metrics[def.key])}</div>
      <Delta def={def} now={metrics[def.key]} prev={previous[def.key]} />
      {def.formula && <div className="formula">{def.key === "premium" && agent ? `Submitted by ${agent}` : def.formula}</div>}
    </div>
  );
  return (
    <section className="stack" style={{ gap: 14 }} aria-label="Key metrics">
      <div className="kpi-grid two">{KPIS.filter((d) => d.hero).map(tile)}</div>
      <div className="kpi-grid five">{KPIS.filter((d) => !d.hero).map(tile)}</div>
    </section>
  );
}
