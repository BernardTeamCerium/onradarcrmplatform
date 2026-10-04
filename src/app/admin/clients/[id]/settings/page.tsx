import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { importEmailLead, importTypeformResponses, regenerateInboundKey, regenerateTypeformSecret } from "@/app/actions/leads";
import { gmailScript } from "@/lib/inbound";
import { headers } from "next/headers";
import {
  addSpend,
  createUser,
  deleteFigures,
  deleteYear,
  deleteClient,
  goLive,
  savePipelineStages,
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
import { isSampleAgent, readDb } from "@/lib/store";
import { isSampleLead, listLeads } from "@/lib/leads";
import { connectMonday, disconnectMonday, saveMondayMapping } from "@/app/actions/monday";
import { loadSnapshot } from "@/lib/monday";
import { stagesFor, STUCK_DAYS } from "@/lib/stages";
import { loadProduction } from "@/lib/production";
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
  const emailUrl = `${origin}/api/leads/${id}/email?key=${client.inboundKey}`;
  const inboundUrl = `${origin}/api/leads/${id}/inbound?key=${client.inboundKey}`;
  const productionEmailUrl = `${origin}/api/production/${id}/email?key=${client.inboundKey}`;
  const monday = client.monday;
  const mondaySnap = monday ? await loadSnapshot(id) : null;
  const mondayStages = mondaySnap
    ? [...new Set([...mondaySnap.stages, ...mondaySnap.items.map((it) => (monday?.columns.stage ? it.values[monday.columns.stage]?.trim() : "")).filter((x): x is string => !!x)])]
    : [];
  const MONDAY_FIELDS: [keyof NonNullable<typeof monday>["columns"], string, string][] = [
    ["stage", "Stage", "Status column with the deal stages (In Review … Paid)"],
    ["value", "Deal value", "Numbers column with each deal's amount"],
    ["actual", "Actual (paid) value", "Optional: used for won deals when filled in"],
    ["owner", "Rep / owner", "People column"],
    ["closeDate", "Close date", "Date column; won deals are charted by it"],
    ["source", "Lead source", "Optional"],
    ["product", "Product or carrier", "Optional"],
  ];
  const sampleLeadCount = (await listLeads(id)).filter(isSampleLead).length;
  const sampleProduction = (await loadProduction(client)).filter((e) => e.sample).length;
  const sampleAgents = client.agents.filter(isSampleAgent);
  const leftovers = [
    client.demoMode && "sample dashboard numbers are on",
    client.calendarSamples !== false && "sample appointments are on",
    sampleLeadCount && `${sampleLeadCount} sample/test lead${sampleLeadCount === 1 ? "" : "s"}`,
    sampleProduction && `${sampleProduction} sample production entr${sampleProduction === 1 ? "y" : "ies"}`,
    client.figures.length && `${client.figures.length} monthly figure override${client.figures.length === 1 ? "" : "s"}`,
    sampleAgents.length && `sample agent${sampleAgents.length === 1 ? "" : "s"} ${sampleAgents.map((a) => a.name).join(", ")}`,
  ].filter(Boolean) as string[];

  return (
    <AppShell user={user} active="overview">
      <div className="stack" style={{ maxWidth: 900 }}>
        <p className="small">
          <Link href="/admin" className="muted">← All clients</Link>
        </p>
        <ClientHeader client={client} subtitle="Client settings" />
        <ClientTabs base={`/admin/clients/${id}`} active="settings" admin />
        {msg && <p className="flash" role="status">{msg}</p>}

        {/* Go live */}
        <section className="card" id="go-live">
          <div className="card-head">
            <div>
              <h2>Go live</h2>
              <p className="muted small">
                {leftovers.length
                  ? "Turns off sample data everywhere and removes every piece of it in one step. Yearly results, marketing spend, logged production, real leads and all settings are kept."
                  : "This client is live: no sample data is shown or stored."}
              </p>
            </div>
            <span className="badge">
              <span className="dot" style={{ background: client.demoMode ? "var(--ink-muted)" : "var(--good)" }} />
              {client.demoMode ? "Demo" : live ? "Live from CRM" : "Live"}
            </span>
          </div>
          {leftovers.length > 0 && (
            <>
              <p className="small">Still in place: {leftovers.join("; ")}.</p>
              {!client.ghl.apiToken && (
                <p className="notice small">
                  The CRM isn&apos;t connected yet. Once live, the dashboard counts leads from the Leads tab (Typeform, Gmail and
                  webhook leads) and moves them through the funnel by status, with your entered spend and production. Texts, emails
                  and calls start counting when the CRM is connected.
                </p>
              )}
              <form action={goLive} className="row" style={{ alignItems: "flex-end" }}>
                <input type="hidden" name="clientId" value={id} />
                <label className="field">
                  Type GO LIVE to confirm
                  <input name="confirm" autoComplete="off" placeholder="GO LIVE" required />
                </label>
                <button className="btn primary" type="submit">Go live</button>
              </form>
            </>
          )}
        </section>

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
            {[...client.agents, { id: "", name: "", crmUserId: "", googleIcsUrl: "" }, { id: "", name: "", crmUserId: "", googleIcsUrl: "" }].map((ag, i) => (
              <div className="form-grid" key={ag.id || `new${i}`} style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr)" }}>
                <input type="hidden" name="agentId" value={ag.id} />
                <label className="field">
                  {i === 0 ? "Agent name" : <span className="sr-only">Agent name</span>}
                  <input name="agentName" defaultValue={ag.name} placeholder={ag.id ? undefined : "Add an agent"} />
                </label>
                <label className="field">
                  {i === 0 ? "CRM user ID (optional)" : <span className="sr-only">CRM user ID</span>}
                  <input name="crmUserId" defaultValue={ag.crmUserId ?? ""} />
                </label>
                <label className="field">
                  {i === 0 ? "Google Calendar secret iCal address (optional)" : <span className="sr-only">Google Calendar address</span>}
                  <input name="googleIcsUrl" type="url" defaultValue={ag.googleIcsUrl ?? ""} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
                </label>
              </div>
            ))}
            <p className="small secondary" style={{ margin: 0 }}>
              <b>Google Calendar:</b> the agent opens Google Calendar on a computer → Settings (gear) → their calendar under &ldquo;Settings for my
              calendars&rdquo; → <b>Integrate calendar</b> → copy <b>Secret address in iCal format</b> and paste it here. Events show on the Calendar tab
              within about 5 minutes (read-only). Treat the address like a password.
            </p>
            <label className="checkbox">
              <input type="checkbox" name="calendarSamples" defaultChecked={client.calendarSamples !== false} /> Show sample appointments (turn off once
              real calendars are connected)
            </label>
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
        <section className="card" id="typeform">
          <div className="card-head">
            <div>
              <h2>Typeform quiz</h2>
              <p className="muted small">
                Every quiz submission shows up on the client&apos;s Leads page within seconds with everything Typeform sends: every answer
                (including grouped and address questions), hidden fields such as UTM tags, the quiz score and variables, and time to complete.
                Add <code>?utm_source=facebook</code> (or tv, radio, tiktok, youtube…) to each ad&apos;s quiz link and the lead is credited to that
                marketing source.
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

          <h3 style={{ margin: "20px 0 6px" }}>Import past responses</h3>
          <p className="small secondary" style={{ margin: "0 0 10px" }}>
            Brings in every completed response already in Typeform, including ones from before the webhook was set up. Responses already on the
            Leads tab are skipped, so you can run it again any time. Create a token in Typeform under <b>Account → Your settings → Personal
            tokens</b> with <b>Forms: read</b> and <b>Responses: read</b>.
          </p>
          <form action={importTypeformResponses} className="stack" style={{ gap: 10 }}>
            <input type="hidden" name="clientId" value={id} />
            <div className="form-grid">
              <label className="field">
                Personal access token
                <input name="token" type="password" autoComplete="off" placeholder={client.typeformApi?.token ? "Saved (leave blank to keep)" : "tfp_…"} />
              </label>
              <label className="field">
                Form ID or quiz link
                <input name="formIds" defaultValue={client.typeformApi?.formIds.join(", ") ?? ""} placeholder="AbC123xy or https://….typeform.com/to/AbC123xy" required />
                <span className="hint">Separate several forms with commas</span>
              </label>
              <label className="field">
                Typeform data center
                <select name="region" defaultValue={client.typeformApi?.region ?? "us"}>
                  <option value="us">Standard (US)</option>
                  <option value="eu">EU</option>
                </select>
              </label>
            </div>
            <div className="form-actions" style={{ marginTop: 0 }}>
              <button className="btn primary" type="submit">{client.typeformApi ? "Import again" : "Import all responses"}</button>
              {client.typeformApi?.lastImportAt && (
                <span className="muted small">
                  Last run {new Date(client.typeformApi.lastImportAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}:{" "}
                  {client.typeformApi.lastResult}
                </span>
              )}
            </div>
          </form>
        </section>

        {/* Email leads */}
        <section className="card" id="email-leads">
          <div className="card-head">
            <div>
              <h2>Email leads (Gmail)</h2>
              <p className="muted small">
                Lead emails from vendors land on the Leads tab automatically. The reader picks out name, email, phone, city, state and source
                from lines like &ldquo;Phone: 985-555-0142&rdquo;, and keeps every other line as an answer.
              </p>
            </div>
            <Link className="btn sm" href={`/admin/clients/${id}/leads`}>Open leads</Link>
          </div>
          <h3 style={{ marginBottom: 6 }}>Set up Gmail (one time, about 5 minutes)</h3>
          <ol className="small secondary" style={{ margin: "0 0 12px", paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>Sign in to the Gmail account that receives the lead emails, then open <b>script.google.com</b> → <b>New project</b>.</li>
            <li>Delete what&apos;s there, paste the script below, and click <b>Save</b>.</li>
            <li>Choose <b>setup</b> in the function menu and click <b>Run</b>. Approve the Google permissions it asks for.</li>
            <li>
              In Gmail, create a filter for the vendor&apos;s emails (for example <i>from:leads@vendor.com</i>) with <b>Apply the label</b> → <b>OnRadar Leads</b>.
              You can also add that label to any email by hand.
            </li>
            <li>
              Every 5 minutes, labelled emails are sent here and relabelled <b>OnRadar Leads/Imported</b>. Emails stay in the inbox: the script
              never archives, deletes or marks anything read. In the filter, leave <b>Skip the Inbox</b> unticked.
            </li>
          </ol>
          <label className="field">
            Gmail script for {client.name}
            <textarea readOnly rows={10} value={gmailScript(emailUrl)} style={{ height: "auto", padding: 10, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }} />
            <span className="hint">The script contains this client&apos;s private key, so only paste it into your own Google account.</span>
          </label>
          <details style={{ marginTop: 12 }}>
            <summary className="small" style={{ cursor: "pointer" }}>Other ways to send leads (Zapier, lead vendors, email services)</summary>
            <div className="form-grid" style={{ marginTop: 10 }}>
              <label className="field">
                Lead email address URL
                <input readOnly value={emailUrl} />
                <span className="hint">POST subject, from, text and/or html (Postmark and Mailgun inbound work as-is)</span>
              </label>
              <label className="field">
                Lead webhook URL (fields)
                <input readOnly value={inboundUrl} />
                <span className="hint">POST fields like first_name, last_name, email, phone, city, state, source; add &amp;source=Facebook to set a source</span>
              </label>
            </div>
            <form action={regenerateInboundKey} style={{ marginTop: 8 }}>
              <input type="hidden" name="clientId" value={id} />
              <button className="btn sm" type="submit">Create a new key</button>
            </form>
          </details>
          <h3 style={{ margin: "18px 0 6px" }}>Or paste a lead email</h3>
          <form action={importEmailLead} className="stack" style={{ gap: 10 }}>
            <input type="hidden" name="clientId" value={id} />
            <div className="form-grid">
              <label className="field">Subject<input name="subject" placeholder="New lead: Margaret Doucet" /></label>
              <label className="field">From<input name="from" placeholder="Lead Seller #1 <leads@vendor.com>" /></label>
            </div>
            <label className="field">
              Email body
              <textarea name="body" rows={6} required placeholder={"First Name: Margaret\nLast Name: Doucet\nPhone: (985) 555-0142\nEmail: margaret@example.com\nCity: Covington\nState: LA\nRetirement savings: $500k-$1M"} style={{ height: "auto", padding: 10 }} />
            </label>
            <div className="form-actions" style={{ marginTop: 0 }}><button className="btn primary" type="submit">Add to Leads</button></div>
          </form>
        </section>

        {/* Production emails */}
        <section className="card" id="production-email">
          <div className="card-head">
            <div>
              <h2>Production emails (Gmail)</h2>
              <p className="muted small">
                Case status emails from the IMO or carrier update the Production tab automatically. Each email is read for the case number,
                carrier, product, advisor, client, premium and the status in the subject. A new case number adds a case, and later emails for the
                same number update it (an &ldquo;Issued&rdquo; or &ldquo;Paid&rdquo; status marks it paid). The advisor is matched to an agent by name, so
                &ldquo;Christopher Troy Sibley&rdquo; is credited to Troy Sibley.
              </p>
            </div>
            <Link className="btn sm" href={`/admin/clients/${id}/production`}>Open production</Link>
          </div>
          <h3 style={{ marginBottom: 6 }}>Set up Gmail (one time, about 5 minutes)</h3>
          <ol className="small secondary" style={{ margin: "0 0 12px", paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>In the Gmail account that receives the status emails, open <b>script.google.com</b> → <b>New project</b> (a separate project from the lead script).</li>
            <li>Paste the script below, click <b>Save</b>, choose <b>setup</b> and click <b>Run</b>. Approve the Google permissions.</li>
            <li>
              In Gmail, create a filter that matches the status emails, for example <i>from:(@retireaef.com) subject:(&quot;Status Update&quot;)</i>, with{" "}
              <b>Apply the label</b> → <b>OnRadar Production</b>. Tick <b>Also apply filter to matching conversations</b> to bring in past emails too.
            </li>
            <li>Every 5 minutes, labelled emails are sent here and relabelled <b>OnRadar Production/Imported</b>. They stay in the inbox, unread or read as they were.</li>
          </ol>
          <label className="field">
            Gmail script for {client.name}
            <textarea readOnly rows={10} value={gmailScript(productionEmailUrl, "OnRadar Production", "case status emails", "Production tab")} style={{ height: "auto", padding: 10, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }} />
            <span className="hint">The script contains this client&apos;s private key, so only paste it into your own Google account. Anyone can also paste a single email on the Production tab.</span>
          </label>
          <details style={{ marginTop: 12 }}>
            <summary className="small" style={{ cursor: "pointer" }}>Other ways to send status emails (Zapier, email services)</summary>
            <label className="field" style={{ marginTop: 10 }}>
              Production email URL
              <input readOnly value={productionEmailUrl} />
              <span className="hint">POST subject, from, date, text and/or html (Postmark and Mailgun inbound work as-is)</span>
            </label>
          </details>
        </section>

        {/* Pipeline stages */}
        <section className="card" id="stages">
          <div className="card-head">
            <div>
              <h2>Pipeline stages</h2>
              <p className="muted small">
                The columns of the pending-business board on the Pipeline tab, in order, one per line. Status emails are placed by stage name
                (and common wording such as &ldquo;check mailed&rdquo; → Funds En Route). Cases {STUCK_DAYS}+ days in one stage are flagged as stuck.
              </p>
            </div>
          </div>
          <form action={savePipelineStages} className="stack" style={{ gap: 10 }}>
            <input type="hidden" name="clientId" value={id} />
            <textarea name="stages" rows={8} defaultValue={stagesFor(client).join("\n")} style={{ height: "auto", padding: 10, maxWidth: 360 }} aria-label="Pipeline stages" />
            {client.pipelineStages && <label className="checkbox"><input type="checkbox" name="reset" /> Reset to the default stages</label>}
            <div><button className="btn primary" type="submit">Save stages</button></div>
          </form>
        </section>

        {/* Monday.com */}
        <section className="card" id="monday">
          <div className="card-head">
            <div>
              <h2>Monday.com pipeline</h2>
              <p className="muted small">
                Brings the client&apos;s Monday.com deals board (past and current prospects) into the <b>Pipeline</b> tab: open pipeline, paid
                deals, stages, results by rep and every prospect. It refreshes on its own every 30 minutes, and the team can refresh on
                demand. Read-only: nothing is changed in Monday.com.
              </p>
            </div>
            <span className="badge">
              <span className="dot" style={{ background: mondaySnap ? "var(--good)" : "var(--ink-muted)" }} />
              {mondaySnap ? `${mondaySnap.items.length.toLocaleString("en-US")} items` : "Not connected"}
            </span>
          </div>
          <form action={connectMonday} className="stack" style={{ gap: 12 }}>
            <input type="hidden" name="clientId" value={id} />
            <div className="form-grid">
              <label className="field">
                API token
                <input name="token" type="password" autoComplete="off" placeholder={monday?.token ? "Leave blank to keep the current token" : "eyJhbGciOi…"} />
                <span className="hint">In Monday.com: your avatar → <b>Developers</b> → <b>My access tokens</b> → Copy. Use an account that can see the board.</span>
              </label>
              <label className="field">
                Deals board link
                <input name="board" defaultValue={monday ? (mondaySnap?.accountSlug ? `https://${mondaySnap.accountSlug}.monday.com/boards/${monday.boardId}` : monday.boardId) : ""} placeholder="https://yourteam.monday.com/boards/1234567890" />
                <span className="hint">Open the deals board (the one behind the Sales Pipeline dashboard) and copy the address bar</span>
              </label>
            </div>
            {monday?.lastResult && <p className="small secondary" style={{ margin: 0 }}>Last sync: {monday.lastResult}</p>}
            <div className="form-actions" style={{ marginTop: 0 }}>
              <button className="btn primary" type="submit">{monday ? "Save and sync now" : "Connect and sync"}</button>
              {monday && <Link className="btn" href={`/admin/clients/${id}/pipeline`}>Open pipeline</Link>}
            </div>
          </form>

          {monday && mondaySnap && (
            <form action={saveMondayMapping} className="stack" style={{ gap: 12, marginTop: 20 }}>
              <input type="hidden" name="clientId" value={id} />
              <h3 style={{ margin: 0 }}>Columns on “{mondaySnap.boardName}”</h3>
              <p className="small secondary" style={{ margin: 0 }}>These were matched from the column names. Change any that are wrong.</p>
              <div className="form-grid">
                {MONDAY_FIELDS.map(([key, label, hint]) => (
                  <label className="field" key={key}>
                    {label}
                    <select name={key} defaultValue={monday.columns[key] ?? ""}>
                      <option value="">—</option>
                      {mondaySnap.columns.filter((c) => c.id !== "name").map((c) => (
                        <option key={c.id} value={c.id}>{c.title} ({c.type})</option>
                      ))}
                    </select>
                    <span className="hint">{hint}</span>
                  </label>
                ))}
              </div>
              {mondayStages.length > 0 && (
                <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>
                  <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Won (paid) stages</legend>
                    <div className="stack" style={{ gap: 4 }}>
                      {mondayStages.map((st) => (
                        <label key={st} className="checkbox"><input type="checkbox" name="won" value={st} defaultChecked={monday.wonStages.includes(st)} /> {st}</label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Lost stages</legend>
                    <div className="stack" style={{ gap: 4 }}>
                      {mondayStages.map((st) => (
                        <label key={st} className="checkbox"><input type="checkbox" name="lost" value={st} defaultChecked={monday.lostStages.includes(st)} /> {st}</label>
                      ))}
                    </div>
                    <span className="hint">Every other stage counts as open pipeline.</span>
                  </fieldset>
                </div>
              )}
              <div className="form-actions" style={{ marginTop: 0 }}><button className="btn primary" type="submit">Save mapping</button></div>
            </form>
          )}
          {monday && (
            <form action={disconnectMonday} style={{ marginTop: 12 }}>
              <input type="hidden" name="clientId" value={id} />
              <button className="btn sm danger" type="submit">Disconnect Monday.com</button>
            </form>
          )}
        </section>

        {/* Yearly results */}
        <section className="card" id="yearly">
          <div className="card-head">
            <div>
              <h2>Yearly results &amp; targets</h2>
              <p className="muted small">
                Drives the Trends tab. For the current year, enter year-to-date numbers; growth and &ldquo;what it takes&rdquo; use the full-year pace.
                Chargebacks target is a limit (lower is better). Leave a target blank to hide it. Years with entries on the Production tab use the logged submitted, paid and chargebacks instead of the numbers here.
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
