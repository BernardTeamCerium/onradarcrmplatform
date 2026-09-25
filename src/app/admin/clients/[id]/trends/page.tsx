import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { TrendsView } from "@/components/TrendsView";
import { requireAdmin } from "@/lib/auth";
import { getClient } from "@/lib/store";

export default async function AdminTrendsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();
  return (
    <AppShell user={user} active="overview">
      <p className="small" style={{ marginBottom: 12 }}>
        <Link href="/admin" className="muted">← All clients</Link>
        <span className="muted"> · Edit these numbers under </span>
        <Link href={`/admin/clients/${id}/settings#yearly`} className="muted">Settings → Yearly results &amp; targets</Link>
      </p>
      <div className="stack">
        <ClientHeader client={client} subtitle="Production, appointments and targets by year" />
        <ClientTabs base={`/admin/clients/${id}`} active="trends" admin />
        <TrendsView client={client} />
      </div>
    </AppShell>
  );
}
