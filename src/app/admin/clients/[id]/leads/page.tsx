import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { LeadsBoard } from "@/components/LeadsBoard";
import { requireAdmin } from "@/lib/auth";
import { listBooked } from "@/lib/appointments";
import { isSampleLead, listLeads } from "@/lib/leads";
import { bulkDeleteLeads } from "@/app/actions/leads";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AdminLeadsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const user = await requireAdmin();
  const { id } = await params;
  const { msg } = await searchParams;
  const client = await getClient(id);
  if (!client) notFound();
  const all = await listLeads(id);
  const leads = all.slice(0, 300);
  const n = (f: (l: (typeof all)[number]) => boolean) => all.filter(f).length;
  const scopes: [string, string, number][] = [
    ["all", "All leads", all.length],
    ["email", "Email leads (Gmail)", n((l) => l.channel === "email")],
    ["typeform", "Typeform quiz leads", n((l) => (l.channel ?? "typeform") === "typeform")],
    ["api", "Webhook / Zapier leads", n((l) => l.channel === "api")],
    ["sample", "Sample and test leads", n(isSampleLead)],
  ];
  return (
    <AppShell user={user} active="overview">
      <p className="small" style={{ marginBottom: 12 }}>
        <Link href="/admin" className="muted">← All clients</Link>
      </p>
      <div className="stack">
        <ClientHeader client={client} subtitle="Every quiz lead, with their answers and where they stand" />
        <ClientTabs base={`/admin/clients/${id}`} active="leads" admin />
        {msg && <p className="flash" role="status">{msg}</p>}
        <LeadsBoard key={`${all.length}-${msg ?? ""}`} clientId={id} initialLeads={leads} isAdmin agents={client.agents} bookings={await listBooked(id)} calendarBase={`/admin/clients/${id}/calendar`} />

        <section className="card" id="delete-leads">
          <div className="card-head">
            <div>
              <h2>Delete leads</h2>
              <p className="muted small">
                Removes leads from OnRadar only (nothing is changed in Gmail or Typeform), along with any appointments booked for them. This
                can&apos;t be undone. To bring email leads back later, re-add the <b>OnRadar Leads</b> label to those emails in Gmail.
              </p>
            </div>
          </div>
          <form action={bulkDeleteLeads} className="stack" style={{ gap: 12 }}>
            <input type="hidden" name="clientId" value={id} />
            <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack">
              <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Which leads</legend>
              {scopes.map(([value, label, count]) => (
                <label key={value} className="checkbox">
                  <input type="radio" name="scope" value={value} required /> {label}{" "}
                  <span className="muted small">({count})</span>
                </label>
              ))}
            </fieldset>
            <div className="form-grid">
              <label className="field">
                Only received on or before (optional)
                <input type="date" name="before" />
              </label>
              <label className="field">
                Type DELETE to confirm
                <input name="confirm" autoComplete="off" placeholder="DELETE" required />
              </label>
            </div>
            <div><button className="btn danger" type="submit">Delete leads</button></div>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
