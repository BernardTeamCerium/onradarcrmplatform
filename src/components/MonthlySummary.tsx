import { money, moneyShort, count, percent, signedPercent } from "@/lib/format";
import { loadMonthly, loadReporting } from "@/lib/monthly";
import { previousRange, type DateRange } from "@/lib/ranges";
import { totalsIn, type Totals } from "@/lib/sheet";
import type { Client } from "@/lib/types";
import { MonthlyForm } from "./MonthlyForm";

const monthName = (d: Date) => d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

/** Monthly numbers compare month to month (and year to date with the same months last year), not day windows. */
function comparison(range: DateRange): { start: Date; end: Date; label: string } {
  const s = range.start;
  if (range.key === "mtd" || range.key === "lastmonth") {
    const start = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1));
    return { start, end: new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1)), label: `vs ${monthName(start)}` };
  }
  if (range.key === "ytd") {
    const y = s.getUTCFullYear() - 1;
    const now = new Date();
    return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y, now.getUTCMonth() + 1, 1)), label: `vs Jan–${monthName(now)} ${y}` };
  }
  const prev = previousRange(range);
  return { start: prev.start, end: prev.end, label: "vs previous period" };
}

const ratio = (a?: number, b?: number) => (a !== undefined && b !== undefined && b > 0 ? a / b : null);
const change = (now?: number, before?: number) => (now !== undefined && before !== undefined && before > 0 ? (now - before) / before : null);

/** The five monthly numbers the team enters, with the rates worked out, for the Overview's selected range. */
export async function MonthlySummary({ client, range, returnTo, msg }: { client: Client; range: DateRange; returnTo: string; msg?: string }) {
  const [reporting, entries] = await Promise.all([loadReporting(client.id), loadMonthly(client.id)]);
  const rows = reporting?.rows ?? [];
  const t: Totals = totalsIn(rows, range.start, range.end);
  const cmp = comparison(range);
  const p: Totals = totalsIn(rows, cmp.start, cmp.end);
  const has = (k: keyof Totals) => t[k] !== undefined;
  const any = (["apptsSet", "connected", "submitted", "paid", "pending"] as const).some(has);

  const delta = (k: keyof Totals) => {
    const c = change(t[k], p[k]);
    return c === null ? `${cmp.label}: —` : `${signedPercent(c)} ${cmp.label}`;
  };
  const tiles: { label: string; value: string; sub: string; tone?: "good" | "bad" }[] = [
    { label: "Appointments", value: has("apptsSet") ? count(t.apptsSet!) : "—", sub: delta("apptsSet") },
    { label: "Connected appointments", value: has("connected") ? count(t.connected!) : "—", sub: delta("connected") },
    { label: "Submitted business", value: has("submitted") ? moneyShort(t.submitted!) : "—", sub: delta("submitted") },
    { label: "Paid business", value: has("paid") ? moneyShort(t.paid!) : "—", sub: delta("paid") },
    { label: "Pending submits", value: has("pending") ? moneyShort(t.pending!) : "—", sub: "Latest month in this period" },
  ];
  const calcs = [
    { label: "Connected rate", value: percent(ratio(t.connected, t.apptsSet), 0), sub: "Connected ÷ appointments" },
    { label: "Submitted per connected appt", value: money(ratio(t.submitted, t.connected)), sub: "Submitted business ÷ connected" },
    { label: "Paid per connected appt", value: money(ratio(t.paid, t.connected)), sub: "Paid business ÷ connected" },
    { label: "Paid rate", value: percent(ratio(t.paid, t.submitted), 0), sub: "Paid ÷ submitted business" },
  ];

  // Month picker: this month back two years.
  const now = new Date();
  const months = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { value: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
  });
  const entered = Object.fromEntries(entries.map((e) => [e.month, e.values]));
  const last = entries[0];

  return (
    <section className="card" id="monthly" style={{ scrollMarginTop: 16 }}>
      <div className="card-head">
        <div>
          <h2>Monthly results · {range.label}</h2>
          <p className="muted small">
            {any
              ? `Entered by the team each month${last ? ` · last update ${new Date(last.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: client.timeZone })}${last.updatedBy ? ` by ${last.updatedBy}` : ""}` : ""}.`
              : "No monthly numbers for this period yet. Enter them below."}
          </p>
        </div>
      </div>
      {msg && <p className="flash" role="status" style={{ marginBottom: 12 }}>{msg}</p>}
      <div className="kpi-grid five" aria-label="Monthly numbers">
        {tiles.map((x) => (
          <div className="kpi" key={x.label}>
            <div className="label">{x.label}</div>
            <div className="value">{x.value}</div>
            <span className="delta">{x.sub}</span>
          </div>
        ))}
      </div>
      <div className="kpi-grid" aria-label="Calculated from the monthly numbers" style={{ marginTop: 14 }}>
        {calcs.map((x) => (
          <div className="kpi" key={x.label} style={{ background: "var(--surface-2)", boxShadow: "none" }}>
            <div className="label">{x.label}</div>
            <div className="value" style={{ fontSize: 24 }}>{x.value}</div>
            <span className="delta">{x.sub}</span>
          </div>
        ))}
      </div>
      <details style={{ marginTop: 18 }} open={!any || !!msg}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Enter or update monthly numbers</summary>
        <div style={{ marginTop: 12 }}>
          <MonthlyForm clientId={client.id} returnTo={returnTo} months={months} entries={entered} />
        </div>
      </details>
    </section>
  );
}
