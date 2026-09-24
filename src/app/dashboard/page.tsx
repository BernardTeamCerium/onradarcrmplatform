import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientDashboard } from "@/components/ClientDashboard";
import { requireUser } from "@/lib/auth";
import { resolveRange } from "@/lib/ranges";
import { getClient } from "@/lib/store";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  if (user.role === "admin") redirect("/admin");
  const client = user.clientId ? await getClient(user.clientId) : null;
  const { range } = await searchParams;

  return (
    <AppShell user={user} client={client} active="dashboard">
      {client ? (
        <ClientDashboard client={client} range={resolveRange(range)} basePath="/dashboard" />
      ) : (
        <div className="card">
          <h2>Your account isn't linked to a client yet</h2>
          <p className="muted" style={{ marginTop: 6 }}>Ask your OnRadar account manager to connect your login to your company.</p>
        </div>
      )}
    </AppShell>
  );
}
