import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ProspectBio } from "@/components/ProspectBio";
import { requireAdmin } from "@/lib/auth";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AdminBioPage({ params }: { params: Promise<{ id: string; apptId: string }> }) {
  const user = await requireAdmin();
  const { id, apptId } = await params;
  const client = await getClient(id);
  if (!client) notFound();
  const appt = decodeURIComponent(apptId);
  return (
    <AppShell user={user} active="overview">
      <ProspectBio client={client} apptId={appt} backHref={`/admin/clients/${id}/calendar?day=${appt.split("~")[0]}`} />
    </AppShell>
  );
}
