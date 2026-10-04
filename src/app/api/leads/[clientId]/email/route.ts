import { leadFromEmail, checkKey } from "@/lib/inbound";
import { addLead } from "@/lib/leads";
import { getClient } from "@/lib/store";

/**
 * Lead emails: POST {subject, from, text, html, messageId, date} with ?key=<client inbound key>.
 * Used by the Gmail Apps Script from client settings; Postmark/Mailgun-style field names also work.
 */
export async function POST(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client || !checkKey(client, new URL(req.url).searchParams.get("key"))) {
    return Response.json({ error: "Unknown client or key" }, { status: 401 });
  }
  let body: Record<string, string>;
  const type = req.headers.get("content-type") ?? "";
  try {
    body = type.includes("application/json")
      ? await req.json()
      : Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]));
  } catch {
    return Response.json({ error: "Send JSON or form data" }, { status: 400 });
  }
  const lead = leadFromEmail(client, {
    subject: body.subject ?? body.Subject,
    from: body.from ?? body.From ?? body.sender,
    text: body.text ?? body.TextBody ?? body["body-plain"] ?? body.body,
    html: body.html ?? body.HtmlBody ?? body["body-html"],
    messageId: body.messageId ?? body.MessageID ?? body["Message-Id"],
    date: body.date ?? body.Date,
  });
  if (!lead.email && !lead.phone && lead.name === "Unknown Lead") {
    return Response.json({ ok: true, ignored: "No name, email or phone found in this email" });
  }
  // The same email sent again (e.g. re-labelled in Gmail) refreshes the lead with the latest reading.
  const saved = await addLead(clientId, lead, { refresh: true });
  return Response.json({ ok: true, leadId: saved.id, name: saved.name });
}
