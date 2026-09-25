import { addLead, leadFromTypeform, verifyTypeformSignature, type TypeformPayload } from "@/lib/leads";
import { getClient } from "@/lib/store";

/**
 * Typeform webhook: Typeform → Connect → Webhooks → Add a webhook
 *   URL:    https://<your-site>/api/webhooks/typeform/<clientId>
 *   Secret: the client's webhook secret from Admin → client → Settings → Typeform quiz
 */
export async function POST(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client) return Response.json({ error: "Unknown client" }, { status: 404 });

  const raw = await req.text();
  if (!verifyTypeformSignature(raw, req.headers.get("typeform-signature"), client.typeformSecret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: TypeformPayload;
  try {
    payload = JSON.parse(raw) as TypeformPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!payload.form_response) return Response.json({ ok: true, ignored: true });

  try {
    const lead = await addLead(clientId, leadFromTypeform(payload));
    return Response.json({ ok: true, leadId: lead.id });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 422 });
  }
}
