import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ProspectBio } from "@/components/ProspectBio";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/store";
import { tabHidden } from "@/lib/tabs";

export const dynamic = "force-dynamic";

export default async function ClientBioPage({ params }: { params: Promise<{ apptId: string }> }) {
  const user = await requireUser();
  if (user.role === "admin") redirect("/admin");
  const client = user.clientId ? await getClient(user.clientId) : null;
  if (!client) redirect("/dashboard");
  if (tabHidden(client, "calendar")) redirect("/dashboard");
  const { apptId } = await params;
  const id = decodeURIComponent(apptId);
  return (
    <AppShell user={user} client={client} active="dashboard">
      <ProspectBio client={client} apptId={id} calendarBase="/dashboard/calendar" />
    </AppShell>
  );
}
