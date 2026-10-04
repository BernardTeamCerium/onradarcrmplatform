import { MAX_PUSHED_EVENTS, savePushed } from "@/lib/calendarPush";
import { checkKey } from "@/lib/inbound";
import { getClient } from "@/lib/store";

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);

/**
 * Calendar sync from the Google Apps Script: POST {calendar, from, to, events[]} with ?key=<inbound key>&agent=<agent id>.
 * Each sync replaces that agent's events.
 */
export async function POST(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const url = new URL(req.url);
  const client = await getClient(clientId);
  if (!client || !checkKey(client, url.searchParams.get("key"))) return Response.json({ error: "Unknown client or key" }, { status: 401 });
  const agent = client.agents.find((a) => a.id === url.searchParams.get("agent"));
  if (!agent) return Response.json({ error: "Unknown agent. Copy the script again from OnRadar settings." }, { status: 404 });
  let body: { calendar?: unknown; from?: unknown; to?: unknown; events?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.events)) return Response.json({ error: "events must be a list" }, { status: 400 });
  const events = body.events.slice(0, MAX_PUSHED_EVENTS).flatMap((e: Record<string, unknown>) => {
    const start = iso(e?.start);
    if (!start) return [];
    return [{
      uid: str(e.id, 300) || start,
      start,
      end: iso(e.end),
      allDay: e.allDay === true,
      summary: str(e.title, 300),
      description: str(e.description, 4000),
      location: str(e.location, 500),
      cancelled: e.cancelled === true,
    }];
  });
  await savePushed(clientId, {
    agentId: agent.id,
    calendar: str(body.calendar, 200) || undefined,
    receivedAt: new Date().toISOString(),
    from: iso(body.from) ?? new Date().toISOString(),
    to: iso(body.to) ?? new Date().toISOString(),
    events,
  });
  return Response.json({ ok: true, agent: agent.name, events: events.length });
}
