import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { PipelineView } from "@/components/PipelineView";
import { requireAdmin } from "@/lib/auth";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AdminPipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rep?: string; msg?: string }>;
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
        <ClientHeader client={client} subtitle="Prospects and results from Monday.com" />
        <ClientTabs base={`/admin/clients/${id}`} active="pipeline" admin />
        <PipelineView client={client} basePath={`/admin/clients/${id}/pipeline`} search={await searchParams} admin />
      </div>
    </AppShell>
  );
}
