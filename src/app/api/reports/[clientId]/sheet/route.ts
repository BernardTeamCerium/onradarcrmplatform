import { checkKey } from "@/lib/inbound";
import { clearMetricsCache } from "@/lib/metrics";
import { readSheet, saveSheet, type IncomingTab } from "@/lib/sheet";
import { getClient } from "@/lib/store";

/** The reporting Google Sheet: POST {name, url, onlyTab, tabs: [{name, rows: string[][]}]} with ?key=<inbound key>. */
export async function POST(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client || !checkKey(client, new URL(req.url).searchParams.get("key"))) {
    return Response.json({ error: "Unknown client or key" }, { status: 401 });
  }
  let body: { name?: unknown; url?: unknown; onlyTab?: unknown; tabs?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.tabs)) return Response.json({ error: "tabs must be a list" }, { status: 400 });
  const tabs: IncomingTab[] = body.tabs.slice(0, 12).map((t: { name?: unknown; rows?: unknown }) => ({
    name: String(t?.name ?? "").slice(0, 100),
    rows: Array.isArray(t?.rows) ? (t.rows as unknown[]).slice(0, 5000).map((r) => (Array.isArray(r) ? r.slice(0, 40).map((c) => String(c ?? "").slice(0, 200)) : [])) : [],
  }));
  const url = typeof body.url === "string" && /^https:\/\/docs\.google\.com\//.test(body.url) ? body.url : undefined;
  const sheet = readSheet({
    name: typeof body.name === "string" ? body.name.slice(0, 200) : "",
    url,
    tabs,
    onlyTab: typeof body.onlyTab === "string" && body.onlyTab.trim() ? body.onlyTab : undefined,
  });
  if (sheet.tabs.length === 0) {
    return Response.json({ ok: false, error: "No tab has a Month (or Date) column next to number columns like Leads or Marketing Spend. Use the OnRadar template headers." }, { status: 422 });
  }
  await saveSheet(clientId, sheet);
  clearMetricsCache(clientId);
  return Response.json({ ok: true, tabs: sheet.tabs, rows: sheet.rows.length, metrics: sheet.metrics, skipped: sheet.skipped.length });
}
