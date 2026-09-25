import { currentUser } from "@/lib/auth";
import { listLeads } from "@/lib/leads";

export const dynamic = "force-dynamic";

/** Polled by the Leads page to show new leads as they arrive. */
export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.clientId !== clientId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const leads = (await listLeads(clientId)).slice(0, 300);
  return Response.json({ leads }, { headers: { "Cache-Control": "no-store" } });
}
