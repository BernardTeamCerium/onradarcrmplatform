import { getDashboardData } from "@/lib/metrics";
import { count, money, percent, shortDate } from "@/lib/format";
import type { DateRange } from "@/lib/ranges";
import { rates } from "@/lib/rates";
import type { Client, SourceRow } from "@/lib/types";
import { RangePicker } from "./RangePicker";
import { SourceBars } from "./SourceBars";

const derived = rates;

export async function MarketingView({ client, range, basePath }: { client: Client; range: DateRange; basePath: string }) {
  const data = await getDashboardData(client, range);
  const rows = data.bySource;
  const total: SourceRow = rows.reduce(
    (t, r) => ({
      source: "Total",
      spend: t.spend + r.spend,
      leads: t.leads + r.leads,
      conversations: t.conversations + r.conversations,
      apptsSet: t.apptsSet + r.apptsSet,
      connected: t.connected + r.connected,
      applicants: t.applicants + r.applicants,
      sales: t.sales + r.sales,
      premium: t.premium + r.premium,
      cycleDaysSum: t.cycleDaysSum + r.cycleDaysSum,
    }),
    { source: "Total", spend: 0, leads: 0, conversations: 0, apptsSet: 0, connected: 0, applicants: 0, sales: 0, premium: 0, cycleDaysSum: 0 },
  );
  const withLeads = rows.filter((r) => r.leads > 0);
  const best = (fn: (r: SourceRow) => number | null, lower: boolean) =>
    withLeads
      .map((r) => ({ r, v: fn(r) }))
      .filter((x) => x.v !== null)
      .sort((a, b) => (lower ? a.v! - b.v! : b.v! - a.v!))[0];
  const bestCpl = best((r) => derived(r).cpl, true);
  const bestCpc = best((r) => derived(r).costPerConnected, true);
  const bestConv = best((r) => derived(r).salesConversion, false);
  const mostLeads = best((r) => r.leads, false);
  const bestCycle = best((r) => derived(r).cycleDays, true);
  const lastDay = new Date(range.end.getTime() - 86_400_000).toISOString().slice(0, 10);

  const metric = (key: string, label: string, fn: (r: SourceRow) => number | null, fmt: (v: number | null) => string, lowerIsBetter = false) => ({
    key,
    label,
    lowerIsBetter,
    values: withLeads.map((r) => {
      const v = fn(r);
      return { source: r.source, value: v, display: fmt(v) };
    }),
  });
  const pct = (v: number | null) => percent(v, 0);
  const days = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} days`);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <RangePicker basePath={basePath} active={range.key} />
        <span className="muted small">
          {shortDate(range.start.toISOString().slice(0, 10))} – {shortDate(lastDay)} ·{" "}
          {data.source === "ghl" ? "Live from OnRadar CRM" : "Sample data"}
        </span>
      </div>

      <section className="kpi-grid five" aria-label="Source highlights">
        {[
          { label: "Most leads", hit: mostLeads, fmt: (v: number) => `${count(v)} leads` },
          { label: "Lowest cost per lead", hit: bestCpl, fmt: (v: number) => money(v, true) },
          { label: "Lowest cost per connected appt", hit: bestCpc, fmt: (v: number) => money(v, true) },
          { label: "Best sales conversion", hit: bestConv, fmt: (v: number) => percent(v, 1) },
          { label: "Fastest to application", hit: bestCycle, fmt: (v: number) => `${v.toFixed(1)} days on average` },
        ].map((t) => (
          <div className="kpi" key={t.label}>
            <div className="label">{t.label}</div>
            <div className="value">{t.hit ? t.hit.r.source : "—"}</div>
            <span className="delta">{t.hit ? t.fmt(t.hit.v!) : "Not enough data yet"}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Compare sources</h2>
            <p className="muted small">Pick a measure to rank every source by it.</p>
          </div>
        </div>
        <SourceBars
          metrics={[
            metric("leads", "Leads", (r) => r.leads, (v) => count(v ?? 0)),
            metric("spend", "Marketing spend", (r) => r.spend, (v) => money(v)),
            metric("cpl", "Cost per lead", (r) => derived(r).cpl, (v) => money(v, true), true),
            metric("contact", "Contact rate", (r) => derived(r).contactRate, pct),
            metric("set", "Appts set", (r) => r.apptsSet, (v) => count(v ?? 0)),
            metric("connected", "Connected appts", (r) => r.connected, (v) => count(v ?? 0)),
            metric("connPct", "Connected appt %", (r) => derived(r).connectedPct, pct),
            metric("cpc", "Cost per connected appt", (r) => derived(r).costPerConnected, (v) => money(v, true), true),
            metric("apps", "Applications", (r) => r.applicants, (v) => count(v ?? 0)),
            metric("cycle", "Cycle time to application", (r) => derived(r).cycleDays, days, true),
            metric("conv", "Sales conversion", (r) => derived(r).salesConversion, (v) => percent(v, 1)),
          ]}
        />
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div style={{ padding: "20px 20px 0" }}>
          <h2>Results by source</h2>
          <p className="muted small">
            Contact rate = conversations ÷ leads. Conn. rate = connected ÷ appts set. Conn. appt % = connected ÷ leads. Days to app =
            average days from lead to application. Sales conv. = sales ÷ leads. Rows add up to the Dashboard totals for the same dates.
          </p>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="compact">
            <thead>
              <tr>
                <th>Source</th>
                <th className="num">Spend</th>
                <th className="num">Leads</th>
                <th className="num">Cost / lead</th>
                <th className="num">Convos</th>
                <th className="num">Contact rate</th>
                <th className="num">Appts set</th>
                <th className="num">Conn. appts</th>
                <th className="num">Conn. rate</th>
                <th className="num">Conn. appt %</th>
                <th className="num">Cost / conn. appt</th>
                <th className="num">Apps</th>
                <th className="num">Days to app</th>
                <th className="num">Sales conv.</th>
              </tr>
            </thead>
            <tbody>
              {[...rows, total].map((r) => {
                const d = derived(r);
                const isTotal = r === total;
                return (
                  <tr key={r.source} style={isTotal ? { fontWeight: 650, background: "var(--surface-2)" } : undefined}>
                    <td>{r.source}</td>
                    <td className="num">{money(r.spend)}</td>
                    <td className="num">{count(r.leads)}</td>
                    <td className="num">{money(d.cpl, true)}</td>
                    <td className="num">{count(r.conversations)}</td>
                    <td className="num">{percent(d.contactRate, 0)}</td>
                    <td className="num">{count(r.apptsSet)}</td>
                    <td className="num">{count(r.connected)}</td>
                    <td className="num">{percent(d.connectRate, 0)}</td>
                    <td className="num">{percent(d.connectedPct, 0)}</td>
                    <td className="num">{money(d.costPerConnected, true)}</td>
                    <td className="num">{count(r.applicants)}</td>
                    <td className="num">{d.cycleDays === null ? "—" : d.cycleDays.toFixed(1)}</td>
                    <td className="num">{percent(d.salesConversion, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="muted small">
        {data.source === "ghl"
          ? "Leads are matched to a source using the lead source recorded in the CRM; appointments, applications and sales follow the lead they belong to. Anything that can't be matched is shown as Other / unknown."
          : "Sample data: each source has a realistic profile until your OnRadar CRM account is connected."}{" "}
        Spend by source comes from the marketing spend your OnRadar account manager enters for each source.
      </p>
    </div>
  );
}
