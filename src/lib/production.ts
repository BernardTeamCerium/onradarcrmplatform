import "server-only";
import { newId, readJson, writeJson } from "./store";
import type { Agent, CaseStatus, Client, ProductionEntry, YearRecord } from "./types";

const key = (clientId: string) => `production/${clientId}.json`;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Storage (serialised per client, like leads)

const queues = new Map<string, Promise<unknown>>();
export function withProduction<T>(client: Client, fn: (entries: ProductionEntry[]) => T | Promise<T>): Promise<T> {
  const prev = queues.get(client.id) ?? Promise.resolve();
  const run = prev.then(async () => {
    const entries = await loadProduction(client);
    const result = await fn(entries);
    await writeJson(key(client.id), entries);
    return result;
  });
  queues.set(client.id, run.catch(() => undefined));
  return run;
}

export async function loadProduction(client: Client): Promise<ProductionEntry[]> {
  const stored = await readJson<ProductionEntry[]>(key(client.id));
  if (stored) return stored;
  const seeded = client.id === "cl_sibley" ? sibleySample(client) : [];
  await writeJson(key(client.id), seeded);
  return seeded;
}

// ---------------------------------------------------------------------------
// Totals

export interface ProdTotals {
  submitted: number;
  paid: number;
  chargebacks: number;
  cases: number;
}
const zero = (): ProdTotals => ({ submitted: 0, paid: 0, chargebacks: 0, cases: 0 });

const yearOf = (d?: string) => (d ? Number(d.slice(0, 4)) : NaN);

/** Adds one entry's amounts into per-key buckets; `keyFor` picks the bucket from a date or period. */
function tally(entries: ProductionEntry[], keyFor: (dateOrPeriod: string) => string | null, into: Map<string, ProdTotals>, filter?: (e: ProductionEntry) => boolean) {
  const add = (k: string | null, f: keyof ProdTotals, v: number) => {
    if (!k || !v) return;
    if (!into.has(k)) into.set(k, zero());
    into.get(k)![f] += v;
  };
  for (const e of entries) {
    if (filter && !filter(e)) continue;
    if (e.kind === "summary" && e.period) {
      const k = keyFor(e.period);
      add(k, "submitted", e.submitted ?? 0);
      add(k, "paid", e.paid ?? 0);
      add(k, "chargebacks", e.chargebacks ?? 0);
      add(k, "cases", e.cases ?? 0);
    } else if (e.kind === "case" && e.date) {
      const premium = e.premium ?? 0;
      add(keyFor(e.date), "submitted", premium);
      add(keyFor(e.date), "cases", 1);
      if (e.status === "Paid" || e.status === "Chargeback") add(keyFor(e.paidDate ?? e.date), "paid", premium);
      if (e.status === "Chargeback") add(keyFor(e.chargebackDate ?? e.paidDate ?? e.date), "chargebacks", e.chargebackAmount ?? premium);
    }
  }
  return into;
}

export function totalsByYear(entries: ProductionEntry[]) {
  return tally(entries, (d) => d.slice(0, 4), new Map());
}

export function totalsByAgent(entries: ProductionEntry[], year?: number) {
  const out = new Map<string, ProdTotals>();
  const names = [...new Set(entries.map((e) => e.agentName))];
  for (const name of names) {
    const m = tally(entries, (d) => (year === undefined || yearOf(d) === year ? "x" : null), new Map(), (e) => e.agentName === name);
    if (m.has("x")) out.set(name, m.get("x")!);
  }
  return out;
}

/** Years that have any production logged. */
export function productionYears(entries: ProductionEntry[]) {
  return [...totalsByYear(entries).keys()].map(Number).sort((a, b) => a - b);
}

/**
 * Overlays logged production onto the yearly records used by Trends: years with production use the
 * logged submitted / paid / chargebacks; appointment counts and targets still come from the records.
 */
