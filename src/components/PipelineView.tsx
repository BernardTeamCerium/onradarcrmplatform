import Link from "next/link";
import { syncMonday } from "@/app/actions/monday";
import { count, money, moneyShort, percent } from "@/lib/format";
import { getSnapshot, summarise, toDeals } from "@/lib/monday";
import type { Client } from "@/lib/types";
import { MonthBars, StageBars } from "./PipelineCharts";
import { PipelineDeals } from "./PipelineDeals";

/** Past and current prospects from the client's Monday.com deals board. */
export async function PipelineView({
  client,
  basePath,
  search,
  admin,
}: {
  client: Client;
  basePath: string;
  search: { rep?: string; msg?: string };
  admin?: boolean;
}) {
  const cfg = client.monday;
  if (!cfg) {
    return (
      <section className="card">
        <h2>Pipeline from Monday.com</h2>
        <p className="secondary">
          This tab shows every prospect on your Monday.com deals board (open pipeline, paid deals, stages and results by rep) once
          the board is connected.
        </p>
        {admin ? (
          <Link className="btn primary" href={`/admin/clients/${client.id}/settings#monday`}>Connect Monday.com</Link>
        ) : (
          <p className="muted small">Your OnRadar account manager connects it for you.</p>
        )}
      </section>
    );
  }

  const { snap, warning } = await getSnapshot(client);
  const all = snap ? toDeals(snap, cfg) : [];
  const reps = [...new Set(all.flatMap((d) => (d.owners.length ? d.owners : ["Unassigned"])))].sort();
  const rep = search.rep && reps.includes(search.rep) ? search.rep : undefined;
  const deals = rep ? all.filter((d) => (d.owners.length ? d.owners : ["Unassigned"]).includes(rep)) : all;
  const s = summarise(deals, snap?.stages ?? []);
  const months = s.wonByMonth.slice(-24);
  const here = `${basePath}${rep ? `?rep=${encodeURIComponent(rep)}` : ""}`;

  return (
    <div className="stack">
      {search.msg && <p className="flash" role="status">{search.msg}</p>}
      {warning && <p className="notice">{warning}</p>}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <nav className="chips" aria-label="Rep">
          <Link className={!rep ? "chip on" : "chip"} href={basePath}>All reps</Link>
          {reps.map((r) => (
            <Link key={r} className={rep === r ? "chip on" : "chip"} href={`${basePath}?rep=${encodeURIComponent(r)}`}>{r}</Link>
          ))}
        </nav>
        <form action={syncMonday} className="row" style={{ gap: 10 }}>
          <span className="muted small">
            {snap ? <>“{snap.boardName}” · synced {new Date(snap.syncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</> : "Not synced yet"}
          </span>
          <input type="hidden" name="clientId" value={client.id} />
          <input type="hidden" name="returnTo" value={here} />
          <button className="btn sm" type="submit">Refresh from Monday</button>
        </form>
      </div>

      <section className="kpi-grid five" aria-label="Pipeline totals">
        {[
          ["Open pipeline", moneyShort(s.open.value), `${count(s.open.count)} active deal${s.open.count === 1 ? "" : "s"}`],
          ["Won (paid)", moneyShort(s.won.value), `${count(s.won.count)} deal${s.won.count === 1 ? "" : "s"}`],
          ["Average won deal", money(s.won.average), "Won value ÷ won deals"],
          ["Win rate", percent(s.winRate, 0), `Won ÷ (won + lost) · ${count(s.lost.count)} lost`],
          ["Days to close", s.avgDaysToClose === null ? "—" : `${Math.round(s.avgDaysToClose)}`, "Average, added → close date"],
        ].map(([l, v, sub]) => (
          <div className="kpi" key={l}>
            <div className="label">{l}</div>
            <div className="value">{v}</div>
            <span className="delta">{sub}</span>
          </div>
        ))}
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Deals by stage</h2>
              <p className="muted small">{count(s.deals)} prospects{rep ? ` for ${rep}` : ""}, in the board&apos;s stage order.</p>
            </div>
          </div>
          <StageBars rows={s.byStage} />
        </section>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Won by month</h2>
              <p className="muted small">
                Paid deals by {cfg.columns.closeDate ? "close date" : "date added"}
                {s.wonByMonth.length > 24 ? ", last 24 months" : ""}.
              </p>
            </div>
          </div>
          <MonthBars rows={months} />
        </section>
      </div>

      {!rep && (
        <section className="card" style={{ padding: 0 }}>
          <div style={{ padding: "20px 20px 0" }}>
            <h2>By rep</h2>
            <p className="muted small">A deal with two reps counts for both, and its value is split between them.</p>
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="compact">
              <thead>
                <tr><th>Rep</th><th className="num">Deals</th><th className="num">Open</th><th className="num">Open value</th><th className="num">Won</th><th className="num">Won value</th><th className="num">Lost</th><th className="num">Win rate</th><th className="num">Avg won</th></tr>
              </thead>
              <tbody>
                {s.byRep.map((r) => (
                  <tr key={r.rep}>
                    <td><Link href={`${basePath}?rep=${encodeURIComponent(r.rep)}`}><b>{r.rep}</b></Link></td>
                    <td className="num">{count(r.deals)}</td>
                    <td className="num">{count(r.open)}</td>
                    <td className="num">{money(r.openValue)}</td>
                    <td className="num">{count(r.won)}</td>
                    <td className="num">{money(r.wonValue)}</td>
                    <td className="num">{count(r.lost)}</td>
                    <td className="num">{percent(r.won + r.lost ? r.won / (r.won + r.lost) : null, 0)}</td>
                    <td className="num">{money(r.won ? r.wonValue / r.won : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card" style={{ padding: 0 }}>
        <div style={{ padding: "20px 20px 12px" }}>
          <h2>Prospects</h2>
          <p className="muted small">Every item on the board{rep ? ` for ${rep}` : ""}. Won deals show the actual (paid) value.</p>
        </div>
        <PipelineDeals
          key={rep ?? "all"}
          deals={deals.map((d) => ({
            id: d.id, name: d.name, stage: d.stage, outcome: d.outcome, owners: d.owners,
            value: d.outcome === "won" ? d.wonValue : d.value, closeDate: d.closeDate, source: d.source, product: d.product, url: d.url,
          }))}
          showSource={!!cfg.columns.source}
          showProduct={!!cfg.columns.product}
        />
      </section>
    </div>
  );
}
