import Link from "next/link";
import { count, money, moneyShort, percent } from "@/lib/format";
import { demoRows } from "@/lib/metrics";
import { loadReporting } from "@/lib/monthly";
import { METRIC_LABEL, MONEY_METRICS, sheetYears, totalsIn, type Totals } from "@/lib/sheet";
import { type Client, type ReportMetric, type ReportRow, type ReportSheet } from "@/lib/types";
import { ReportChart } from "./ReportChart";

const ratio = (a?: number, b?: number) => (a !== undefined && b !== undefined && b > 0 ? a / b : null);

/** Derived columns, shown when the sheet has the numbers they need. */
const DERIVED: { key: string; label: string; needs: ReportMetric[]; value: (t: Totals) => number | null; fmt: (v: number | null) => string }[] = [
  { key: "cpl", label: "Cost per lead", needs: ["spend", "leads"], value: (t) => ratio(t.spend, t.leads), fmt: (v) => money(v) },
  { key: "cpa", label: "Cost per appt", needs: ["spend", "connected"], value: (t) => ratio(t.spend, t.connected), fmt: (v) => money(v) },
  { key: "connect", label: "Connect rate", needs: ["connected", "apptsSet"], value: (t) => ratio(t.connected, t.apptsSet), fmt: (v) => percent(v, 0) },
  { key: "close", label: "Close rate", needs: ["sales", "leads"], value: (t) => ratio(t.sales, t.leads), fmt: (v) => percent(v, 1) },
  { key: "placement", label: "Placement", needs: ["paid", "submitted"], value: (t) => ratio(t.paid, t.submitted), fmt: (v) => percent(v, 0) },
  { key: "return", label: "Return", needs: ["submitted", "spend"], value: (t) => (t.spend ? ((t.submitted ?? 0) - t.spend) / t.spend : null), fmt: (v) => percent(v, 0) },
];

const fmtMetric = (m: ReportMetric, v?: number) => (v === undefined ? "—" : MONEY_METRICS.includes(m) ? money(v) : count(v));

/** Sample mode without a sheet: the same generated numbers as the Overview, by month, so the page can be shown. */
function sampleSheet(client: Client): ReportSheet {
  const now = new Date();
  const rows: ReportRow[] = [];
  for (let i = 23; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const days = demoRows(client, { start, end });
    const sum = (f: (d: (typeof days)[number]) => number) => Math.round(days.reduce((a, d) => a + f(d), 0));
    rows.push({
      period: start.toISOString().slice(0, 7),
      values: {
        spend: sum((d) => d.spend), leads: sum((d) => d.leads), conversations: sum((d) => d.conversations), apptsSet: sum((d) => d.apptsSet),
        connected: sum((d) => d.appointments), applications: sum((d) => d.applicants), sales: sum((d) => d.sales), submitted: sum((d) => d.premium),
      },
    });
  }
  return {
    syncedAt: now.toISOString(), name: "Sample data", tabs: [], metrics: ["spend", "leads", "conversations", "apptsSet", "connected", "applications", "sales", "submitted"],
    hasAgent: false, hasSource: false, rows, skipped: [], ignoredColumns: [],
  };
}

