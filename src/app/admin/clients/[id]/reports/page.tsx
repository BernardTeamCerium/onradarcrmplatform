import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { ReportsView } from "@/components/ReportsView";
import { requireAdmin } from "@/lib/auth";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; agent?: string; source?: string }>;
}) {
  const user = await requireAdmin();
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();
  return (
    <AppShell user={user} active="overview">
      <p className="small" style={{ marginBottom: 12 }}>
        <Link href="/admin" className="muted">← All clients</Link>
      </p>
      <div className="stack">
        <ClientHeader client={client} subtitle="The numbers in depth, month by month" />
        <ClientTabs base={`/admin/clients/${id}`} active="reports" admin />
        <ReportsView client={client} basePath={`/admin/clients/${id}/reports`} search={await searchParams} admin />
      </div>
    </AppShell>
  );
}
