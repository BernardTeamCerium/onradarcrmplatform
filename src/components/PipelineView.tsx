import Link from "next/link";
import { syncMonday } from "@/app/actions/monday";
import { count, money, moneyShort, percent } from "@/lib/format";
import { getSnapshot, summarise, toDeals } from "@/lib/monday";
import { loadProduction } from "@/lib/production";
import { isPending, stageOf, stagesFor, STUCK_DAYS } from "@/lib/stages";
import type { Client } from "@/lib/types";
import { PendingBoard } from "./PendingBoard";
import { MonthBars, StageBars } from "./PipelineCharts";
import { PipelineDeals } from "./PipelineDeals";

const DAY = 86_400_000;

/** Pending business (from the Production tab and status emails), then the Monday.com prospect history. */
export async function PipelineView(props: { client: Client; basePath: string; search: { rep?: string; msg?: string }; admin?: boolean }) {
  const { client, admin } = props;
  const entries = await loadProduction(client);
  const stages = stagesFor(client);
  const now = Date.now();
  const since = (iso?: string) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso)) / DAY)) : 0);
  const pending = entries.filter(isPending).map((e) => {
    const stage = stageOf(e, stages);
    return {
      id: e.id,
      clientName: e.clientName ?? "Unnamed case",
      agentName: e.agentName,
      premium: e.premium ?? 0,
      product: e.product,
      carrier: e.carrier,
      caseNumber: e.caseNumber,
      carrierStatus: e.carrierStatus,
      stage,
      daysInStage: since(e.stage === stage ? e.stageAt ?? e.date : e.date),
      daysPending: since(e.date),
    };
  });
  const sum = (xs: { premium: number }[]) => xs.reduce((a, x) => a + x.premium, 0);
  const moving = pending.filter((p) => /transfer|funds/i.test(p.stage));
  const stuck = pending.filter((p) => p.daysInStage >= STUCK_DAYS);
  const paid30 = entries.filter((e) => e.kind === "case" && e.status === "Paid" && e.paidDate && since(e.paidDate) <= 30);
  const avgDays = pending.length ? pending.reduce((a, p) => a + p.daysPending, 0) / pending.length : null;

  return (
    <div className="stack">
      {props.search.msg && <p className="flash" role="status">{props.search.msg}</p>}
      <section className="stack" style={{ gap: 14 }} aria-labelledby="pending-h">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2 id="pending-h" style={{ margin: 0 }}>Pending business</h2>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              Every submitted case that isn&apos;t paid yet. Status emails from the IMO move cases automatically; drag a card (or use its menu)
              to move it yourself. Paid, declined and chargebacks are set on the{" "}
              <Link href={props.basePath.replace(/\/pipeline$/, "/production")}>Production</Link> tab.
            </p>
          </div>
        </div>
        <div className="kpi-grid five" aria-label="Pending totals">
          {[
            ["Pending premium", moneyShort(sum(pending)), `${count(pending.length)} case${pending.length === 1 ? "" : "s"}`],
            ["Money in transfer", moneyShort(sum(moving)), `${count(moving.length)} in transfer or funds en route`],
            ["Stuck", count(stuck.length), stuck.length ? `${moneyShort(sum(stuck))} · ${STUCK_DAYS}+ days in one stage` : `Nothing ${STUCK_DAYS}+ days in one stage`],
            ["Days pending", avgDays === null ? "—" : `${Math.round(avgDays)}`, "Average since submitted"],
            ["Paid · last 30 days", moneyShort(paid30.reduce((a, e) => a + (e.premium ?? 0), 0)), `${count(paid30.length)} case${paid30.length === 1 ? "" : "s"} issued or paid`],
          ].map(([l, v, sub]) => (
            <div className="kpi" key={l}>
              <div className="label">{l}</div>
              <div className="value">{v}</div>
              <span className="delta">{sub}</span>
            </div>
          ))}
        </div>
        {pending.length ? (
          <PendingBoard clientId={client.id} stages={stages} cards={pending} stuckDays={STUCK_DAYS} />
        ) : (
          <p className="card muted">
            No pending cases. Log a case or import a status email on the Production tab, or set up production emails{admin ? " in Settings" : ""}.
          </p>
        )}
      </section>

      {(client.monday || admin) && (
        <section className="stack" style={{ gap: 14, marginTop: 12 }} aria-labelledby="monday-h">
          <div>
            <h2 id="monday-h" style={{ margin: 0 }}>Previous prospects · Monday.com</h2>
            <p className="muted small" style={{ margin: "4px 0 0" }}>History and results from the Monday.com deals board.</p>
          </div>
          <MondaySection {...props} search={{ rep: props.search.rep }} />
        </section>
      )}
    </div>
  );
}

/** Past and current prospects from the client's Monday.com deals board. */
async function MondaySection({
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
        <p className="secondary" style={{ marginTop: 0 }}>
          Connect the Monday.com deals board to bring in past prospects: paid deals, stages, win rate and results by rep.
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
          <Link className={!rep ? "chip on" : "chip"} href={`${basePath}#monday-h`}>All reps</Link>
          {reps.map((r) => (
            <Link key={r} className={rep === r ? "chip on" : "chip"} href={`${basePath}?rep=${encodeURIComponent(r)}#monday-h`}>{r}</Link>
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
