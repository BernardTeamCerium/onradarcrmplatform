import type { Counts } from "./types";

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export const ZERO_COUNTS: Counts = {
  spend: 0,
  leads: 0,
  conversations: 0,
  apptsSet: 0,
  connected: 0,
  applicants: 0,
  sales: 0,
  premium: 0,
  cycleDaysSum: 0,
};

export function addCounts(a: Counts, b: Counts): Counts {
  return {
    spend: a.spend + b.spend,
    leads: a.leads + b.leads,
    conversations: a.conversations + b.conversations,
    apptsSet: a.apptsSet + b.apptsSet,
    connected: a.connected + b.connected,
    applicants: a.applicants + b.applicants,
    sales: a.sales + b.sales,
    premium: a.premium + b.premium,
    cycleDaysSum: a.cycleDaysSum + b.cycleDaysSum,
  };
}

export const sumCounts = (rows: Counts[]) => rows.reduce(addCounts, { ...ZERO_COUNTS });

/** Rates shown in tables. Costs are "—" when no spend is recorded, rather than a misleading $0. */
export function rates(r: Counts) {
  const spent = r.spend > 0;
  return {
    cpl: spent ? ratio(r.spend, r.leads) : null,
    contactRate: ratio(r.conversations, r.leads),
    connectRate: ratio(r.connected, r.apptsSet),
    cycleDays: ratio(r.cycleDaysSum, r.applicants),
    costPerConnected: spent ? ratio(r.spend, r.connected) : null,
    salesConversion: ratio(r.sales, r.leads),
  };
}
