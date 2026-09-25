import "server-only";
import { split, splitCapped } from "./sources";
import type { Counts, GeoCell, SourceRow } from "./types";

export const UNKNOWN_PLACE = "Unknown";

interface Place {
  city: string;
  state: string;
  /** Share of leads. */
  share: number;
  /** How well leads here convert, relative to average. */
  perf: number;
  /** Lead-to-application speed multiplier (lower = faster). */
  cycle: number;
  /** Media market, used for TV and radio reach. */
  market: "nola" | "northshore" | "br" | "acadiana" | "coast";
}

/**
 * Sample geography around Sibley's Mandeville, LA office: the Northshore, greater New Orleans,
 * Baton Rouge, Acadiana and the Mississippi Gulf Coast. Fictional distribution for demos only.
 */
const PLACES: Place[] = [
  { city: "Mandeville", state: "LA", share: 0.11, perf: 1.25, cycle: 0.85, market: "northshore" },
  { city: "Covington", state: "LA", share: 0.09, perf: 1.2, cycle: 0.88, market: "northshore" },
  { city: "Slidell", state: "LA", share: 0.09, perf: 1.05, cycle: 0.95, market: "northshore" },
  { city: "Hammond", state: "LA", share: 0.06, perf: 0.9, cycle: 1.05, market: "northshore" },
  { city: "Metairie", state: "LA", share: 0.1, perf: 1.1, cycle: 0.95, market: "nola" },
  { city: "New Orleans", state: "LA", share: 0.14, perf: 0.88, cycle: 1.1, market: "nola" },
  { city: "Houma", state: "LA", share: 0.04, perf: 0.85, cycle: 1.15, market: "nola" },
  { city: "Baton Rouge", state: "LA", share: 0.13, perf: 1.0, cycle: 1.0, market: "br" },
  { city: "Lafayette", state: "LA", share: 0.06, perf: 0.95, cycle: 1.05, market: "acadiana" },
  { city: "Gulfport", state: "MS", share: 0.06, perf: 1.0, cycle: 1.0, market: "coast" },
  { city: "Biloxi", state: "MS", share: 0.05, perf: 0.95, cycle: 1.05, market: "coast" },
  { city: "Hattiesburg", state: "MS", share: 0.04, perf: 0.9, cycle: 1.1, market: "coast" },
  { city: "Picayune", state: "MS", share: 0.03, perf: 0.92, cycle: 1.05, market: "northshore" },
];

/** Where each source reaches: broadcast is tied to media markets, digital and bought leads are broad. */
function reach(source: string, p: Place) {
  const s = source.toLowerCase();
  if (s === "tv") return { nola: 1.35, northshore: 1.3, br: 1.15, acadiana: 0.35, coast: 0.3 }[p.market];
  if (s === "radio") return { northshore: 2.0, nola: 0.8, br: 0.4, acadiana: 0.2, coast: 0.3 }[p.market];
  if (s.startsWith("lead seller")) return p.state === "MS" ? 1.4 : 0.95;
  return 1;
}

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** Splits each source's totals across sample places, so cells always add back up to the source rows. */
export function sampleByGeo(rows: SourceRow[]): GeoCell[] {
  const cells: GeoCell[] = [];
  for (const r of rows) {
    if (r.leads === 0 && r.spend === 0) continue;
    // Each source does a little better or worse in each place, so the best source varies by city.
    const perf = PLACES.map((p) => p.perf * (0.82 + hash(`${r.source}|${p.city}`) * 0.36));
    const leads = split(r.leads, PLACES.map((p) => p.share * reach(r.source, p)));
    const conv = splitCapped(r.conversations, leads.map((l, i) => l * perf[i]), leads);
    const set = splitCapped(r.apptsSet, conv.map((c, i) => c * perf[i]), conv.map((c, i) => Math.max(c, leads[i])));
    const connected = splitCapped(r.connected, set.map((s, i) => s * perf[i]), set);
    const apps = splitCapped(r.applicants, connected.map((c, i) => c * perf[i]), connected);
    const sales = splitCapped(r.sales, apps.map((a, i) => a * perf[i]), apps);
    const premium = split(Math.round(r.premium), apps);
    const cycleW = apps.map((a, i) => a * PLACES[i].cycle);
    const cycleTotal = cycleW.reduce((a, b) => a + b, 0);
    const leadTotal = leads.reduce((a, b) => a + b, 0);
    PLACES.forEach((p, i) => {
      cells.push({
        state: p.state,
        city: p.city,
        source: r.source,
        spend: leadTotal > 0 ? (r.spend * leads[i]) / leadTotal : r.spend / PLACES.length,
        leads: leads[i],
        conversations: conv[i],
        apptsSet: set[i],
        connected: connected[i],
        applicants: apps[i],
        sales: sales[i],
        premium: premium[i],
        cycleDaysSum: cycleTotal > 0 ? (r.cycleDaysSum * cycleW[i]) / cycleTotal : 0,
      });
    });
  }
  return cells;
}

export interface GeoFact {
  source: string;
  city: string;
  state: string;
}

const blank = (f: GeoFact): GeoCell => ({
  ...f,
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

/** Builds cells from attributed live records; each source's spend is shared across places by its leads. */
export function liveByGeo(
  sourceRows: SourceRow[],
  facts: {
    leads: GeoFact[];
    conversations: (GeoFact & { weight: number })[];
    apptsSet: GeoFact[];
    connected: GeoFact[];
    applicants: (GeoFact & { premium: number; cycleDays: number })[];
    sales: GeoFact[];
  },
): GeoCell[] {
  const cells = new Map<string, GeoCell>();
  const cell = (f: GeoFact) => {
    const key = `${f.source}|${f.state}|${f.city}`;
    if (!cells.has(key)) cells.set(key, blank({ source: f.source, state: f.state, city: f.city }));
    return cells.get(key)!;
  };
  facts.leads.forEach((f) => cell(f).leads++);
  facts.conversations.forEach((f) => (cell(f).conversations += f.weight));
  facts.apptsSet.forEach((f) => cell(f).apptsSet++);
  facts.connected.forEach((f) => cell(f).connected++);
  facts.applicants.forEach((f) => {
    const c = cell(f);
    c.applicants++;
    c.premium += f.premium;
    c.cycleDaysSum += f.cycleDays;
  });
  facts.sales.forEach((f) => cell(f).sales++);
  const all = [...cells.values()];
  for (const r of sourceRows) {
    if (r.spend <= 0) continue;
    const mine = all.filter((c) => c.source === r.source);
    const leads = mine.reduce((a, c) => a + c.leads, 0);
    if (mine.length === 0) all.push({ ...blank({ source: r.source, state: UNKNOWN_PLACE, city: UNKNOWN_PLACE }), spend: r.spend });
    else mine.forEach((c) => (c.spend += leads > 0 ? (r.spend * c.leads) / leads : r.spend / mine.length));
  }
  all.forEach((c) => (c.conversations = Math.round(c.conversations)));
  return all;
}

export function cleanPlace(city?: string, state?: string) {
  const st = (state ?? "").trim();
  return {
    city: (city ?? "").trim().replace(/\b\w/g, (ch) => ch.toUpperCase()) || UNKNOWN_PLACE,
    state: st.length === 2 ? st.toUpperCase() : st || UNKNOWN_PLACE,
  };
}

export type { Counts };
