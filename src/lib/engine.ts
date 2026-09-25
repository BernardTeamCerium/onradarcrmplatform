import "server-only";
import * as ghl from "./ghl";
import { binomial, demoRows, getDashboardData, hash, rng, usesLiveData } from "./metrics";
import { dayKey, eachDay, type DateRange } from "./ranges";
import { matchSource, OTHER, split } from "./sources";
import type { Client, EngineData, EngineSource, EngineTotals } from "./types";

const CACHE_TTL_MS = 2 * 60_000;
const cache = new Map<string, { at: number; data: EngineData }>();

export async function getEngineData(client: Client, range: DateRange): Promise<EngineData> {
  const live = usesLiveData(client);
  const key = `${client.id}:${live}:${range.start.toISOString()}:${range.end.toISOString()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  let data: EngineData;
  if (live) {
    try {
      data = await liveEngine(client, range);
    } catch (err) {
      console.error(`Engine data failed for ${client.id}:`, err);
      return { ...(await sampleEngine(client, range)), warnings: ["Live activity is temporarily unavailable, so sample data is shown."] };
    }
  } else {
    data = await sampleEngine(client, range);
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

const todayStart = (offsetDays: number) => Date.parse(`${dayKey(Date.now())}T00:00:00Z`) + offsetDays * 86_400_000;

const ZERO: EngineTotals = { smsOut: 0, smsIn: 0, emailOut: 0, emailIn: 0, callsOut: 0, callsAnswered: 0, callsIn: 0 };

// ---------------------------------------------------------------------------
// Sample data: follow-up automation driven by that day's leads, conversations and bookings.

function sampleDay(client: Client, row: { date: string; leads: number; conversations: number; apptsSet: number }): EngineTotals {
  const rand = rng(hash(`${client.id}:${row.date}:engine`));
  const jitter = () => 0.85 + rand() * 0.3;
  const smsOut = Math.round((row.leads * 5.5 + row.conversations * 3 + row.apptsSet * 2) * jitter());
  const emailOut = Math.round((row.leads * 4 + row.apptsSet * 2) * jitter());
  const callsOut = Math.round((row.leads * 2.6 + row.apptsSet * 1.2) * jitter());
  return {
    smsOut,
    smsIn: Math.round(row.conversations * 2.4 * jitter()),
    emailOut,
    emailIn: Math.round(row.conversations * 0.35 * jitter()),
    callsOut,
    callsAnswered: binomial(callsOut, 0.31, rand),
    callsIn: Math.round(row.conversations * 0.22 * jitter()),
  };
}

/** How each source's leads are worked: older broadcast audiences get more calls, social leads more texts. */
const CHANNEL_MIX: Record<string, { sms: number; email: number; calls: number }> = {
  tv: { sms: 0.9, email: 1.0, calls: 1.3 },
  radio: { sms: 0.9, email: 1.0, calls: 1.25 },
  youtube: { sms: 0.95, email: 1.05, calls: 1.15 },
  facebook: { sms: 1.15, email: 1.0, calls: 0.85 },
  tiktok: { sms: 1.25, email: 0.9, calls: 0.75 },
  "lead seller #1": { sms: 1.1, email: 0.95, calls: 1.4 },
};

async function sampleEngine(client: Client, range: DateRange): Promise<EngineData> {
  const dash = await getDashboardData(client, range);
  const rows = demoRows(client, range);
  const today = dayKey(Date.now());
  const perDay = rows.map((r) => ({ date: r.date, ...(r.date > today ? ZERO : sampleDay(client, r)) }));
  const totals = perDay.reduce(
    (t, d) => ({
      smsOut: t.smsOut + d.smsOut,
      smsIn: t.smsIn + d.smsIn,
      emailOut: t.emailOut + d.emailOut,
      emailIn: t.emailIn + d.emailIn,
      callsOut: t.callsOut + d.callsOut,
      callsAnswered: t.callsAnswered + d.callsAnswered,
      callsIn: t.callsIn + d.callsIn,
    }),
    { ...ZERO },
  );

  const src = dash.bySource.filter((s) => s.leads > 0 || s.conversations > 0);
  const mix = src.map((s) => CHANNEL_MIX[s.source.toLowerCase()] ?? { sms: 1, email: 1, calls: 1 });
  const sms = split(totals.smsOut, src.map((s, i) => s.leads * mix[i].sms));
  const email = split(totals.emailOut, src.map((s, i) => s.leads * mix[i].email));
  const calls = split(totals.callsOut, src.map((s, i) => s.leads * mix[i].calls));
  const replies = split(totals.smsIn + totals.emailIn + totals.callsIn, src.map((s) => s.conversations));
  const bySource: EngineSource[] = src.map((s, i) => ({
    source: s.source,
    conversations: s.conversations,
    apptsSet: s.apptsSet,
    smsOut: sms[i],
    emailOut: email[i],
    callsOut: calls[i],
    replies: replies[i],
  }));

  // Today's plan for the whole day (the page counts it up as the day goes by) and conversations active now.
  const todayRow = demoRows(client, { start: new Date(`${today}T00:00:00Z`), end: new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000) })[0];
  const t = sampleDay(client, todayRow);
  // Conversations still going in the last 24 hours: most of the last few days' conversations keep replying.
  const recent = demoRows(client, { start: new Date(todayStart(-3)), end: new Date(todayStart(0)) });
  const hour = new Date().getUTCHours();
  const activeNow = Math.round(recent.reduce((a, r) => a + r.conversations, 0) * (0.62 + 0.08 * Math.sin((hour / 24) * Math.PI * 2)));

  return {
    totals,
    daily: perDay.map((d) => ({ date: d.date, sms: d.smsOut, email: d.emailOut, calls: d.callsOut })),
    bySource,
    conversations: dash.metrics.conversations,
    apptsSet: dash.metrics.apptsSet,
    activeNow,
    today: { sms: t.smsOut, email: t.emailOut, calls: t.callsOut, fullDay: true },
    source: "demo",
    fetchedAt: new Date().toISOString(),
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Live data from the CRM's message log.

async function liveEngine(client: Client, range: DateRange): Promise<EngineData> {
  const creds = { locationId: client.ghl.locationId, apiToken: client.ghl.apiToken };
  const todayStart = new Date(`${dayKey(Date.now())}T00:00:00Z`);
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);
  const [dash, sms, email, calls, contacts, activeNow, tSms, tEmail, tCalls] = await Promise.all([
    getDashboardData(client, range),
    ghl.messages(creds, "SMS", range.start, range.end),
    ghl.messages(creds, "Email", range.start, range.end),
    ghl.messages(creds, "Call", range.start, range.end),
    ghl.contactsCreated(creds, range.start, range.end, { withDates: true, maxPages: 20 }),
    ghl.activeConversations(creds),
    ghl.messages(creds, "SMS", todayStart, todayEnd, 1),
    ghl.messages(creds, "Email", todayStart, todayEnd, 1),
    ghl.messages(creds, "Call", todayStart, todayEnd, 1),
  ]);
  const warnings: string[] = [];
  // Busy accounts: counts use the CRM's totals; per-day and per-source splits use the messages read.
  const scale = (m: { total: number; items: unknown[] }) => (m.items.length > 0 ? m.total / m.items.length : 1);
  if ([sms, email, calls].some((m) => m.total > m.items.length)) {
    warnings.push("This period has a lot of activity, so daily and per-source splits are estimated from the most recent 5,000 messages per channel.");
  }
  const count = (m: { total: number; items: ghl.CrmMessage[] }, dir: "inbound" | "outbound", pred: (x: ghl.CrmMessage) => boolean = () => true) =>
    Math.round(m.items.filter((x) => x.direction === dir && pred(x)).length * scale(m));
  const answered = (x: ghl.CrmMessage) => ["completed", "answered"].includes((x.callStatus ?? "").toLowerCase());
  const totals: EngineTotals = {
    smsOut: count(sms, "outbound"),
    smsIn: count(sms, "inbound"),
    emailOut: count(email, "outbound"),
    emailIn: count(email, "inbound"),
    callsOut: count(calls, "outbound"),
    callsAnswered: count(calls, "outbound", answered),
    callsIn: count(calls, "inbound"),
  };

  const daily = eachDay(range).map((date) => {
    const on = (m: { total: number; items: ghl.CrmMessage[] }) =>
      Math.round(m.items.filter((x) => x.direction === "outbound" && dayKey(x.dateAdded) === date).length * scale(m));
    return { date, sms: on(sms), email: on(email), calls: on(calls) };
  });

  const sourceOf = new Map(contacts.contacts.map((c) => [c.id, matchSource(client, c.source)]));
  const rows = new Map<string, EngineSource>();
  const row = (name: string) => {
    if (!rows.has(name)) rows.set(name, { source: name, conversations: 0, apptsSet: 0, smsOut: 0, emailOut: 0, callsOut: 0, replies: 0 });
    return rows.get(name)!;
  };
  for (const s of dash.bySource) Object.assign(row(s.source), { conversations: s.conversations, apptsSet: s.apptsSet });
  const tally = (m: { total: number; items: ghl.CrmMessage[] }, field: "smsOut" | "emailOut" | "callsOut") => {
    const k = scale(m);
    for (const x of m.items) {
      const r = row((x.contactId && sourceOf.get(x.contactId)) || OTHER);
      if (x.direction === "outbound") r[field] += k;
      else r.replies += k;
    }
  };
  tally(sms, "smsOut");
  tally(email, "emailOut");
  tally(calls, "callsOut");
  const bySource = [...rows.values()].map((r) => ({
    ...r,
    smsOut: Math.round(r.smsOut),
    emailOut: Math.round(r.emailOut),
    callsOut: Math.round(r.callsOut),
    replies: Math.round(r.replies),
  }));

  const outbound = (m: { total: number; items: ghl.CrmMessage[] }) => Math.round(m.items.filter((x) => x.direction === "outbound").length * scale(m));
  return {
    totals,
    daily,
    bySource,
    conversations: dash.metrics.conversations,
    apptsSet: dash.metrics.apptsSet,
    activeNow,
    today: { sms: outbound(tSms), email: outbound(tEmail), calls: outbound(tCalls), fullDay: false },
    source: "ghl",
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}
