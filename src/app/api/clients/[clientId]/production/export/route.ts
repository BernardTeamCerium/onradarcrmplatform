import { currentUser } from "@/lib/auth";
import { exportCsv, loadProduction } from "@/lib/production";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.clientId !== clientId)) return new Response("Not found", { status: 404 });
  const client = await getClient(clientId);
  if (!client) return new Response("Not found", { status: 404 });
  const csv = exportCsv(await loadProduction(client));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${client.slug}-production-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
