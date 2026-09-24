import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientDashboard } from "@/components/ClientDashboard";
import { requireAdmin } from "@/lib/auth";
import { resolveRange } from "@/lib/ranges";
import { getClient } from "@/lib/store";

export default async function AdminClientDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireAdmin();
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();
  return (
    <AppShell user={user} active="overview">
      <p className="small" style={{ marginBottom: 12 }}>
        <Link href="/admin" className="muted">← All clients</Link>
        <span className="muted"> · Viewing exactly what {client.name} sees</span>
      </p>
      <ClientDashboard client={client} range={resolveRange((await searchParams).range)} basePath={`/admin/clients/${id}`} adminView />
    </AppShell>
  );
}
