import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientLogo } from "@/components/ClientLogo";
import {
  addSpend,
  createUser,
  deleteFigures,
  deleteClient,
  deleteSpend,
  deleteUser,
  removeLogo,
  resetPassword,
  saveFigures,
  testConnection,
  updateGhl,
  updateProfile,
} from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { money } from "@/lib/format";
import { usesLiveData } from "@/lib/metrics";
import { readDb } from "@/lib/store";

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

  return (
    <AppShell user={user} active="overview">
      <div className="stack" style={{ maxWidth: 900 }}>
        <p className="small">
          <Link href="/admin" className="muted">← All clients</Link>
        </p>
        <div className="client-header">
          <ClientLogo client={client} />
          <div className="titles">
            <h1>{client.name}</h1>
            <p className="muted small">Client settings</p>
          </div>
          <Link className="btn" href={`/admin/clients/${id}`}>View dashboard</Link>
        </div>
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
            <label className="field">Note<input name="note" placeholder="Facebook + Google" /></label>
            <div><button className="btn primary" type="submit">Add marketing spend</button></div>
          </form>
          {client.spend.length > 0 ? (
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead><tr><th>Month</th><th className="num">Amount</th><th>Note</th><th /></tr></thead>
                <tbody>
                  {client.spend.map((s) => (
                    <tr key={s.id}>
                      <td>{new Date(`${s.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</td>
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
