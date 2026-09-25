import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CalendarView } from "@/components/CalendarView";
import { ClientHeader } from "@/components/ClientHeader";
import { ClientTabs } from "@/components/ClientTabs";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ClientCalendarPage({ searchParams }: { searchParams: Promise<{ week?: string; day?: string; agent?: string }> }) {
  const user = await requireUser();
  if (user.role === "admin") redirect("/admin");
  const client = user.clientId ? await getClient(user.clientId) : null;
  if (!client) redirect("/dashboard");
  return (
    <AppShell user={user} client={client} active="dashboard">
      <div className="stack">
        <ClientHeader client={client} subtitle="Appointments by agent" />
        <ClientTabs base="/dashboard" active="calendar" />
        <CalendarView client={client} basePath="/dashboard/calendar" search={await searchParams} />
      </div>
    </AppShell>
  );
}
