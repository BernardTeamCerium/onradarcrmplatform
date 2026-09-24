import Link from "next/link";
import { getDashboardData } from "@/lib/metrics";
import { count, money, shortDate } from "@/lib/format";
import type { DateRange } from "@/lib/ranges";
import type { Client, DailyPoint } from "@/lib/types";
import { ClientLogo } from "./ClientLogo";
import { Funnel } from "./Funnel";
import { KpiGrid } from "./KpiGrid";
import { RangePicker } from "./RangePicker";
import { TrendChart, type TrendPoint } from "./TrendChart";

function toTrend(daily: DailyPoint[]): { bucket: "day" | "week"; points: TrendPoint[] } {
  if (daily.length <= 45) {
    return { bucket: "day", points: daily.map((d) => ({ label: shortDate(d.date), leads: d.leads, appointments: d.appointments })) };
  }
  const points: TrendPoint[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    points.push({
      label: `Wk of ${shortDate(chunk[0].date)}`,
      leads: chunk.reduce((s, d) => s + d.leads, 0),
      appointments: chunk.reduce((s, d) => s + d.appointments, 0),
    });
  }
  return { bucket: "week", points };
}

export async function ClientDashboard({
  client,
  range,
  basePath,
  adminView = false,
}: {
  client: Client;
  range: DateRange;
  basePath: string;
  adminView?: boolean;
}) {
  const data = await getDashboardData(client, range);
  const trend = toTrend(data.daily);
  const lastDay = new Date(range.end.getTime() - 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="stack">
      <div className="accent-bar" style={{ background: client.brandColor, marginBottom: 0 }} />
      <div className="client-header">
        <ClientLogo client={client} />
        <div className="titles">
          <h1>{client.name}</h1>
          <p className="muted small">
            {range.label} · {shortDate(range.start.toISOString().slice(0, 10))} – {shortDate(lastDay)}
          </p>
        </div>
        <div className="row">
          {data.source === "ghl" ? (
            <span className="badge"><span className="dot" style={{ background: "var(--good)" }} />Live from GoHighLevel</span>
          ) : (
            <span className="badge"><span className="dot" style={{ background: "var(--ink-muted)" }} />Sample data</span>
          )}
          {adminView && (
            <Link className="btn sm" href={`/admin/clients/${client.id}/settings`}>Client settings</Link>
          )}
        </div>
      </div>

      <RangePicker basePath={basePath} active={range.key} />

      {data.warnings.map((w) => (
        <p key={w} className="notice">{w}</p>
      ))}

      <KpiGrid metrics={data.metrics} previous={data.previous} />

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Leads and appointments</h2>
              <p className="muted small">New leads and booked appointments per {trend.bucket}</p>
            </div>
          </div>
          <TrendChart points={trend.points} bucket={trend.bucket} />
          <details className="table-view">
            <summary>Show as table</summary>
            <div className="table-wrap" style={{ maxHeight: 280, marginTop: 8 }}>
              <table>
                <thead>
                  <tr><th>{trend.bucket === "day" ? "Day" : "Week"}</th><th className="num">Leads</th><th className="num">Appointments</th></tr>
                </thead>
                <tbody>
                  {trend.points.map((p) => (
                    <tr key={p.label}><td>{p.label}</td><td className="num">{count(p.leads)}</td><td className="num">{count(p.appointments)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Lead to sale</h2>
              <p className="muted small">How leads moved through the pipeline this period</p>
            </div>
          </div>
          <Funnel metrics={data.metrics} />
          <div style={{ borderTop: "1px solid var(--grid)", marginTop: 20, paddingTop: 16 }} className="row">
            <div style={{ flex: 1 }}>
              <div className="muted small">Spend</div>
              <div style={{ fontSize: 20, fontWeight: 650 }}>{money(data.metrics.spend)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="muted small">Estimated revenue</div>
              <div style={{ fontSize: 20, fontWeight: 650 }}>{money(data.metrics.estimatedRevenue)}</div>
            </div>
          </div>
        </section>
      </div>

      <p className="muted small">
        {data.source === "ghl" ? "Pulled from GoHighLevel" : "Sample data shown until GoHighLevel is connected"} ·
        updated {new Date(data.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. Ad spend is
        entered by your OnRadar account manager. Estimated revenue uses won opportunity values in GoHighLevel
        {client.averageDealValue > 0 ? `, or ${money(client.averageDealValue)} per sale when a deal has no value` : ""}.
      </p>
    </div>
  );
}
