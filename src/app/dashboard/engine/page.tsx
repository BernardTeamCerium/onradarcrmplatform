import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { EngineView } from "@/components/EngineView";
import { requireUser } from "@/lib/auth";
import { resolveRange } from "@/lib/ranges";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ClientEnginePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  if (user.role === "admin") redirect("/admin");
  const client = user.clientId ? await getClient(user.clientId) : null;
  if (!client) redirect("/dashboard");
  return (
    <AppShell user={user} client={client} active="dashboard">
      <div className="stack">
        <ClientHeader client={client} subtitle="Outreach activity: texts, emails, calls and conversations" />
        <ClientTabs base="/dashboard" active="engine" />
        <EngineView client={client} range={resolveRange((await searchParams).range)} basePath="/dashboard/engine" />
      </div>
    </AppShell>
  );
}
