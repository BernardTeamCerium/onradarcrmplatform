import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ProspectBio } from "@/components/ProspectBio";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ClientBioPage({ params }: { params: Promise<{ apptId: string }> }) {
  const user = await requireUser();
  if (user.role === "admin") redirect("/admin");
  const client = user.clientId ? await getClient(user.clientId) : null;
  if (!client) redirect("/dashboard");
  const { apptId } = await params;
  const id = decodeURIComponent(apptId);
  return (
    <AppShell user={user} client={client} active="dashboard">
      <ProspectBio client={client} apptId={id} backHref={`/dashboard/calendar?day=${id.split("~")[0]}`} />
    </AppShell>
  );
}