export function mergeYearly(records: YearRecord[], entries: ProductionEntry[]): { years: YearRecord[]; fromLog: Set<number> } {
  const totals = totalsByYear(entries);
  const fromLog = new Set<number>();
  const byYear = new Map(records.map((r) => [r.year, { ...r }]));
  for (const [y, t] of totals) {
    const year = Number(y);
    fromLog.add(year);
    const r = byYear.get(year) ?? { year, submitted: 0, paid: 0, chargebacks: 0, apptsSet: 0, connectedAppts: 0 };
    byYear.set(year, { ...r, submitted: t.submitted, paid: t.paid, chargebacks: t.chargebacks });
  }
  return { years: [...byYear.values()].sort((a, b) => a.year - b.year), fromLog };
}

/** Submitted premium dated inside [start, end); month and year totals are spread evenly over their days. */
export function submittedInRange(entries: ProductionEntry[], start: Date, end: Date, today = new Date()) {
  let sum = 0;
  const s = start.getTime();
  const e = end.getTime();
  for (const x of entries) {
    if (x.kind === "case" && x.date) {
      const t = Date.parse(`${x.date}T12:00:00Z`);
      if (t >= s && t < e) sum += x.premium ?? 0;
    } else if (x.kind === "summary" && x.period && x.submitted) {
      const [y, m] = x.period.split("-").map(Number);
      const ps = Date.UTC(y, m ? m - 1 : 0, 1);
      let pe = m ? Date.UTC(y, m, 1) : Date.UTC(y + 1, 0, 1);
      // A current-period total only covers the days so far.
      pe = Math.min(pe, Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) + DAY);
      const days = Math.max(1, Math.round((pe - ps) / DAY));
      const overlap = Math.max(0, Math.round((Math.min(pe, e) - Math.max(ps, s)) / DAY));
      sum += (x.submitted * overlap) / days;
    }
  }
  return sum;
}

export const hasProduction = (entries: ProductionEntry[]) => entries.length > 0;

// ---------------------------------------------------------------------------
// CSV import / export

export const CASE_HEADERS = ["date", "client_name", "agent", "carrier", "product", "premium", "status", "paid_date", "chargeback_date", "chargeback_amount", "source", "notes"];
export const TOTAL_HEADERS = ["period", "agent", "submitted", "paid", "chargebacks", "cases"];

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

