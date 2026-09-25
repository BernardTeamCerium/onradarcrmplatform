import { getEngineData } from "@/lib/engine";
import { count, percent, shortDate } from "@/lib/format";
import type { DateRange } from "@/lib/ranges";
import type { Client, EngineSource } from "@/lib/types";
import { EngineLive } from "./EngineLive";
import { RangePicker } from "./RangePicker";
import { TrendChart, type TrendPoint } from "./TrendChart";

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

const CHANNELS = [
  { key: "sms", name: "Texts", color: "var(--series-1)" },
  { key: "email", name: "Emails", color: "var(--series-2)" },
  { key: "calls", name: "Calls", color: "var(--series-3)" },
];

export async function EngineView({ client, range, basePath }: { client: Client; range: DateRange; basePath: string }) {
  const e = await getEngineData(client, range);
  const t = e.totals;
  const lastDay = new Date(range.end.getTime() - 86_400_000).toISOString().slice(0, 10);

  let bucket: "day" | "week" = "day";
  let points: TrendPoint[] = e.daily.map((d) => ({ label: shortDate(d.date), sms: d.sms, email: d.email, calls: d.calls }));
  if (e.daily.length > 45) {
    bucket = "week";
    points = [];
    for (let i = 0; i < e.daily.length; i += 7) {
      const w = e.daily.slice(i, i + 7);
      points.push({
        label: `Wk of ${shortDate(w[0].date)}`,
        sms: w.reduce((a, d) => a + d.sms, 0),
        email: w.reduce((a, d) => a + d.email, 0),
        calls: w.reduce((a, d) => a + d.calls, 0),
      });
    }
  }

  const tiles = [
    { label: "Texts sent", value: count(t.smsOut), sub: `${count(t.smsIn)} replies received` },
    { label: "Emails sent", value: count(t.emailOut), sub: `${count(t.emailIn)} replies received` },
    { label: "Calls made", value: count(t.callsOut), sub: `${percent(ratio(t.callsAnswered, t.callsOut), 0)} answered · ${count(t.callsIn)} inbound` },
    { label: "Total conversations", value: count(e.conversations), sub: `${count(t.smsOut + t.emailOut + t.callsOut)} total touches` },
    { label: "Appts set from conversations", value: count(e.apptsSet), sub: `${percent(ratio(e.apptsSet, e.conversations), 0)} of conversations booked` },
  ];

  const total: EngineSource = e.bySource.reduce(
    (a, r) => ({
      source: "Total",
      conversations: a.conversations + r.conversations,
      apptsSet: a.apptsSet + r.apptsSet,
      smsOut: a.smsOut + r.smsOut,
      emailOut: a.emailOut + r.emailOut,
      callsOut: a.callsOut + r.callsOut,
      replies: a.replies + r.replies,
    }),
    { source: "Total", conversations: 0, apptsSet: 0, smsOut: 0, emailOut: 0, callsOut: 0, replies: 0 },
  );
  const bestRate = [...e.bySource]
    .filter((r) => r.conversations >= 10)
    .sort((a, b) => (ratio(b.apptsSet, b.conversations) ?? 0) - (ratio(a.apptsSet, a.conversations) ?? 0))[0];

  return (
    <div className="stack">
      <EngineLive today={e.today} activeNow={e.activeNow} />

      <div className="row" style={{ justifyContent: "space-between" }}>
        <RangePicker basePath={basePath} active={range.key} />
        <span className="muted small">
          {shortDate(range.start.toISOString().slice(0, 10))} – {shortDate(lastDay)} · {e.source === "ghl" ? "Live from OnRadar CRM" : "Sample data"}
        </span>
      </div>
      {e.warnings.map((w) => (
        <p key={w} className="notice">{w}</p>
      ))}

      <section className="kpi-grid five" aria-label="Outreach totals">
        {tiles.map((x) => (
          <div className="kpi" key={x.label}>
            <div className="label">{x.label}</div>
            <div className="value">{x.value}</div>
            <span className="delta">{x.sub}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Outreach per {bucket}</h2>
            <p className="muted small">Texts, emails and calls sent to leads (automated and by the team).</p>
          </div>
        </div>
        <TrendChart points={points} bucket={bucket} series={CHANNELS} label="Texts, emails and calls" />
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div style={{ padding: "20px 20px 0" }}>
          <h2>Conversations to appointments by source</h2>
          <p className="muted small">
            Booked rate = appointments set ÷ conversations.
            {bestRate ? ` ${bestRate.source} turns the most conversations into appointments (${percent(ratio(bestRate.apptsSet, bestRate.conversations), 0)}).` : ""}
          </p>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="compact">
            <thead>
              <tr>
                <th>Source</th>
                <th className="num">Texts sent</th>
                <th className="num">Emails sent</th>
                <th className="num">Calls made</th>
                <th className="num">Replies</th>
                <th className="num">Conversations</th>
                <th className="num">Appts set</th>
                <th className="num">Booked rate</th>
                <th className="num">Touches per appt</th>
              </tr>
            </thead>
            <tbody>
              {[...e.bySource, total].map((r) => {
                const touches = r.smsOut + r.emailOut + r.callsOut;
                const isTotal = r === total;
                return (
                  <tr key={r.source} style={isTotal ? { fontWeight: 650, background: "var(--surface-2)" } : undefined}>
                    <td>{r.source}</td>
                    <td className="num">{count(r.smsOut)}</td>
                    <td className="num">{count(r.emailOut)}</td>
                    <td className="num">{count(r.callsOut)}</td>
                    <td className="num">{count(r.replies)}</td>
                    <td className="num">{count(r.conversations)}</td>
                    <td className="num">{count(r.apptsSet)}</td>
                    <td className="num">{percent(ratio(r.apptsSet, r.conversations), 0)}</td>
                    <td className="num">{r.apptsSet > 0 ? count(touches / r.apptsSet) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="muted small">
        {e.source === "ghl"
          ? "Counts come from the CRM's message log. Messages are credited to the source of the lead they were sent to; messages to older contacts show as Other / unknown."
          : "Sample data until your OnRadar CRM account is connected. Today's counters fill in through the day."}{" "}
        This page refreshes every 30 seconds.
      </p>
    </div>
  );
}
