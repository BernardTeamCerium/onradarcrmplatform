import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { ProductionView } from "@/components/ProductionView";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ClientProductionPage({ searchParams }: { searchParams: Promise<{ year?: string; msg?: string }> }) {
  const user = await requireUser();
  if (user.role === "admin") redirect("/admin");
  const client = user.clientId ? await getClient(user.clientId) : null;
  if (!client) redirect("/dashboard");
  return (
    <AppShell user={user} client={client} active="dashboard">
      <div className="stack">
        <ClientHeader client={client} subtitle="Submitted, paid and chargebacks by agent" />
        <ClientTabs base="/dashboard" active="production" />
        <ProductionView client={client} basePath="/dashboard/production" search={await searchParams} />
      </div>
    </AppShell>
  );
}
