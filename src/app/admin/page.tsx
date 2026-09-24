import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ClientLogo } from "@/components/ClientLogo";
import { RangePicker } from "@/components/RangePicker";
import { requireAdmin } from "@/lib/auth";
import { count, money, percent } from "@/lib/format";
import { getDashboardData } from "@/lib/metrics";
import { resolveRange } from "@/lib/ranges";
import { readDb } from "@/lib/store";

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireAdmin();
  const range = resolveRange((await searchParams).range);
  const db = await readDb();
  const rows = await Promise.all(
    db.clients.map(async (client) => ({
      client,
      users: db.users.filter((u) => u.clientId === client.id).length,
      data: await getDashboardData(client, range),
    })),
  );

  const totals = rows.reduce(
    (t, r) => ({
      spend: t.spend + r.data.metrics.spend,
      leads: t.leads + r.data.metrics.leads,
      appointments: t.appointments + r.data.metrics.appointments,
      premium: t.premium + r.data.metrics.premium,
    }),
    { spend: 0, leads: 0, appointments: 0, premium: 0 },
  );

  return (
    <AppShell user={user} active="overview">
      <div className="stack">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>Client accounts</h1>
            <p className="muted small">Performance across every client · {range.label.toLowerCase()}</p>
          </div>
          <Link className="btn primary" href="/admin/clients/new">+ New client</Link>
        </div>

        <RangePicker basePath="/admin" active={range.key} />

        <section className="kpi-grid five" aria-label="All-client totals">
          <div className="kpi"><div className="label">Clients</div><div className="value">{rows.length}</div></div>
          <div className="kpi"><div className="label">Total marketing spend</div><div className="value">{money(totals.spend)}</div></div>
          <div className="kpi"><div className="label">Total leads</div><div className="value">{count(totals.leads)}</div></div>
          <div className="kpi"><div className="label">Connected appointments</div><div className="value">{count(totals.appointments)}</div></div>
          <div className="kpi"><div className="label">Submitted premium</div><div className="value">{money(totals.premium)}</div></div>
        </section>

        <section className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Data</th>
                  <th className="num">Marketing spend</th>
                  <th className="num">Leads</th>
                  <th className="num">CPL</th>
                  <th className="num">Appts</th>
                  <th className="num">Cost / appt</th>
                  <th className="num">Apps</th>
                  <th className="num">Sales conv.</th>
                  <th className="num">Premium</th>
                  <th className="num">Est. return</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ client, data, users }) => (
                  <tr key={client.id}>
                    <td>
                      <Link href={`/admin/clients/${client.id}?range=${range.key}`} className="row" style={{ textDecoration: "none", flexWrap: "nowrap" }}>
                        <ClientLogo client={client} size="sm" />
                        <span>
                          <b>{client.name}</b>
                          <br />
                          <span className="muted small">{users} login{users === 1 ? "" : "s"} · View dashboard →</span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className="badge">
                        <span className="dot" style={{ background: data.source === "ghl" ? "var(--good)" : "var(--ink-muted)" }} />
                        {data.source === "ghl" ? "Live" : "Sample"}
                      </span>
                    </td>
                    <td className="num">{money(data.metrics.spend)}</td>
                    <td className="num">{count(data.metrics.leads)}</td>
                    <td className="num">{money(data.metrics.costPerLead, true)}</td>
                    <td className="num">{count(data.metrics.appointments)}</td>
                    <td className="num">{money(data.metrics.costPerAppointment, true)}</td>
                    <td className="num">{count(data.metrics.applicants)}</td>
                    <td className="num">{percent(data.metrics.salesConversion)}</td>
                    <td className="num">{money(data.metrics.premium)}</td>
                    <td className="num">{percent(data.metrics.estimatedReturn, 0)}</td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                        <Link className="btn sm" href={`/admin/clients/${client.id}/settings`}>Settings</Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={12} className="muted" style={{ textAlign: "center", padding: 32 }}>No clients yet. Add your first one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