const money = (v: string | undefined) => {
  if (!v) return undefined;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

/** Accepts 2026-03-15, 3/15/2026 or 03/15/26. */
export function parseDate(v: string | undefined) {
  const s = (v ?? "").trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

/** "2025", "2025-03", "3/2025", "Mar 2025" → normalised period, or undefined. */
export function parsePeriod(v: string | undefined) {
  const s = (v ?? "").trim();
  const ok = (y: number, mo: number) => y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12;
  if (/^\d{4}$/.test(s)) return Number(s) >= 1990 && Number(s) <= 2100 ? s : undefined;
  if (/^\d{4}-\d{2}$/.test(s)) return ok(Number(s.slice(0, 4)), Number(s.slice(5))) ? s : undefined;
  let m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return ok(Number(m[2]), Number(m[1])) ? `${m[2]}-${m[1].padStart(2, "0")}` : undefined;
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (m) {
    const i = new Date(`${m[1]} 1, 2000`).getMonth();
    if (!Number.isNaN(i)) return `${m[2]}-${String(i + 1).padStart(2, "0")}`;
  }
  return undefined;
}

export function normaliseStatus(v: string | undefined): CaseStatus {
  const s = (v ?? "").toLowerCase();
  if (/charge|cancel|lapse|refund/.test(s)) return "Chargeback";
  if (/paid|issued|placed|in force|inforce/.test(s)) return "Paid";
  if (/declin|withdr|not taken|rejected/.test(s)) return "Declined";
  return "Submitted";
}

export function matchAgent(agents: Agent[], name: string) {
  const n = name.trim().toLowerCase().replace(/\s*\(sample\)\s*$/, "");
  return agents.find((a) => a.name.toLowerCase().replace(/\s*\(sample\)\s*$/, "") === n);
}

export interface ImportResult {
  kind: "cases" | "totals";
  added: number;
  replaced: number;
  skipped: { row: number; reason: string }[];
}

/** Parses a CSV of cases or totals (detected from the headers) into entries. */
export function entriesFromCsv(client: Client, text: string, by: string): { kind: "cases" | "totals"; entries: ProductionEntry[]; skipped: ImportResult["skipped"] } {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length < 2) return { kind: "cases", entries: [], skipped: [{ row: 1, reason: "No data rows found" }] };
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (r: string[], ...names: string[]) => {
    for (const n of names) {
      const i = head.indexOf(n);
      if (i >= 0) return (r[i] ?? "").trim();
    }
    return "";
  };
  const kind = head.includes("period") ? "totals" : "cases";
  const now = new Date().toISOString();
  const entries: ProductionEntry[] = [];
  const skipped: ImportResult["skipped"] = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const agentName = col(r, "agent", "agent_name", "writing_agent");
    if (!agentName) return skipped.push({ row: line, reason: "Missing agent" });
    const agent = matchAgent(client.agents, agentName);
    if (kind === "totals") {
      const period = parsePeriod(col(r, "period", "month", "year"));
      if (!period) return skipped.push({ row: line, reason: "Period must look like 2025 or 2025-03" });
      const submitted = money(col(r, "submitted", "submitted_premium"));
      const paid = money(col(r, "paid", "paid_premium"));
      const chargebacks = money(col(r, "chargebacks", "chargeback"));
      if (submitted === undefined && paid === undefined && chargebacks === undefined) return skipped.push({ row: line, reason: "No amounts" });
      entries.push({
        id: newId("pr"), kind: "summary", period, agentName: agent?.name ?? agentName, agentId: agent?.id,
        submitted, paid, chargebacks, cases: money(col(r, "cases", "count", "policies")), createdAt: now, createdBy: by,
      });
    } else {
      const date = parseDate(col(r, "date", "submitted_date", "app_date", "application_date"));
      const premium = money(col(r, "premium", "amount", "submitted_premium"));
      if (!date) return skipped.push({ row: line, reason: "Date missing or not recognised" });
      if (premium === undefined) return skipped.push({ row: line, reason: "Premium missing" });
      entries.push({
        id: newId("pr"), kind: "case", date, agentName: agent?.name ?? agentName, agentId: agent?.id,
        clientName: col(r, "client_name", "client", "insured", "name") || undefined,
        carrier: col(r, "carrier", "company") || undefined,
        product: col(r, "product", "product_type", "plan") || undefined,
        premium,
        status: normaliseStatus(col(r, "status")),
        paidDate: parseDate(col(r, "paid_date", "issue_date")),
        chargebackDate: parseDate(col(r, "chargeback_date")),
        chargebackAmount: money(col(r, "chargeback_amount")),
        source: col(r, "source", "lead_source") || undefined,
        notes: col(r, "notes") || undefined,
        createdAt: now,
        createdBy: by,
      });
    }
  });
  return { kind, entries, skipped };
}

/** Merges imported entries: totals replace the same agent + period; identical cases aren't added twice. */
export function mergeImport(existing: ProductionEntry[], incoming: ProductionEntry[]) {
  let added = 0;
  let replaced = 0;
  const caseKey = (e: ProductionEntry) => `${e.date}|${(e.clientName ?? "").toLowerCase()}|${e.premium}|${e.agentName.toLowerCase()}`;
  const cases = new Set(existing.filter((e) => e.kind === "case").map(caseKey));
  for (const e of incoming) {
    if (e.kind === "summary") {
      const i = existing.findIndex((x) => x.kind === "summary" && x.period === e.period && x.agentName.toLowerCase() === e.agentName.toLowerCase());
      if (i >= 0) {
        existing[i] = { ...e, id: existing[i].id };
        replaced++;
      } else {
        existing.push(e);
        added++;
      }
    } else if (!cases.has(caseKey(e))) {
      existing.push(e);
      cases.add(caseKey(e));
      added++;
    }
  }
  return { added, replaced };
}

export function exportCsv(entries: ProductionEntry[]) {
  const header = ["type", "date_or_period", "agent", "client_name", "carrier", "product", "premium", "status", "paid_date", "chargeback_date", "chargeback_amount", "submitted", "paid", "chargebacks", "cases", "source", "notes"];
  const rows = [...entries]
    .sort((a, b) => (b.date ?? b.period ?? "").localeCompare(a.date ?? a.period ?? ""))
    .map((e) => [
      e.kind === "case" ? "case" : "total", e.date ?? e.period, e.agentName, e.clientName, e.carrier, e.product, e.premium, e.status,
      e.paidDate, e.chargebackDate, e.chargebackAmount, e.submitted, e.paid, e.chargebacks, e.cases, e.source, e.notes,
    ]);
  return toCsv([header, ...rows]);
}

