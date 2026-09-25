import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { LeadsBoard } from "@/components/LeadsBoard";
import { requireAdmin } from "@/lib/auth";
import { listLeads } from "@/lib/leads";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AdminLeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();
  const leads = (await listLeads(id)).slice(0, 300);
  return (
    <AppShell user={user} active="overview">
      <p className="small" style={{ marginBottom: 12 }}>
        <Link href="/admin" className="muted">← All clients</Link>
      </p>
      <div className="stack">
        <ClientHeader client={client} subtitle="Every quiz lead, with their answers and where they stand" />
        <ClientTabs base={`/admin/clients/${id}`} active="leads" admin />
        <LeadsBoard clientId={id} initialLeads={leads} isAdmin />
      </div>
    </AppShell>
  );
}
