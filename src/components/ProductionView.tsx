import Link from "next/link";
import { addCase, addTotal, clearSampleProduction, importProduction } from "@/app/actions/production";
import { count, money, moneyShort, percent } from "@/lib/format";
import { loadProduction, productionYears, totalsByAgent, totalsByYear } from "@/lib/production";
import { CASE_STATUSES, PRODUCTS, type Client } from "@/lib/types";
import { CaseTable, TotalsTable } from "./CaseTable";

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export async function ProductionView({
  client,
  basePath,
  search,
}: {
  client: Client;
  basePath: string;
  search: { year?: string; msg?: string };
}) {
  const entries = await loadProduction(client);
  const thisYear = new Date().getUTCFullYear();
  const years = [...new Set([...productionYears(entries), thisYear])].sort((a, b) => b - a);
  const all = search.year === "all";
  const year = all ? undefined : years.includes(Number(search.year)) ? Number(search.year) : thisYear;
  const inYear = (d?: string) => all || (d ?? "").startsWith(String(year));
  const t = all
    ? [...totalsByYear(entries).values()].reduce((a, b) => ({ submitted: a.submitted + b.submitted, paid: a.paid + b.paid, chargebacks: a.chargebacks + b.chargebacks, cases: a.cases + b.cases }), { submitted: 0, paid: 0, chargebacks: 0, cases: 0 })
    : totalsByYear(entries).get(String(year)) ?? { submitted: 0, paid: 0, chargebacks: 0, cases: 0 };
  const byAgent = [...totalsByAgent(entries, year).entries()].sort((a, b) => b[1].submitted - a[1].submitted);
  const cases = entries.filter((e) => e.kind === "case" && inYear(e.date)).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const totals = entries.filter((e) => e.kind === "summary" && inYear(e.period)).sort((a, b) => (b.period ?? "").localeCompare(a.period ?? "") || a.agentName.localeCompare(b.agentName));
  const agentNames = [...new Set([...client.agents.map((a) => a.name), ...entries.map((e) => e.agentName)])];
  const hasSamples = entries.some((e) => e.sample);
  const here = `${basePath}${all ? "?year=all" : year !== thisYear ? `?year=${year}` : ""}`;
  const today = new Date().toISOString().slice(0, 10);
  const label = all ? "All time" : year === thisYear ? `${year} year to date` : String(year);

  return (
    <div className="stack">
      {search.msg && <p className="flash" role="status">{search.msg}</p>}
      {hasSamples && (
        <div className="notice row" style={{ justifyContent: "space-between" }}>
          <span>Includes sample entries: Sibley&apos;s reported yearly totals split across agents (the split is illustrative). Import your real history to replace them.</span>
          <form action={clearSampleProduction}>
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="returnTo" value={here} />
            <button className="btn sm" type="submit">Remove sample entries</button>
          </form>
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <nav className="chips" aria-label="Year">
          {years.map((y) => (
            <Link key={y} className={!all && y === year ? "chip on" : "chip"} href={`${basePath}?year=${y}`}>{y}</Link>
          ))}
          <Link className={all ? "chip on" : "chip"} href={`${basePath}?year=all`}>All time</Link>
        </nav>
        <a className="btn sm" href={`/api/clients/${client.id}/production/export`}>Export CSV</a>
      </div>

      <section className="kpi-grid five" aria-label={`${label} production`}>
        {[
          ["Submitted", moneyShort(t.submitted), `${count(t.cases)} cases · ${label}`],
          ["Paid", moneyShort(t.paid), `${percent(ratio(t.paid, t.submitted), 0)} of submitted`],
          ["Chargebacks", moneyShort(t.chargebacks), `${percent(ratio(t.chargebacks, t.paid), 1)} of paid`],
          ["Net paid", moneyShort(t.paid - t.chargebacks), "Paid − chargebacks"],
          ["Average case", moneyShort(t.cases ? t.submitted / t.cases : null), "Submitted ÷ cases"],
        ].map(([l, v, sub]) => (
          <div className="kpi" key={l}>
            <div className="label">{l}</div>
            <div className="value">{v}</div>
            <span className="delta">{sub}</span>
          </div>
        ))}
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div style={{ padding: "20px 20px 0" }}>
          <h2>By agent · {label}</h2>
          <p className="muted small">Includes logged cases and historical totals. These numbers also drive the Trends tab and submitted premium on the Dashboard.</p>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="compact">
            <thead>
              <tr><th>Agent</th><th className="num">Cases</th><th className="num">Submitted</th><th className="num">Paid</th><th className="num">Chargebacks</th><th className="num">Net paid</th><th className="num">Placement</th><th className="num">Share of submitted</th></tr>
            </thead>
            <tbody>
              {byAgent.map(([name, a]) => (
                <tr key={name}>
                  <td><b>{name}</b></td>
                  <td className="num">{count(a.cases)}</td>
                  <td className="num">{money(a.submitted)}</td>
                  <td className="num">{money(a.paid)}</td>
                  <td className="num">{money(a.chargebacks)}</td>
                  <td className="num">{money(a.paid - a.chargebacks)}</td>
                  <td className="num">{percent(ratio(a.paid, a.submitted), 0)}</td>
                  <td className="num">{percent(ratio(a.submitted, t.submitted), 0)}</td>
                </tr>
              ))}
              {byAgent.length === 0 && <tr><td colSpan={8} className="muted">Nothing logged for this period yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Log a case</h2>
            <p className="muted small">Add each application when it&apos;s submitted, then change its status to Paid (or Chargeback) in the list below.</p>
          </div>
        </div>
        <form action={addCase} className="stack" style={{ gap: 12 }}>
          <input type="hidden" name="clientId" value={client.id} />
          <input type="hidden" name="returnTo" value={here} />
          <div className="form-grid">
            <label className="field">Date submitted<input name="date" type="date" defaultValue={today} required /></label>
            <label className="field">Client name<input name="clientName" placeholder="Jane Smith" required /></label>
            <label className="field">
              Agent
              <input name="agent" list="prod-agents" required defaultValue={client.agents[0]?.name ?? ""} />
            </label>
            <label className="field">
              Product
              <select name="product" defaultValue={PRODUCTS[0]}>{PRODUCTS.map((p) => <option key={p}>{p}</option>)}</select>
            </label>
            <label className="field">Carrier<input name="carrier" placeholder="Carrier name" /></label>
            <label className="field">Premium ($)<input name="premium" inputMode="decimal" placeholder="250,000" required /></label>
            <label className="field">
              Status
              <select name="status" defaultValue="Submitted">{CASE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            </label>
            <label className="field">
              Lead source
              <select name="source" defaultValue="">
                <option value="">—</option>
                {client.sources.map((s) => <option key={s.name}>{s.name}</option>)}
                <option>Referral</option>
                <option>Existing client</option>
              </select>
            </label>
          </div>
          <label className="field">Notes<input name="notes" placeholder="Optional" /></label>
          <div className="form-actions" style={{ marginTop: 0 }}><button className="btn primary" type="submit">Log case</button></div>
          <datalist id="prod-agents">{agentNames.map((n) => <option key={n} value={n} />)}</datalist>
        </form>
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div style={{ padding: "20px 20px 12px" }}>
          <h2>Cases · {label}</h2>
          <p className="muted small">{count(cases.length)} logged case{cases.length === 1 ? "" : "s"}. Changing a status saves right away.</p>
        </div>
        <CaseTable key={`${year}-${cases.length}`} clientId={client.id} entries={cases} />
      </section>

      <section className="card" id="history">
        <div className="card-head">
          <div>
            <h2>Historical numbers</h2>
            <p className="muted small">
              Load past production so the platform has the full history. Use totals per agent for a month or year when you don&apos;t have
              case-level detail, or import a spreadsheet of past cases. Saving totals for the same agent and period again replaces them.
            </p>
          </div>
        </div>
        <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>
          <form action={addTotal} className="stack" style={{ gap: 10 }}>
            <h3>Enter totals</h3>
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="returnTo" value={here} />
            <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label className="field">
                Period
                <select name="scope" defaultValue="month">
                  <option value="month">A month</option>
                  <option value="year">A whole year</option>
                </select>
              </label>
              <label className="field">Agent<input name="agent" list="prod-agents" required defaultValue={client.agents[0]?.name ?? ""} /></label>
              <label className="field">Month<input name="month" type="month" defaultValue={`${thisYear - 1}-01`} /><span className="hint">Used when Period is a month</span></label>
              <label className="field">Year<input name="year" type="number" min="2000" max="2100" defaultValue={thisYear - 1} /><span className="hint">Used when Period is a whole year</span></label>
              <label className="field">Submitted ($)<input name="submitted" inputMode="decimal" /></label>
              <label className="field">Paid ($)<input name="paid" inputMode="decimal" /></label>
              <label className="field">Chargebacks ($)<input name="chargebacks" inputMode="decimal" /></label>
              <label className="field">Number of cases<input name="cases" inputMode="numeric" /></label>
            </div>
            <div><button className="btn primary" type="submit">Save totals</button></div>
          </form>
          <form action={importProduction} className="stack" style={{ gap: 10 }}>
            <h3>Import a spreadsheet</h3>
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="returnTo" value={here} />
            <p className="small secondary" style={{ margin: 0 }}>
              Download a template, fill it in (Excel or Google Sheets), save as CSV and upload it. Agent names should match the agents in
              settings.
            </p>
            <div className="row">
              <a className="btn sm" href="/api/production/template?kind=cases">Cases template</a>
              <a className="btn sm" href="/api/production/template?kind=totals">Totals template</a>
            </div>
            <label className="field">CSV file<input name="file" type="file" accept=".csv,text/csv" /></label>
            <label className="field">
              Or paste CSV
              <textarea name="csv" rows={4} placeholder={"period,agent,submitted,paid,chargebacks,cases\n2024,Troy Sibley,16800000,12700000,1150000,92"} style={{ height: "auto", padding: 10, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }} />
            </label>
            {hasSamples && <label className="checkbox"><input type="checkbox" name="clearSamples" defaultChecked /> Remove sample entries first</label>}
            <div><button className="btn primary" type="submit">Import</button></div>
          </form>
        </div>
        <details style={{ marginTop: 20 }} open={totals.length > 0 && totals.length <= 12}>
          <summary style={{ cursor: "pointer" }}>
            <h3 style={{ display: "inline" }}>Historical totals · {label}</h3>{" "}
            <span className="muted small">({count(totals.length)} entr{totals.length === 1 ? "y" : "ies"})</span>
          </summary>
          <div style={{ marginTop: 8 }}>
            <TotalsTable key={`${year}-${totals.length}`} clientId={client.id} entries={totals} />
          </div>
        </details>
      </section>
    </div>
  );
}
