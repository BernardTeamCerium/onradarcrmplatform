import { currentUser } from "@/lib/auth";
import { buildBioDocx } from "@/lib/bioDoc";
import { getAppointment } from "@/lib/calendar";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Downloads a Word prospect brief for one calendar appointment. */
export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string; apptId: string }> }) {
  const { clientId, apptId } = await params;
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.clientId !== clientId)) return new Response("Not found", { status: 404 });
  const client = await getClient(clientId);
  if (!client) return new Response("Not found", { status: 404 });
  const found = await getAppointment(client, decodeURIComponent(apptId));
  if (!found) return new Response("Appointment not found", { status: 404 });
  const agent = found.agents.find((a) => a.id === found.appt.agentId)?.name ?? "Unassigned";
  const buf = await buildBioDocx(client, found.appt, agent);
  const file = `Prospect brief - ${found.appt.name} - ${found.appt.date}.docx`.replace(/[^\w .()-]/g, "");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
