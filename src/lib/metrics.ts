import "server-only";
import * as ghl from "./ghl";
import { dayKey, eachDay, previousRange, type DateRange } from "./ranges";
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
      return {
        ...demoData(client, range),
        source: "demo",
        warnings: [`Could not reach GoHighLevel, showing sample data. ${(err as Error).message}`],
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

/** Ad spend per day, prorating each month's entry evenly across that month's days. */
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
  appointments: number;
  conversations: number;
  leads: number;
  sales: number;
  applicants: number;
  estimatedRevenue: number;
}): Metrics {
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    ...base,
    costPerLead: ratio(base.spend, base.leads),
    costPerAppointment: ratio(base.spend, base.appointments),
    salesConversion: ratio(base.sales, base.leads),
    estimatedReturn: base.spend > 0 ? (base.estimatedRevenue - base.spend) / base.spend : null,
  };
}

// ---------------------------------------------------------------------------
// Live GoHighLevel data

async function liveData(client: Client, range: DateRange): Promise<DashboardData> {
  const creds = { locationId: client.ghl.locationId, apiToken: client.ghl.apiToken };
  const prev = previousRange(range);
  const warnings: string[] = [];

  const [leadsNow, leadsPrev, convNow, convPrev, appts, pipes, opps] = await Promise.all([
    ghl.contactsCreated(creds, range.start, range.end, { withDates: true }),
    ghl.contactsCreated(creds, prev.start, prev.end, { withDates: false }),
    ghl.conversationsStarted(creds, range.start, range.end),
    ghl.conversationsStarted(creds, prev.start, prev.end),
    ghl.appointments(creds, prev.start, range.end),
    ghl.pipelines(creds),
    ghl.opportunitiesSince(creds, prev.start),
  ]);

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
    let revenue = 0;
    let applicants = 0;
    for (const o of opps) {
      if (o.status === "won" && inWindow(o.lastStatusChangeAt ?? o.updatedAt, r)) {
        sales++;
        revenue += o.monetaryValue && o.monetaryValue > 0 ? o.monetaryValue : client.averageDealValue;
      }
      const appIdx = appStageIndex.get(o.pipelineId);
      const reachedApp =
        o.status === "won" || (appIdx !== undefined && (stageIndex.get(o.pipelineStageId) ?? -1) >= appIdx);
      if (reachedApp && inWindow(o.lastStageChangeAt ?? o.createdAt, r)) applicants++;
    }
    return { sales, revenue, applicants };
  };

  const days = eachDay(range);
  const prevDays = eachDay(prev);
  const spendFor = (ds: string[]) => ds.reduce((sum, d) => sum + dailySpend(client, d), 0);

  const leadsByDay = countBy(leadsNow.dates);
  const apptsByDay = countBy(appts);
  const apptsIn = (r: { start: Date; end: Date }) => appts.filter((a) => inWindow(a, r)).length;

  const now = oppStats(range);
  const before = oppStats(prev);

  return {
    metrics: derive({
      spend: spendFor(days),
      appointments: apptsIn(range),
      conversations: convNow,
      leads: leadsNow.total,
      sales: now.sales,
      applicants: now.applicants,
      estimatedRevenue: now.revenue,
    }),
    previous: derive({
      spend: spendFor(prevDays),
      appointments: apptsIn(prev),
      conversations: convPrev,
      leads: leadsPrev.total,
      sales: before.sales,
      applicants: before.applicants,
      estimatedRevenue: before.revenue,
    }),
    daily: days.map((d) => ({
      date: d,
      leads: leadsByDay.get(d) ?? 0,
      appointments: apptsByDay.get(d) ?? 0,
      spend: dailySpend(client, d),
    })),
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

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function binomial(n: number, p: number, rand: () => number) {
  let k = 0;
  for (let i = 0; i < n; i++) if (rand() < p) k++;
  return k;
}

interface DemoDay extends DailyPoint {
  conversations: number;
  applicants: number;
  sales: number;
  revenue: number;
}

function demoDay(client: Client, date: string): DemoDay {
  const rand = rng(hash(`${client.id}:${date}`));
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekday = dow === 0 || dow === 6 ? 0.55 : 1;
  // Always draw the spend value so entering real spend doesn't shift the rest of the sample stream.
  const sampleSpend = Math.round((260 + rand() * 110) * (weekday === 1 ? 1 : 0.75));
  const spend = client.spend.length > 0 ? dailySpend(client, date) : sampleSpend;
  const leads = Math.max(0, Math.round((7 + rand() * 7) * weekday));
  const conversations = leads + binomial(leads, 0.65, rand);
  const appointments = binomial(leads, 0.34, rand);
  const applicants = binomial(appointments + 1, 0.42, rand);
  const sales = binomial(applicants, 0.4, rand);
  const revenue = sales * client.averageDealValue * (0.7 + rand() * 0.5);
  return { date, leads, conversations, appointments, applicants, sales, revenue, spend };
}

function demoData(client: Client, range: DateRange): DashboardData {
  const today = dayKey(Date.now());
  const sum = (r: { start: Date; end: Date }) => {
    const rows = eachDay(r).map((d) => (d > today ? { ...demoDay(client, d), leads: 0, conversations: 0, appointments: 0, applicants: 0, sales: 0, revenue: 0 } : demoDay(client, d)));
    const total = rows.reduce(
      (acc, r) => {
        acc.spend += r.spend;
        acc.leads += r.leads;
        acc.conversations += r.conversations;
        acc.appointments += r.appointments;
        acc.applicants += r.applicants;
        acc.sales += r.sales;
        acc.estimatedRevenue += r.revenue;
        return acc;
      },
      { spend: 0, leads: 0, conversations: 0, appointments: 0, applicants: 0, sales: 0, estimatedRevenue: 0 },
    );
    return { rows, total };
  };
  const now = sum(range);
  const before = sum(previousRange(range));
  return {
    metrics: derive(now.total),
    previous: derive(before.total),
    daily: now.rows.map(({ date, leads, appointments, spend }) => ({ date, leads, appointments, spend })),
    source: "demo",
    fetchedAt: new Date().toISOString(),
    warnings: [],
  };
}

