import "server-only";
import * as ghl from "./ghl";
import { dayKey, eachDay, previousRange, type DateRange } from "./ranges";
import { liveBySource, matchSource, sampleBySource } from "./sources";
import { cleanPlace, liveByGeo, sampleByGeo, type GeoFact } from "./geo";
import type { Client, DailyPoint, DashboardData, Metrics } from "./types";

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; data: DashboardData }>();

export function usesLiveData(client: Client) {
  return !client.demoMode && !!client.ghl.apiToken && !!client.ghl.locationId;
}

export function clearMetricsCache(clientId: string) {
  for (const key of cache.keys()) if (key.startsWith(`${clientId}:`)) cache.delete(key);
}

export async function getDashboardData(client: Client, range: DateRange): Promise<DashboardData> {
  const live = usesLiveData(client);
  const key = `${client.id}:${live ? "ghl" : "demo"}:${range.start.toISOString()}:${range.end.toISOString()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  let data: DashboardData;
  if (live) {
    try {
      data = await liveData(client, range);
    } catch (err) {
      // Never cache a failure; surface it on the dashboard instead of crashing the page.
      console.error(`Live data failed for ${client.id}:`, err);
      return {
        ...demoData(client, range),
        source: "demo",
        warnings: ["Live data is temporarily unavailable, so sample data is shown. Please check back shortly."],
      };
    }
  } else {
    data = demoData(client, range);
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

// ---------------------------------------------------------------------------
// Spend

/** Marketing spend per day, prorating each month's entry evenly across that month's days. */
export function dailySpend(client: Client, day: string) {
  const month = day.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return client.spend.filter((s) => s.month === month).reduce((sum, s) => sum + s.amount / daysInMonth, 0);
}

// ---------------------------------------------------------------------------
// Derived metrics

function derive(base: {
  spend: number;
  apptsSet: number;
  appointments: number;
  conversations: number;
  leads: number;
  sales: number;
  applicants: number;
  premium: number;
  cycleDaysSum: number;
}): Metrics {
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    ...base,
    // A conversation is always with a lead, so never report more conversations than leads.
    conversations: Math.min(base.conversations, base.leads),
    // Every connected appointment was set first.
    apptsSet: Math.max(base.apptsSet, base.appointments),
    connectRate: ratio(base.appointments, Math.max(base.apptsSet, base.appointments)),
    costPerLead: ratio(base.spend, base.leads),
    costPerAppointment: ratio(base.spend, base.appointments),
    salesConversion: ratio(base.sales, base.leads),
    cycleDays: ratio(base.cycleDaysSum, base.applicants),
    connectedPct: ratio(base.appointments, base.leads),
    estimatedReturn: base.spend > 0 ? (base.premium - base.spend) / base.spend : null,
  };
}

// ---------------------------------------------------------------------------
// Live GoHighLevel data

async function liveData(client: Client, range: DateRange): Promise<DashboardData> {
  const creds = { locationId: client.ghl.locationId, apiToken: client.ghl.apiToken };
  const prev = previousRange(range);
  const warnings: string[] = [];

  const [leadsNow, leadsPrev, convNow, convPrev, appts, pipes, opps, convSample] = await Promise.all([
    ghl.contactsCreated(creds, range.start, range.end, { withDates: true }),
    ghl.contactsCreated(creds, prev.start, prev.end, { withDates: false }),
    ghl.conversationsStarted(creds, range.start, range.end),
    ghl.conversationsStarted(creds, prev.start, prev.end),
    ghl.appointments(creds, prev.start, range.end),
    ghl.pipelines(creds),
    ghl.opportunitiesSince(creds, prev.start),
    ghl.conversationContacts(creds, range.start, range.end),
  ]);

  // Attribute records to marketing sources through the contact's lead source.
  const contactAdded = new Map(leadsNow.contacts.map((c) => [c.id, c.dateAdded]));
  const contactSource = new Map(leadsNow.contacts.map((c) => [c.id, matchSource(client, c.source)]));
  const sourceOf = (contactId?: string, fallback?: string) =>
    (contactId && contactSource.get(contactId)) || matchSource(client, fallback);
  const contactPlace = new Map(leadsNow.contacts.map((c) => [c.id, cleanPlace(c.city, c.state)]));
  const fact = (contactId?: string, fallbackSource?: string) => ({
    source: sourceOf(contactId, fallbackSource),
    ...((contactId && contactPlace.get(contactId)) || cleanPlace()),
  });

  if (leadsNow.dates.length < leadsNow.total) {
    warnings.push("Daily lead trend is based on the most recent 5,000 contacts in this period.");
  }

  // Index each stage's position, and the first stage per pipeline that counts as "application submitted".
  const keywords = client.ghl.applicationStageKeywords.map((k) => k.toLowerCase()).filter(Boolean);
  const stageIndex = new Map<string, number>();
  const appStageIndex = new Map<string, number>();
  for (const p of pipes) {
    const stages = [...p.stages].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    stages.forEach((s, i) => {
      stageIndex.set(s.id, i);
      if (!appStageIndex.has(p.id) && keywords.some((k) => s.name.toLowerCase().includes(k))) {
        appStageIndex.set(p.id, i);
      }
    });
  }
  if (keywords.length && appStageIndex.size === 0 && pipes.length) {
    warnings.push(
      `No pipeline stage matches "${keywords.join('", "')}", so applicants only counts won opportunities. Update the keywords in client settings.`,
    );
  }

  const inWindow = (iso: string | undefined, r: { start: Date; end: Date }) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= r.start.getTime() && t < r.end.getTime();
  };

  const oppStats = (r: { start: Date; end: Date }) => {
    let sales = 0;
    let premium = 0;
    let applicants = 0;
    let cycleDaysSum = 0;
    const appFacts: (GeoFact & { premium: number; cycleDays: number })[] = [];
    const saleFacts: GeoFact[] = [];
    for (const o of opps) {
      if (o.status === "won" && inWindow(o.lastStatusChangeAt ?? o.updatedAt, r)) {
        sales++;
        saleFacts.push(fact(o.contactId, o.source));
      }
      const appIdx = appStageIndex.get(o.pipelineId);
      const reachedApp =
        o.status === "won" || (appIdx !== undefined && (stageIndex.get(o.pipelineStageId) ?? -1) >= appIdx);
      if (reachedApp && inWindow(o.lastStageChangeAt ?? o.createdAt, r)) {
        applicants++;
        const value = o.monetaryValue && o.monetaryValue > 0 ? o.monetaryValue : client.averagePremium;
        premium += value;
        // Cycle time: from when the lead came in (contact date if we have it, else the opportunity's) to the application.
        const appliedAt = new Date(o.lastStageChangeAt ?? o.createdAt).getTime();
        const leadAt = new Date((o.contactId && contactAdded.get(o.contactId)) || o.createdAt).getTime();
        const days = Math.max(0, (appliedAt - leadAt) / 86_400_000);
        cycleDaysSum += days;
        appFacts.push({ ...fact(o.contactId, o.source), premium: value, cycleDays: days });
      }
    }
    return { sales, premium, applicants, cycleDaysSum, appFacts, saleFacts };
  };

  const days = eachDay(range);
  const prevDays = eachDay(prev);
  const spendFor = (ds: string[]) => ds.reduce((sum, d) => sum + dailySpend(client, d), 0);

  const leadsByDay = countBy(leadsNow.dates);
  const apptsByDay = countBy(appts.connected);
  const apptsIn = (r: { start: Date; end: Date }) => appts.connected.filter((a) => inWindow(a, r)).length;
  const setIn = (r: { start: Date; end: Date }) => appts.set.filter((a) => inWindow(a, r)).length;

  const now = oppStats(range);
  const before = oppStats(prev);
  const current = appts.bookings.filter((b) => inWindow(b.startTime, range));
  const convWeight = convSample.contactIds.length > 0 ? convNow / convSample.contactIds.length : 0;
  const facts = {
    leads: leadsNow.contacts.map((c) => fact(c.id)),
    conversations: convSample.contactIds.map((id) => ({ ...fact(id), weight: convWeight })),
    apptsSet: current.map((b) => fact(b.contactId)),
    connected: current.filter((b) => b.connected).map((b) => fact(b.contactId)),
    applicants: now.appFacts,
    sales: now.saleFacts,
  };
  const bySource = liveBySource(client, range, {
    leads: facts.leads.map((f) => f.source),
    conversations: facts.conversations,
    apptsSet: facts.apptsSet.map((f) => f.source),
    connected: facts.connected.map((f) => f.source),
    applicants: facts.applicants,
    sales: facts.sales.map((f) => f.source),
  });
  const byGeo = liveByGeo(bySource, facts);

  return {
    metrics: derive({
      spend: spendFor(days),
      apptsSet: setIn(range),
      appointments: apptsIn(range),
      conversations: convNow,
      leads: leadsNow.total,
      sales: now.sales,
      applicants: now.applicants,
      premium: now.premium,
      cycleDaysSum: now.cycleDaysSum,
    }),
    previous: derive({
      spend: spendFor(prevDays),
      apptsSet: setIn(prev),
      appointments: apptsIn(prev),
      conversations: convPrev,
      leads: leadsPrev.total,
      sales: before.sales,
      applicants: before.applicants,
      premium: before.premium,
      cycleDaysSum: before.cycleDaysSum,
    }),
    daily: days.map((d) => ({
      date: d,
      leads: leadsByDay.get(d) ?? 0,
      appointments: apptsByDay.get(d) ?? 0,
      spend: dailySpend(client, d),
    })),
    bySource,
    byGeo,
    source: "ghl",
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

function countBy(isoDates: string[]) {
  const m = new Map<string, number>();
  for (const iso of isoDates) {
    const k = dayKey(iso);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Sample data (deterministic per client + day, so reloads and period comparisons stay stable)

export function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function binomial(n: number, p: number, rand: () => number) {
  let k = 0;
  for (let i = 0; i < n; i++) if (rand() < p) k++;
  return k;
}

export interface DemoDay extends DailyPoint {
  /** Average lead-to-application days for applications submitted this day. */
  cycle: number;
  apptsSet: number;
  conversations: number;
  applicants: number;
  sales: number;
  premium: number;
}

function demoDay(client: Client, date: string): DemoDay {
  const rand = rng(hash(`${client.id}:${date}`));
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekday = dow === 0 || dow === 6 ? 0.55 : 1;
  // Always draw the spend noise so entering real spend doesn't shift the rest of the sample stream.
  const spendNoise = rand();
  const leads = Math.max(0, Math.round((7 + rand() * 7) * weekday));
  // Sample spend tracks leads at roughly $100 per lead (±10%); with ~16% of leads booking,
  // cost per appointment lands around $550–$700.
  const sampleSpend = Math.round(Math.max(leads, 1) * (90 + spendNoise * 20));
  const spend = client.spend.length > 0 ? dailySpend(client, date) : sampleSpend;
  // About 70% of new leads reply and start a conversation.
  const conversations = binomial(leads, 0.7, rand);
  const appointments = binomial(leads, 0.16, rand);
  const applicants = binomial(appointments, 0.52, rand);
  const sales = binomial(applicants, 0.45, rand);
  const premium = Math.round(applicants * client.averagePremium * (0.6 + rand() * 0.8));
  // About 63% of set appointments connect; the rest cancel or no-show. Drawn last so earlier numbers stay put.
  const apptsSet = appointments + binomial(appointments * 2, 0.29, rand);
  // Typical lead-to-application time: about 9 to 17 days.
  const cycle = 9 + rand() * 8;
  return { date, leads, conversations, apptsSet, appointments, applicants, sales, premium, spend, cycle };
}

/** Splits an integer total across buckets in proportion to `weights` (largest-remainder rounding). */
function distribute(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const wsum = sum > 0 ? sum : w.length;
  const exact = w.map((x) => (x / wsum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k][1]]++;
  return out;
}

const ZERO_DAY = { leads: 0, conversations: 0, apptsSet: 0, appointments: 0, applicants: 0, sales: 0, premium: 0 };

/**
 * Sample rows for one month. When the admin has entered figures for that month, the sample is
 * rescaled so the month adds up to exactly those numbers (spread over the days elapsed so far).
 */
function demoMonth(client: Client, month: string, today: string): DemoDay[] {
  const [y, m] = month.split("-").map(Number);
  const rows = eachDay({ start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) }).map((d) =>
    d > today ? { ...demoDay(client, d), ...ZERO_DAY } : demoDay(client, d),
  );
  const fig = client.figures.find((f) => f.month === month);
  const live = rows.filter((r) => r.date <= today);
  if (!fig || live.length === 0) return rows;

  const setBefore = live.reduce((a, r) => a + r.apptsSet, 0);
  const connectedBefore = live.reduce((a, r) => a + r.appointments, 0);
  if (fig.appointments !== undefined) {
    const before = connectedBefore;
    // Spread in proportion to leads so cost per appointment stays steady week to week.
    const appts = distribute(fig.appointments, live.map((r) => r.leads));
    const factor = before > 0 ? fig.appointments / before : 0;
    // Keep applications and sales in the same proportion to appointments as the sample had.
    const apps = distribute(Math.round(live.reduce((a, r) => a + r.applicants, 0) * factor), appts);
    const sales = distribute(Math.round(live.reduce((a, r) => a + r.sales, 0) * factor), appts);
    live.forEach((r, i) => {
      r.appointments = appts[i];
      r.applicants = Math.min(apps[i], appts[i]);
      r.sales = Math.min(sales[i], r.applicants);
    });
  }
  if (fig.appointments !== undefined || fig.apptsSet !== undefined) {
    // Appointments set: the entered number, or the sample's set-to-connected ratio applied to the new total.
    const connected = live.reduce((a, r) => a + r.appointments, 0);
    const target = fig.apptsSet ?? (connectedBefore > 0 ? Math.round((connected * setBefore) / connectedBefore) : connected);
    const extra = distribute(Math.max(0, target - connected), live.map((r) => r.leads));
    live.forEach((r, i) => (r.apptsSet = r.appointments + extra[i]));
  }
  const premiumWeights = live.map((r) => r.applicants);
  const premium =
    fig.premium !== undefined
      ? distribute(Math.round(fig.premium), premiumWeights)
      : live.map((r) => Math.round(r.applicants * client.averagePremium));
  live.forEach((r, i) => (r.premium = premium[i]));
  return rows;
}

export function demoRows(client: Client, r: { start: Date; end: Date }) {
  const today = dayKey(Date.now());
  const months = new Map<string, Map<string, DemoDay>>();
  return eachDay(r).map((d) => {
    const month = d.slice(0, 7);
    if (!months.has(month)) months.set(month, new Map(demoMonth(client, month, today).map((row) => [row.date, row])));
    return months.get(month)!.get(d)!;
  });
}

function demoData(client: Client, range: DateRange): DashboardData {
  const sum = (r: { start: Date; end: Date }) => {
    const rows = demoRows(client, r);
    const total = rows.reduce(
      (acc, r) => {
        acc.spend += r.spend;
        acc.leads += r.leads;
        acc.conversations += r.conversations;
        acc.apptsSet += r.apptsSet;
        acc.appointments += r.appointments;
        acc.applicants += r.applicants;
        acc.sales += r.sales;
        acc.premium += r.premium;
        acc.cycleDaysSum += r.applicants * r.cycle;
        return acc;
      },
      { spend: 0, leads: 0, conversations: 0, apptsSet: 0, appointments: 0, applicants: 0, sales: 0, premium: 0, cycleDaysSum: 0 },
    );
    return { rows, total };
  };
  const now = sum(range);
  const before = sum(previousRange(range));
  const metrics = derive(now.total);
  const bySource = sampleBySource(client, { ...metrics, spend: now.total.spend }, range);
  return {
    metrics,
    bySource,
    byGeo: sampleByGeo(bySource),
    previous: derive(before.total),
    daily: now.rows.map(({ date, leads, appointments, spend }) => ({ date, leads, appointments, spend })),
    source: "demo",
    fetchedAt: new Date().toISOString(),
    warnings: [],
  };
}
