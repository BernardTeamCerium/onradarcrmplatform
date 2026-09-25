import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { TrendsView } from "@/components/TrendsView";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/store";

export default async function ClientTrendsPage() {
  const user = await requireUser();
  if (user.role === "admin") redirect("/admin");
  const client = user.clientId ? await getClient(user.clientId) : null;
  if (!client) redirect("/dashboard");
  return (
    <AppShell user={user} client={client} active="dashboard">
      <div className="stack">
        <ClientHeader client={client} subtitle="Production, appointments and targets by year" />
        <ClientTabs base="/dashboard" active="trends" />
        <TrendsView client={client} />
      </div>
    </AppShell>
  );
}
