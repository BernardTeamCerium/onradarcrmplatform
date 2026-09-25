import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { MarketingView } from "@/components/MarketingView";
import { requireUser } from "@/lib/auth";
import { resolveRange } from "@/lib/ranges";
import { getClient } from "@/lib/store";

export default async function ClientMarketingPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  if (user.role === "admin") redirect("/admin");
  const client = user.clientId ? await getClient(user.clientId) : null;
  if (!client) redirect("/dashboard");
  return (
    <AppShell user={user} client={client} active="dashboard">
      <div className="stack">
        <ClientHeader client={client} subtitle="Results by marketing source" />
        <ClientTabs base="/dashboard" active="marketing" />
        <MarketingView client={client} range={resolveRange((await searchParams).range)} basePath="/dashboard/marketing" />
      </div>
    </AppShell>
  );
}
