import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { PipelineView } from "@/components/PipelineView";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ClientPipelinePage({ searchParams }: { searchParams: Promise<{ rep?: string; msg?: string }> }) {
  const user = await requireUser();
  if (user.role === "admin") redirect("/admin");
  const client = user.clientId ? await getClient(user.clientId) : null;
  if (!client) redirect("/dashboard");
  return (
    <AppShell user={user} client={client} active="dashboard">
      <div className="stack">
        <ClientHeader client={client} subtitle="Pending business and past prospects" />
        <ClientTabs base="/dashboard" active="pipeline" />
        <PipelineView client={client} basePath="/dashboard/pipeline" search={await searchParams} />
      </div>
    </AppShell>
  );
}
