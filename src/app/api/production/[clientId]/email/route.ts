import { applyCaseEmail, looksLikeCase, parseCaseEmail } from "@/lib/caseEmail";
import { checkKey } from "@/lib/inbound";
import { clearMetricsCache } from "@/lib/metrics";
import { getClient } from "@/lib/store";

/**
 * Case status emails for the Production tab: POST {subject, from, text, html, messageId, date} with
 * ?key=<client inbound key>. Used by the production Gmail script; Postmark/Mailgun field names also work.
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
  const parsed = parseCaseEmail({
    subject: body.subject ?? body.Subject,
    from: body.from ?? body.From ?? body.sender,
    text: body.text ?? body.TextBody ?? body["body-plain"] ?? body.body,
    html: body.html ?? body.HtmlBody ?? body["body-html"],
    messageId: body.messageId ?? body.MessageID ?? body["Message-Id"],
    date: body.date ?? body.Date,
  });
  // Not a case email: accept it so the Gmail script files it away, but change nothing.
  if (!looksLikeCase(parsed)) return Response.json({ ok: true, ignored: "No case number or premium found in this email" });
  const { action, entry } = await applyCaseEmail(client, parsed);
  clearMetricsCache(clientId);
  return Response.json({ ok: true, action, caseId: entry.id, caseNumber: entry.caseNumber, status: entry.status, carrierStatus: entry.carrierStatus });
}
