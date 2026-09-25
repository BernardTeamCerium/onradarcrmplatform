import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CalendarView } from "@/components/CalendarView";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { requireAdmin } from "@/lib/auth";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AdminCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string; day?: string; agent?: string }>;
}) {
  const user = await requireAdmin();
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();
  return (
    <AppShell user={user} active="overview">
      <p className="small" style={{ marginBottom: 12 }}>
        <Link href="/admin" className="muted">← All clients</Link>
        <span className="muted"> · Agents are set under </span>
        <Link href={`/admin/clients/${id}/settings#agents`} className="muted">Settings</Link>
      </p>
      <div className="stack">
        <ClientHeader client={client} subtitle="Appointments by agent" />
        <ClientTabs base={`/admin/clients/${id}`} active="calendar" admin />
        <CalendarView client={client} basePath={`/admin/clients/${id}/calendar`} search={await searchParams} />
      </div>
    </AppShell>
  );
}
