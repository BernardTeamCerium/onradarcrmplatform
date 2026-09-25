import "server-only";
import { eachDay } from "./ranges";
import type { Client, Metrics, SourceRow } from "./types";

export const OTHER = "Other / unknown";
export const UNASSIGNED = "Unassigned spend";

const empty = (source: string): SourceRow => ({
  source,
  spend: 0,
  leads: 0,
  conversations: 0,
  apptsSet: 0,
  connected: 0,
  applicants: 0,
  sales: 0,
  premium: 0,
  cycleDaysSum: 0,
});

/** Maps a CRM lead-source string to one of the client's marketing sources. */
export function matchSource(client: Client, raw: string | undefined | null) {
  const s = (raw ?? "").toLowerCase().trim();
  if (!s) return OTHER;
  for (const src of client.sources) {
    if (src.name.toLowerCase() === s) return src.name;
  }
  for (const src of client.sources) {
    if (src.match.some((m) => m && s.includes(m.toLowerCase()))) return src.name;
  }
  return OTHER;
}

/** Real spend entries per source for the given days (entries without a source go to "Unassigned spend"). */
export function enteredSpendBySource(client: Client, r: { start: Date; end: Date }) {
  const out = new Map<string, number>();
  for (const day of eachDay(r)) {
    const month = day.slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (const e of client.spend) {
      if (e.month !== month) continue;
      const key = e.source && client.sources.some((s) => s.name === e.source) ? e.source : UNASSIGNED;
      out.set(key, (out.get(key) ?? 0) + e.amount / dim);
    }
  }
  return out;
}

/**
 * Sample-data personality of each source: its share of leads and spend, and how its leads convert at
 * each step relative to the average. TV and YouTube reach older, higher-intent prospects; purchased and
 * TikTok leads are cheaper but harder to reach.
 */
// `cycle` scales lead-to-application time: TV and YouTube prospects apply faster, bought leads slower.
const PROFILES: Record<string, { leads: number; spend: number; contact: number; set: number; connect: number; app: number; sale: number; premium: number; cycle: number }> = {
  tv: { leads: 0.17, spend: 0.27, contact: 1.15, set: 1.2, connect: 1.08, app: 1.2, sale: 1.15, premium: 1.25, cycle: 0.82 },
  radio: { leads: 0.12, spend: 0.14, contact: 1.05, set: 1.0, connect: 1.02, app: 1.05, sale: 1.0, premium: 1.05, cycle: 0.95 },
  facebook: { leads: 0.3, spend: 0.23, contact: 0.95, set: 0.95, connect: 0.96, app: 0.9, sale: 0.92, premium: 0.9, cycle: 1.05 },
  tiktok: { leads: 0.1, spend: 0.06, contact: 0.8, set: 0.72, connect: 0.85, app: 0.7, sale: 0.7, premium: 0.7, cycle: 1.2 },
  youtube: { leads: 0.12, spend: 0.13, contact: 1.0, set: 1.05, connect: 1.0, app: 1.08, sale: 1.05, premium: 1.1, cycle: 0.9 },
  "lead seller #1": { leads: 0.19, spend: 0.17, contact: 0.72, set: 0.8, connect: 0.9, app: 0.8, sale: 0.85, premium: 0.85, cycle: 1.35 },
};
const DEFAULT_PROFILE = { leads: 0.1, spend: 0.1, contact: 1, set: 1, connect: 1, app: 1, sale: 1, premium: 1, cycle: 1 };
const profile = (name: string) => PROFILES[name.toLowerCase()] ?? DEFAULT_PROFILE;

/** Integer split of `total` in proportion to `weights` (largest remainder). */
export function split(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const ws = sum > 0 ? sum : w.length;
  const exact = w.map((x) => (x / ws) * total);
  const out = exact.map(Math.floor);
  let left = Math.round(total - out.reduce((a, b) => a + b, 0));
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k][1]]++;
  return out;
}

