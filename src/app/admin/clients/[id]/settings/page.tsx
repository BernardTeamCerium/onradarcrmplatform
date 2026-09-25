import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { regenerateTypeformSecret } from "@/app/actions/leads";
import { headers } from "next/headers";
import {
  addSpend,
  createUser,
  deleteFigures,
  deleteYear,
  deleteClient,
  deleteSpend,
  deleteUser,
  removeLogo,
  resetPassword,
  saveFigures,
  saveAgents,
  saveSources,
  saveYear,
  testConnection,
  updateGhl,
  updateProfile,
} from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { money } from "@/lib/format";
import { usesLiveData } from "@/lib/metrics";
import { readDb } from "@/lib/store";
import type { YearRecord } from "@/lib/types";

const BLANK_YEAR: YearRecord = { year: 0, submitted: 0, paid: 0, chargebacks: 0, apptsSet: 0, connectedAppts: 0 };

function maskToken(token: string) {
  return token ? `${token.slice(0, 4)}…${token.slice(-4)}` : "not set";
}

export default async function ClientSettings({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string }>;
}) {
  const user = await requireAdmin();
  const { id } = await params;
  const { msg } = await searchParams;
  const db = await readDb();
  const client = db.clients.find((c) => c.id === id);
  if (!client) notFound();
  const users = db.users.filter((u) => u.clientId === id);
  const here = `/admin/clients/${id}/settings`;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const live = usesLiveData(client);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const webhookUrl = `${origin}/api/webhooks/typeform/${id}`;

  return (
    <AppShell user={user} active="overview">
      <div className="stack" style={{ maxWidth: 900 }}>
        <p className="small">
          <Link href="/admin" className="muted">← All clients</Link>
        </p>
        <ClientHeader client={client} subtitle="Client settings" />
        <ClientTabs base={`/admin/clients/${id}`} active="settings" admin />
        {msg && <p className="flash" role="status">{msg}</p>}

        {/* Profile */}
        <section className="card">
          <div className="card-head"><h2>Profile &amp; branding</h2></div>
          <form action={updateProfile} className="stack" style={{ gap: 16 }}>
            <input type="hidden" name="clientId" value={id} />
            <div className="form-grid">
              <label className="field">Company name<input name="name" defaultValue={client.name} required /></label>
              <label className="field">Industry<input name="industry" defaultValue={client.industry ?? ""} /></label>
              <label className="field">Brand color<input name="brandColor" type="color" defaultValue={client.brandColor} /></label>
              <label className="field">
                Average premium per application ($)
                <input name="averagePremium" type="number" min="0" step="1" defaultValue={client.averagePremium} />
                <span className="hint">Used when an application has no premium value in the CRM</span>
              </label>
              <label className="field">
                Agent name
                <input name="primaryAgent" defaultValue={client.primaryAgent ?? ""} placeholder="Troy Sibley" />
                <span className="hint">Shown as &ldquo;Submitted by …&rdquo; under submitted premium</span>
              </label>
              <label className="field">
                {client.logo ? "Replace logo" : "Upload logo"}
                <input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
                <span className="hint">PNG, JPG, WEBP or SVG, up to 2 MB. Transparent PNG or SVG looks best.</span>
              </label>
            </div>
            <div className="form-actions">
              <button className="btn primary" type="submit">Save profile</button>
            </div>
          </form>
          {client.logo && (
            <form action={removeLogo} style={{ marginTop: 8 }}>
              <input type="hidden" name="clientId" value={id} />
              <button className="btn sm danger" type="submit">Remove logo</button>
            </form>
          )}
        </section>

        {/* CRM connection */}
        <section className="card">
          <div className="card-head">
            <div>
              <h2>CRM connection</h2>
              <p className="muted small">
                In the client&apos;s CRM sub-account go to Settings → Private Integrations → Create, and grant read access to
                Contacts, Conversations, Opportunities, Calendars, Calendar Events and Locations.
              </p>
            </div>
            <span className="badge">
              <span className="dot" style={{ background: live ? "var(--good)" : "var(--ink-muted)" }} />
              {live ? "Live data" : "Showing sample data"}
            </span>
          </div>
          <form action={updateGhl} className="stack" style={{ gap: 16 }}>
            <input type="hidden" name="clientId" value={id} />
            <div className="form-grid">
              <label className="field">
                Location ID
                <input name="locationId" defaultValue={client.ghl.locationId} placeholder="e.g. ve9EPM428h8vShlRW1KT" />
                <span className="hint">Settings → Business Profile in the sub-account</span>
              </label>
              <label className="field">
                Private Integration token
                <input name="apiToken" type="password" autoComplete="off" placeholder={client.ghl.apiToken ? "Leave blank to keep current token" : "pit-…"} />
                <span className="hint">Current: {maskToken(client.ghl.apiToken)}</span>
              </label>
              <label className="field">
                Application stage keywords
                <input name="applicationStageKeywords" defaultValue={client.ghl.applicationStageKeywords.join(", ")} />
                <span className="hint">Opportunities at the first pipeline stage whose name contains one of these words, or any later stage, count as applications submitted</span>
              </label>
            </div>
            <label className="checkbox"><input type="checkbox" name="demoMode" defaultChecked={client.demoMode} /> Show sample data (turn off to go live)</label>
            {client.ghl.apiToken && (
              <label className="checkbox"><input type="checkbox" name="clearToken" /> Remove the saved token</label>
            )}
            <div className="form-actions">
              <button className="btn primary" type="submit">Save connection</button>
            </div>
          </form>
          <form action={testConnection} style={{ marginTop: 8 }}>
            <input type="hidden" name="clientId" value={id} />
            <button className="btn sm" type="submit">Test connection</button>
          </form>
        </section>

        {/* Agents */}
        <section className="card" id="agents">
          <div className="card-head">
            <div>
              <h2>Agents &amp; calendar</h2>
              <p className="muted small">
                Each agent gets their own view on the Calendar tab. With the CRM connected, add the agent&apos;s CRM user ID so their
                appointments are matched (otherwise agents are matched by name). Clear a name to remove an agent.
              </p>
            </div>
            <Link className="btn sm" href={`/admin/clients/${id}/calendar`}>Open calendar</Link>
          </div>
          <form action={saveAgents} className="stack" style={{ gap: 8 }}>
            <input type="hidden" name="clientId" value={id} />
            {[...client.agents, { id: "", name: "", crmUserId: "" }, { id: "", name: "", crmUserId: "" }].map((ag, i) => (
              <div className="form-grid" key={ag.id || `new${i}`} style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
                <input type="hidden" name="agentId" value={ag.id} />
                <label className="field">
                  {i === 0 ? "Agent name" : <span className="sr-only">Agent name</span>}
                  <input name="agentName" defaultValue={ag.name} placeholder={ag.id ? undefined : "Add an agent"} />
                </label>
                <label className="field">
                  {i === 0 ? "CRM user ID (optional)" : <span className="sr-only">CRM user ID</span>}
                  <input name="crmUserId" defaultValue={ag.crmUserId ?? ""} />
                </label>
              </div>
            ))}
            <label className="field" style={{ maxWidth: 320 }}>
              Calendar time zone
              <input name="timeZone" defaultValue={client.timeZone} />
              <span className="hint">For example America/Chicago (Central) or America/New_York (Eastern)</span>
            </label>
            <div className="form-actions"><button className="btn primary" type="submit">Save agents</button></div>
          </form>
        </section>

        {/* Marketing sources */}
        <section className="card" id="sources">
          <div className="card-head">
            <div>
              <h2>Marketing sources</h2>
              <p className="muted small">
                The sources on the Marketing tab, in order. Keywords match the lead source recorded in the CRM (for example
                &ldquo;fb, instagram&rdquo; for Facebook). Clear a name to remove a source.
              </p>
            </div>
            <Link className="btn sm" href={`/admin/clients/${id}/marketing`}>Open marketing</Link>
          </div>
          <form action={saveSources} className="stack" style={{ gap: 8 }}>
            <input type="hidden" name="clientId" value={id} />
            {[...client.sources, { name: "", match: [] }, { name: "", match: [] }].map((src, i) => (
              <div className="form-grid" key={i} style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)" }}>
                <label className="field">
                  {i === 0 ? "Source name" : <span className="sr-only">Source name</span>}
                  <input name="name" defaultValue={src.name} placeholder={i >= client.sources.length ? "Add a source" : undefined} />
                </label>
                <label className="field">
                  {i === 0 ? "CRM source keywords" : <span className="sr-only">CRM source keywords</span>}
                  <input name="match" defaultValue={src.match.join(", ")} />
                </label>
              </div>
            ))}
            <div className="form-actions"><button className="btn primary" type="submit">Save sources</button></div>
          </form>
        </section>

        {/* Marketing spend */}
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Marketing spend</h2>
              <p className="muted small">Monthly marketing spend drives cost per lead, cost per appointment and estimated return. Each month is spread evenly across its days.</p>
            </div>
          </div>
          <form action={addSpend} className="form-grid" style={{ alignItems: "end" }}>
            <input type="hidden" name="clientId" value={id} />
            <label className="field">Month<input name="month" type="month" defaultValue={thisMonth} required /></label>
            <label className="field">Amount ($)<input name="amount" type="number" min="0" step="0.01" required /></label>
            <label className="field">
              Source
              <select name="source" defaultValue="">
                <option value="">Unassigned</option>
                {client.sources.map((src) => (
                  <option key={src.name} value={src.name}>{src.name}</option>
                ))}
              </select>
            </label>
            <label className="field">Note<input name="note" placeholder="September TV buy" /></label>
            <div><button className="btn primary" type="submit">Add marketing spend</button></div>
          </form>
          {client.spend.length > 0 ? (
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead><tr><th>Month</th><th>Source</th><th className="num">Amount</th><th>Note</th><th /></tr></thead>
                <tbody>
                  {client.spend.map((s) => (
                    <tr key={s.id}>
                      <td>{new Date(`${s.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</td>
                      <td>{s.source ?? <span className="muted">Unassigned</span>}</td>
                      <td className="num">{money(s.amount, true)}</td>
                      <td className="muted">{s.note}</td>
                      <td style={{ textAlign: "right" }}>
                        <form action={deleteSpend}>
                          <input type="hidden" name="clientId" value={id} />
                          <input type="hidden" name="spendId" value={s.id} />
                          <button className="btn sm danger" type="submit">Remove</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small" style={{ marginTop: 12 }}>
              No marketing spend entered yet.{client.demoMode ? " Sample data uses generated spend until you add real numbers." : ""}
            </p>
          )}
        </section>

        {/* Typeform */}
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Typeform quiz</h2>
              <p className="muted small">
                Every quiz submission shows up on the client&apos;s Leads page within seconds, with all of their answers.
              </p>
            </div>
            <Link className="btn sm" href={`/admin/clients/${id}/leads`}>Open leads</Link>
          </div>
          <ol className="small secondary" style={{ margin: "0 0 16px", paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>In Typeform, open the quiz and go to <b>Connect → Webhooks → Add a webhook</b>.</li>
            <li>Paste the webhook URL below, then open the webhook&apos;s <b>Edit</b> settings and paste the secret.</li>
            <li>Turn the webhook <b>on</b>, then click <b>View deliveries → Send test request</b> to check it.</li>
          </ol>
          <div className="form-grid">
            <label className="field">
              Webhook URL
              <input readOnly value={webhookUrl} />
            </label>
            <label className="field">
              Secret
              <input readOnly value={client.typeformSecret} />
              <span className="hint">Typeform signs every submission with this, so nobody else can post fake leads.</span>
            </label>
          </div>
          <form action={regenerateTypeformSecret} style={{ marginTop: 12 }}>
            <input type="hidden" name="clientId" value={id} />
            <button className="btn sm" type="submit">Create a new secret</button>
          </form>
        </section>

        {/* Yearly results */}
        <section className="card" id="yearly">
          <div className="card-head">
            <div>
              <h2>Yearly results &amp; targets</h2>
              <p className="muted small">
                Drives the Trends tab. For the current year, enter year-to-date numbers; growth and &ldquo;what it takes&rdquo; use the full-year pace.
                Chargebacks target is a limit (lower is better). Leave a target blank to hide it.
              </p>
            </div>
            <Link className="btn sm" href={`/admin/clients/${id}/trends`}>Open trends</Link>
          </div>
          <div className="stack" style={{ gap: 12 }}>
            {[...[...client.yearly].sort((a, b) => b.year - a.year), BLANK_YEAR].map((y) => {
              const isNew = y === BLANK_YEAR;
              const v = (n?: number) => (n === undefined || isNew ? "" : String(n));
              return (
                <details key={isNew ? "new" : y.year} className="year-form">
                  <summary>
                    {isNew ? "+ Add a year" : (
                      <>
                        <b>{y.year}</b>
                        <span className="muted small"> · submitted {money(y.submitted)} · paid {money(y.paid)} · chargebacks {money(y.chargebacks)} · {y.connectedAppts} connected</span>
                      </>
                    )}
                  </summary>
                  <form action={saveYear} className="stack" style={{ gap: 12, marginTop: 12 }}>
                    <input type="hidden" name="clientId" value={id} />
                    <input type="hidden" name="originalYear" value={isNew ? "" : y.year} />
                    <div className="form-grid">
                      <label className="field">Year<input name="year" type="number" min="2000" max="2100" defaultValue={isNew ? new Date().getUTCFullYear() + 1 : y.year} required /></label>
                      <label className="field">Submitted ($)<input name="submitted" inputMode="decimal" defaultValue={v(y.submitted)} /></label>
                      <label className="field">Paid ($)<input name="paid" inputMode="decimal" defaultValue={v(y.paid)} /></label>
                      <label className="field">Chargebacks ($)<input name="chargebacks" inputMode="decimal" defaultValue={v(y.chargebacks)} /></label>
                      <label className="field">Appointments set<input name="apptsSet" inputMode="numeric" defaultValue={v(y.apptsSet)} /></label>
                      <label className="field">Connected appointments<input name="connectedAppts" inputMode="numeric" defaultValue={v(y.connectedAppts)} /></label>
                    </div>
                    <div className="form-grid">
                      <label className="field">Target submitted ($)<input name="targetSubmitted" inputMode="decimal" defaultValue={v(y.targetSubmitted)} /></label>
                      <label className="field">Target paid ($)<input name="targetPaid" inputMode="decimal" defaultValue={v(y.targetPaid)} /></label>
                      <label className="field">Chargebacks limit ($)<input name="targetChargebacks" inputMode="decimal" defaultValue={v(y.targetChargebacks)} /></label>
                      <label className="field">Target appts set<input name="targetApptsSet" inputMode="numeric" defaultValue={v(y.targetApptsSet)} /></label>
                      <label className="field">Target connected appts<input name="targetConnectedAppts" inputMode="numeric" defaultValue={v(y.targetConnectedAppts)} /></label>
                    </div>
                    <div className="form-actions" style={{ marginTop: 0 }}>
                      <button className="btn primary" type="submit">{isNew ? "Add year" : `Save ${y.year}`}</button>
                    </div>
                  </form>
                  {!isNew && (
                    <form action={deleteYear} style={{ marginTop: 8 }}>
                      <input type="hidden" name="clientId" value={id} />
                      <input type="hidden" name="year" value={y.year} />
                      <button className="btn sm danger" type="submit">Remove {y.year}</button>
                    </form>
                  )}
                </details>
              );
            })}
          </div>
        </section>

        {/* Monthly figures */}
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Monthly figures</h2>
              <p className="muted small">
                Enter a month&apos;s connected appointments and submitted premium by hand. While the dashboard shows sample
                data, these replace the sample numbers for that month exactly. Saving a month again overwrites it.
              </p>
            </div>
          </div>
          <form action={saveFigures} className="form-grid" style={{ alignItems: "end" }}>
            <input type="hidden" name="clientId" value={id} />
            <label className="field">Month<input name="month" type="month" defaultValue={thisMonth} required /></label>
            <label className="field">Connected appointments<input name="appointments" type="number" min="0" step="1" /></label>
            <label className="field">Submitted premium ($)<input name="premium" inputMode="decimal" placeholder="5,600,000" /></label>
            <div><button className="btn primary" type="submit">Save figures</button></div>
          </form>
          {client.figures.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead><tr><th>Month</th><th className="num">Connected appts</th><th className="num">Submitted premium</th><th /></tr></thead>
                <tbody>
                  {client.figures.map((f) => (
                    <tr key={f.id}>
                      <td>{new Date(`${f.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</td>
                      <td className="num">{f.appointments ?? "—"}</td>
                      <td className="num">{f.premium === undefined ? "—" : money(f.premium)}</td>
                      <td style={{ textAlign: "right" }}>
                        <form action={deleteFigures}>
                          <input type="hidden" name="clientId" value={id} />
                          <input type="hidden" name="figId" value={f.id} />
                          <button className="btn sm danger" type="submit">Remove</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Users */}
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Client logins</h2>
              <p className="muted small">These people sign in and see only {client.name}&apos;s dashboard.</p>
            </div>
          </div>
          {users.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: 16 }}>
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>New password</th><th /></tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>{u.email}</td>
                      <td>
                        <form action={resetPassword} className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="returnTo" value={here} />
                          <input name="password" type="password" minLength={8} placeholder="8+ characters" style={{ height: 30, minWidth: 140 }} />
                          <button className="btn sm" type="submit">Set</button>
                        </form>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <form action={deleteUser}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="returnTo" value={here} />
                          <button className="btn sm danger" type="submit">Remove</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form action={createUser} className="form-grid" style={{ alignItems: "end" }}>
            <input type="hidden" name="role" value="client" />
            <input type="hidden" name="clientId" value={id} />
            <input type="hidden" name="returnTo" value={here} />
            <label className="field">Name<input name="name" placeholder="Jane Smith" /></label>
            <label className="field">Email<input name="email" type="email" required /></label>
            <label className="field">Password<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label>
            <div><button className="btn primary" type="submit">Add login</button></div>
          </form>
        </section>

        {/* Danger zone */}
        <section className="card">
          <div className="card-head"><h2>Remove client</h2></div>
          <form action={deleteClient} className="row">
            <input type="hidden" name="clientId" value={id} />
            <input name="confirm" placeholder='Type DELETE' style={{ maxWidth: 200 }} aria-label="Type DELETE to confirm" />
            <button className="btn danger" type="submit">Remove client and its logins</button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
