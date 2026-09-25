import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { MarketingView } from "@/components/MarketingView";
import { requireAdmin } from "@/lib/auth";
import { resolveRange } from "@/lib/ranges";
import { getClient } from "@/lib/store";

export default async function AdminMarketingPage({
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
        <span className="muted"> · Sources and spend by source are set under </span>
        <Link href={`/admin/clients/${id}/settings#sources`} className="muted">Settings</Link>
      </p>
      <div className="stack">
        <ClientHeader client={client} subtitle="Results by marketing source" />
        <ClientTabs base={`/admin/clients/${id}`} active="marketing" admin />
        <MarketingView client={client} range={resolveRange((await searchParams).range)} basePath={`/admin/clients/${id}/marketing`} />
      </div>
    </AppShell>
  );
}