/** Like `split`, but no bucket may exceed its cap; overflow moves to buckets with room. */
export function splitCapped(total: number, weights: number[], caps: number[]) {
  const out = weights.map(() => 0);
  let remaining = Math.min(total, caps.reduce((a, b) => a + b, 0));
  for (let guard = 0; remaining > 0 && guard < 10; guard++) {
    const room = caps.map((c, i) => c - out[i]);
    const w = weights.map((x, i) => (room[i] > 0 ? x : 0));
    const add = split(remaining, w.some((x) => x > 0) ? w : room.map((r) => Math.max(0, r)));
    add.forEach((a, i) => {
      const take = Math.min(a, room[i]);
      out[i] += take;
      remaining -= take;
    });
  }
  return out;
}

/** Splits range totals across the client's sources using each source's sample profile. */
export function sampleBySource(client: Client, m: Metrics, r: { start: Date; end: Date }): SourceRow[] {
  const names = client.sources.map((s) => s.name);
  if (names.length === 0) return [];
  const p = names.map(profile);
  const leads = split(m.leads, p.map((x) => x.leads));
  const conv = splitCapped(m.conversations, p.map((x, i) => leads[i] * x.contact), leads);
  const set = splitCapped(m.apptsSet, p.map((x, i) => conv[i] * x.set), conv.map((c, i) => Math.max(c, leads[i])));
  const connected = splitCapped(m.appointments, p.map((x, i) => set[i] * x.connect), set);
  const apps = splitCapped(m.applicants, p.map((x, i) => connected[i] * x.app), connected);
  const sales = splitCapped(m.sales, p.map((x, i) => apps[i] * x.sale), apps);
  const premium = split(Math.round(m.premium), p.map((x, i) => apps[i] * x.premium));
  // Share the period's total cycle days so each source's average reflects its profile and the overall average holds.
  const cycleWeights = p.map((x, i) => apps[i] * x.cycle);
  const cycleTotal = cycleWeights.reduce((a, b) => a + b, 0);
  const cycle = cycleWeights.map((w) => (cycleTotal > 0 ? (m.cycleDaysSum * w) / cycleTotal : 0));

  const entered = enteredSpendBySource(client, r);
  const spend = client.spend.length > 0 ? names.map((n) => entered.get(n) ?? 0) : split(Math.round(m.spend), p.map((x) => x.spend));

  const rows = names.map((source, i) => ({
    source,
    spend: spend[i],
    leads: leads[i],
    conversations: conv[i],
    apptsSet: set[i],
    connected: connected[i],
    applicants: apps[i],
    sales: sales[i],
    premium: premium[i],
    cycleDaysSum: cycle[i],
  }));
  const unassigned = client.spend.length > 0 ? entered.get(UNASSIGNED) ?? 0 : 0;
  if (unassigned > 0) rows.push({ ...empty(UNASSIGNED), spend: unassigned });
  return rows;
}

/** Builds rows from attributed live records; anything that can't be matched lands in "Other / unknown". */
export function liveBySource(
  client: Client,
  r: { start: Date; end: Date },
  data: {
    leads: string[]; // source name per lead
    conversations: { source: string; weight: number }[];
    apptsSet: string[];
    connected: string[];
    applicants: { source: string; premium: number; cycleDays: number }[];
    sales: string[];
  },
): SourceRow[] {
  const rows = new Map<string, SourceRow>(client.sources.map((s) => [s.name, empty(s.name)]));
  const row = (name: string) => {
    if (!rows.has(name)) rows.set(name, empty(name));
    return rows.get(name)!;
  };
  data.leads.forEach((s) => row(s).leads++);
  data.conversations.forEach((c) => (row(c.source).conversations += c.weight));
  data.apptsSet.forEach((s) => row(s).apptsSet++);
  data.connected.forEach((s) => row(s).connected++);
  data.applicants.forEach((a) => {
    const x = row(a.source);
    x.applicants++;
    x.premium += a.premium;
    x.cycleDaysSum += a.cycleDays;
  });
  data.sales.forEach((s) => row(s).sales++);
  for (const [name, amount] of enteredSpendBySource(client, r)) row(name).spend += amount;
  for (const x of rows.values()) x.conversations = Math.round(x.conversations);
  return [...rows.values()].filter(
    (x) => client.sources.some((s) => s.name === x.source) || x.leads + x.spend + x.apptsSet + x.applicants > 0,
  );
}
