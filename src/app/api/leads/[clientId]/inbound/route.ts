import { checkKey, leadFromFields } from "@/lib/inbound";
import { addLead } from "@/lib/leads";
import { getClient } from "@/lib/store";

/**
 * Generic lead webhook for Zapier, Make, lead vendors, etc.: POST any flat JSON or form fields
 * (name/first_name/last_name, email, phone, city, state, source, ...) with ?key=<client inbound key>.
 * Recognised fields fill the lead; everything else is kept as answers.
 */
export async function POST(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client || !checkKey(client, new URL(req.url).searchParams.get("key"))) {
    return Response.json({ error: "Unknown client or key" }, { status: 401 });
  }
  let pairs: [string, string][];
  try {
    const type = req.headers.get("content-type") ?? "";
    const data: Record<string, unknown> = type.includes("application/json")
      ? await req.json()
      : Object.fromEntries((await req.formData()).entries());
    pairs = Object.entries(data)
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
      .map(([k, v]) => [k, String(v)]);
  } catch {
    return Response.json({ error: "Send JSON or form data" }, { status: 400 });
  }
  const externalId = pairs.find(([k]) => /^(id|lead_?id|external_?id)$/i.test(k))?.[1];
  const lead = leadFromFields(client, pairs, { channel: "api", source: new URL(req.url).searchParams.get("source") ?? undefined, externalId });
  const saved = await addLead(clientId, lead);
  return Response.json({ ok: true, leadId: saved.id, name: saved.name });
}