export async function ReportsView({
  client,
  basePath,
  search,
  admin,
}: {
  client: Client;
  basePath: string;
  search: { year?: string; agent?: string; source?: string };
  admin?: boolean;
}) {
  const stored = await loadReporting(client.id);
  const sheet = stored ?? (client.demoMode ? sampleSheet(client) : null);
  if (!sheet || sheet.rows.length === 0) {
    return (
      <section className="card">
        <h2>Reports</h2>
        <p className="secondary">
          Month-by-month numbers appear here once the team enters this month&apos;s numbers on the Overview (or a reporting Google Sheet is
          connected).
        </p>
        {admin ? (
          <Link className="btn primary" href={`/admin/clients/${client.id}/settings#sheet`}>Connect the reporting sheet</Link>
        ) : (
          <p className="muted small">Your OnRadar account manager connects it for you.</p>
        )}
      </section>
    );
  }

  const now = new Date();
  const years = sheetYears(sheet);
  const year = years.includes(Number(search.year)) ? Number(search.year) : years.includes(now.getUTCFullYear()) ? now.getUTCFullYear() : years[0];
  const agents = sheet.hasAgent ? [...new Set(sheet.rows.map((r) => r.agent).filter((x): x is string => !!x))].sort() : [];
  const sources = sheet.hasSource ? [...new Set(sheet.rows.map((r) => r.source).filter((x): x is string => !!x))].sort() : [];
  const agent = agents.includes(search.agent ?? "") ? search.agent : undefined;
  const source = sources.includes(search.source ?? "") ? search.source : undefined;
  const filter = (r: ReportRow) => (!agent || r.agent === agent) && (!source || r.source === source);
  const link = (p: { year?: number; agent?: string; source?: string }) => {
    const q = new URLSearchParams();
    const y = p.year ?? year;
    if (y) q.set("year", String(y));
    const a = "agent" in p ? p.agent : agent;
    const s = "source" in p ? p.source : source;
    if (a) q.set("agent", a);
    if (s) q.set("source", s);
    return `${basePath}?${q}`;
  };

  const yStart = new Date(Date.UTC(year, 0, 1));
  const yEnd = new Date(Date.UTC(year + 1, 0, 1));
  const lastMonth = year === now.getUTCFullYear() ? now.getUTCMonth() : 11;
  const months = Array.from({ length: lastMonth + 1 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const monthTotals = months.map((mm) => {
    const [yy, m] = mm.split("-").map(Number);
    return totalsIn(sheet.rows, new Date(Date.UTC(yy, m - 1, 1)), new Date(Date.UTC(yy, m, 1)), filter, now);
  });
  const total = totalsIn(sheet.rows, yStart, yEnd, filter, now);
  const metrics = sheet.metrics;
  const derived = DERIVED.filter((d) => d.needs.every((m) => metrics.includes(m)));
  const label = `${year}${year === now.getUTCFullYear() ? " year to date" : ""}${agent ? ` · ${agent}` : ""}${source ? ` · ${source}` : ""}`;

  const tiles: [string, string, string][] = [];
  for (const m of ["submitted", "paid", "spend", "leads", "apptsSet", "connected", "applications", "sales"] as ReportMetric[]) {
    if (tiles.length >= 6) break;
    if (!metrics.includes(m)) continue;
    tiles.push([METRIC_LABEL[m], MONEY_METRICS.includes(m) ? moneyShort(total[m] ?? 0) : count(total[m] ?? 0), label]);
  }
  // Two rate tiles at most, so the grid stays at two even rows of four.
  for (const d of derived.filter((x) => ["cpl", "return"].includes(x.key))) tiles.push([d.label, d.fmt(d.value(total)), label]);

  const breakdown = (by: "agent" | "source", names: string[]) => {
    const rows = names
      .map((name) => ({ name, t: totalsIn(sheet.rows, yStart, yEnd, (r) => filter(r) && r[by] === name, now) }))
      .filter((x) => Object.keys(x.t).length > 0)
      .sort((a, b) => (b.t.submitted ?? b.t.leads ?? 0) - (a.t.submitted ?? a.t.leads ?? 0));
    return (
      <section className="card" style={{ padding: 0 }}>
        <div style={{ padding: "20px 20px 0" }}>
          <h2>By {by} · {label}</h2>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="compact">
            <thead>
              <tr>
                <th>{by === "agent" ? "Agent" : "Source"}</th>
                {metrics.map((m) => <th key={m} className="num">{METRIC_LABEL[m]}</th>)}
                {derived.map((d) => <th key={d.key} className="num">{d.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ name, t }) => (
                <tr key={name}>
                  <td><Link href={link({ [by]: name })}><b>{name}</b></Link></td>
                  {metrics.map((m) => <td key={m} className="num">{fmtMetric(m, t[m])}</td>)}
                  {derived.map((d) => <td key={d.key} className="num">{d.fmt(d.value(t))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const updated = new Date(sheet.syncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: client.timeZone });

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <nav className="chips" aria-label="Year">
          {years.map((y) => <Link key={y} className={y === year ? "chip on" : "chip"} href={link({ year: y })}>{y}</Link>)}
        </nav>
        <span className="muted small">
          {stored ? <>From “{sheet.name}” · updated {updated}{admin && sheet.url ? <> · <a href={sheet.url} target="_blank" rel="noreferrer">Open sheet ↗</a></> : null}</> : "Sample data until the reporting sheet is connected"}
        </span>
      </div>
      {(agents.length > 0 || sources.length > 0) && (
        <div className="stack" style={{ gap: 8 }}>
          {agents.length > 0 && (
            <nav className="chips" aria-label="Agent">
              <Link className={!agent ? "chip on" : "chip"} href={link({ agent: undefined })}>All agents</Link>
              {agents.map((a) => <Link key={a} className={agent === a ? "chip on" : "chip"} href={link({ agent: a })}>{a}</Link>)}
            </nav>
          )}
          {sources.length > 0 && (
            <nav className="chips" aria-label="Source">
              <Link className={!source ? "chip on" : "chip"} href={link({ source: undefined })}>All sources</Link>
              {sources.map((s) => <Link key={s} className={source === s ? "chip on" : "chip"} href={link({ source: s })}>{s}</Link>)}
            </nav>
          )}
        </div>
      )}

      <section className="kpi-grid" aria-label={`${label} totals`}>
        {tiles.map(([l, v, sub]) => (
          <div className="kpi" key={l}>
            <div className="label">{l}</div>
            <div className="value">{v}</div>
            <span className="delta">{sub}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head"><div><h2>By month · {label}</h2></div></div>
        <ReportChart
          months={months}
          metrics={[
            ...metrics.map((m) => ({ key: m, label: METRIC_LABEL[m], money: MONEY_METRICS.includes(m), values: monthTotals.map((t) => (t[m] === undefined ? null : t[m]!)) })),
          ]}
        />
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div style={{ padding: "20px 20px 0" }}>
          <h2>Month by month · {label}</h2>
          <p className="muted small">Every number from the reporting sheet, with the rates worked out for you.</p>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="compact">
            <thead>
              <tr>
                <th>Month</th>
                {metrics.map((m) => <th key={m} className="num">{METRIC_LABEL[m]}</th>)}
                {derived.map((d) => <th key={d.key} className="num">{d.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {months.map((mm, i) => (
                <tr key={mm}>
                  <td><b>{new Date(`${mm}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}</b></td>
                  {metrics.map((m) => <td key={m} className="num">{fmtMetric(m, monthTotals[i][m])}</td>)}
                  {derived.map((d) => <td key={d.key} className="num">{d.fmt(d.value(monthTotals[i]))}</td>)}
                </tr>
              ))}
              <tr style={{ background: "var(--surface-2)" }}>
                <td><b>Total</b></td>
                {metrics.map((m) => <td key={m} className="num"><b>{fmtMetric(m, total[m])}</b></td>)}
                {derived.map((d) => <td key={d.key} className="num"><b>{d.fmt(d.value(total))}</b></td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {agents.length > 1 && !agent && breakdown("agent", agents)}
      {sources.length > 1 && !source && breakdown("source", sources)}

      {admin && stored && (stored.skipped.length > 0 || stored.ignoredColumns.length > 0) && (
        <p className="notice small">
          {stored.skipped.length > 0 && <>Skipped {stored.skipped.length} row{stored.skipped.length === 1 ? "" : "s"} ({stored.skipped.slice(0, 3).map((s) => `${s.tab} row ${s.row}: ${s.reason}`).join("; ")}). </>}
          {stored.ignoredColumns.length > 0 && <>Columns not used: {stored.ignoredColumns.join(", ")}.</>}
        </p>
      )}
    </div>
  );
}