// ---------------------------------------------------------------------------
// Sibley sample: their reported yearly totals spread across agents and months (agent split is fictional),
// plus a few individual cases this month to show day-to-day logging.

function sibleySample(client: Client): ProductionEntry[] {
  const now = new Date().toISOString();
  const agents = client.agents.length ? client.agents : [{ id: "ag_troy", name: "Troy Sibley" }];
  const shares = agents.map((_, i) => (i === 0 ? 0.58 : 0.42 / Math.max(1, agents.length - 1)));
  const season = [0.07, 0.075, 0.085, 0.085, 0.085, 0.08, 0.075, 0.08, 0.085, 0.09, 0.09, 0.1];
  const years: { year: number; months: number; submitted: number; paid: number; chargebacks: number; fixed?: Record<number, number> }[] = [
    { year: 2024, months: 12, submitted: 29_000_000, paid: 22_000_000, chargebacks: 2_000_000 },
    { year: 2025, months: 12, submitted: 44_000_000, paid: 32_000_000, chargebacks: 5_000_000 },
    { year: 2026, months: 9, submitted: 32_000_000, paid: 20_000_000, chargebacks: 3_000_000, fixed: { 9: 5_600_000 } },
  ];
  // Split `total` into whole-thousand parts proportional to weights, summing exactly to total.
  const split = (total: number, w: number[]) => {
    const sum = w.reduce((a, b) => a + b, 0);
    const parts = w.map((x) => Math.floor(((total * x) / sum) / 1000) * 1000);
    parts[parts.length - 1] += total - parts.reduce((a, b) => a + b, 0);
    return parts;
  };
  const out: ProductionEntry[] = [];
  for (const y of years) {
    const w = season.slice(0, y.months);
    const monthly = (total: number, fixed?: Record<number, number>) => {
      if (!fixed) return split(total, w);
      const fixedSum = Object.values(fixed).reduce((a, b) => a + b, 0);
      const freeIdx = w.map((_, i) => i).filter((i) => fixed[i + 1] === undefined);
      const free = split(total - fixedSum, freeIdx.map((i) => w[i]));
      return w.map((_, i) => fixed[i + 1] ?? free[freeIdx.indexOf(i)]);
    };
    const sub = monthly(y.submitted, y.fixed);
    const paid = monthly(y.paid);
    const cb = monthly(y.chargebacks);
    for (let m = 0; m < y.months; m++) {
      const period = `${y.year}-${String(m + 1).padStart(2, "0")}`;
      const s = split(sub[m], shares);
      const p = split(paid[m], shares);
      const c = split(cb[m], shares);
      agents.forEach((a, i) => {
        out.push({
          id: newId("pr"), kind: "summary", period, agentName: a.name, agentId: a.id,
          submitted: s[i], paid: p[i], chargebacks: c[i], cases: Math.max(1, Math.round(s[i] / 180_000)),
          createdAt: now, createdBy: "Sample data", sample: true,
        });
      });
    }
  }
  const cases: [string, string, string, string, number, CaseStatus][] = [
    ["2026-10-01", "Robert Wallace", "Fixed indexed annuity", "Sample Carrier A", 425_000, "Submitted"],
    ["2026-10-01", "Linda Perry", "MYGA", "Sample Carrier B", 180_000, "Submitted"],
    ["2026-10-02", "Margaret Doucet", "Fixed indexed annuity", "Sample Carrier A", 310_000, "Submitted"],
    ["2026-10-02", "James Coleman", "Indexed universal life", "Sample Carrier C", 24_000, "Submitted"],
  ];
  cases.forEach(([date, name, product, carrier, premium, status], i) => {
    const a = agents[i % agents.length];
    out.push({
      id: newId("pr"), kind: "case", date, clientName: name, product, carrier, premium, status, agentName: a.name, agentId: a.id,
      createdAt: now, createdBy: "Sample data", sample: true,
    });
  });
  return out;
}
