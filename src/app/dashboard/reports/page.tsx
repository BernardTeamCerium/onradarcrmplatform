import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { ReportsView } from "@/components/ReportsView";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/store";
import { tabHidden } from "@/lib/tabs";

export const dynamic = "force-dynamic";

export default async function ClientReportsPage({ searchParams }: { searchParams: Promise<{ year?: string; agent?: string; source?: string }> }) {
  const user = await requireUser();
  if (user.role === "admin") redirect("/admin");
  const client = user.clientId ? await getClient(user.clientId) : null;
  if (!client) redirect("/dashboard");
  if (tabHidden(client, "reports")) redirect("/dashboard");
  return (
    <AppShell user={user} client={client} active="dashboard">
      <div className="stack">
        <ClientHeader client={client} subtitle="The numbers in depth, month by month" />
        <ClientTabs base="/dashboard" active="reports" hidden={client.hiddenTabs} />
        <ReportsView client={client} basePath="/dashboard/reports" search={await searchParams} />
      </div>
    </AppShell>
  );
}
