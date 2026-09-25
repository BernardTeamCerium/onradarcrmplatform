import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { LeadsBoard } from "@/components/LeadsBoard";
import { requireUser } from "@/lib/auth";
import { listLeads } from "@/lib/leads";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ClientLeadsPage() {
  const user = await requireUser();
  if (user.role === "admin") redirect("/admin");
  const client = user.clientId ? await getClient(user.clientId) : null;
  if (!client) redirect("/dashboard");
  const leads = (await listLeads(client.id)).slice(0, 300);
  return (
    <AppShell user={user} client={client} active="dashboard">
      <div className="stack">
        <ClientHeader client={client} subtitle="Every quiz lead, with their answers and where they stand" />
        <ClientTabs base="/dashboard" active="leads" />
        <LeadsBoard clientId={client.id} initialLeads={leads} isAdmin={false} />
      </div>
    </AppShell>
  );
}
