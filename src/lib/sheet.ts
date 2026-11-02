import "server-only";
import { parseDate, parsePeriod } from "./production";
import { deleteJson, readJson, writeJson } from "./store";
import { REPORT_METRICS, type ReportMetric, type ReportRow, type ReportSheet, type YearRecord } from "./types";

/**
 * The client's reporting Google Sheet. A small Apps Script in the sheet sends every tab here whenever it
 * changes; rows with a month (or date) and numbers become the source of truth for the Overview, Reports and
 * Trends numbers they cover.
 */

const key = (clientId: string) => `reports/${clientId}.json`;
export const loadSheet = (clientId: string) => readJson<ReportSheet>(key(clientId));
export const saveSheet = (clientId: string, sheet: ReportSheet) => writeJson(key(clientId), sheet);
export const deleteSheet = (clientId: string) => deleteJson(key(clientId));

export const METRIC_LABEL: Record<ReportMetric, string> = {
  spend: "Marketing spend",
  leads: "Leads",
  conversations: "Conversations",
  apptsSet: "Appointments",
  connected: "Connected appts",
  applications: "Applications",
  sales: "Sales",
  submitted: "Submitted business",
  paid: "Paid business",
  pending: "Pending submits",
  chargebacks: "Chargebacks",
};
export const MONEY_METRICS: ReportMetric[] = ["spend", "submitted", "paid", "pending", "chargebacks"];

/** The template's columns, in order. */
export const TEMPLATE_HEADERS = ["Month", "Agent", "Source", ...REPORT_METRICS.map((m) => METRIC_LABEL[m])];

const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();
type Col = ReportMetric | "period" | "agent" | "source";
const ALIASES: [Col, string[]][] = [
  ["period", ["month", "date", "day", "week", "week of", "period", "year", "month year"]],
  ["agent", ["agent", "advisor", "adviser", "rep", "producer", "agent name", "writing agent"]],
  ["source", ["source", "lead source", "channel", "campaign", "vendor", "marketing source"]],
  ["spend", ["marketing spend", "spend", "ad spend", "cost", "marketing cost", "amount spent", "budget spent"]],
  ["leads", ["leads", "new leads", "lead count", "total leads", "# leads"]],
  ["conversations", ["conversations", "contacts", "contacted", "conversations started", "contact made"]],
  ["apptsSet", ["appts set", "appointments set", "appointments booked", "appts booked", "booked", "set"]],
  ["connected", ["connected appts", "connected appointments", "connected", "appts held", "appointments held", "held", "shows", "showed", "kept"]],
  ["applications", ["applications", "apps", "apps submitted", "applications submitted", "applicants", "apps written"]],
  ["sales", ["sales", "closed", "policies sold", "sold", "closes", "deals closed"]],
  ["submitted", ["submitted premium", "premium submitted", "submitted", "premium", "submitted production"]],
  ["paid", ["paid premium", "paid", "issued premium", "paid production", "placed premium"]],
  ["pending", ["pending submits", "pending submit", "pending", "pending business", "pending premium", "pending submissions"]],
  ["chargebacks", ["chargebacks", "chargeback", "charge backs", "chargeback premium"]],
];
const colFor = (header: string): Col | undefined => {
  const h = n(header);
  if (!h) return undefined;
  return ALIASES.find(([, names]) => names.includes(h))?.[0];
};

/** "$1,234.50", "1.2M", "45%", "(1,000)" → number; blank or "-" → undefined. */
function num(v: string): number | undefined {
  let s = (v ?? "").trim();
  if (!s || /^[-–—]$/.test(s)) return undefined;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()$,\s]/g, "").replace(/^-/, "");
  const m = s.match(/^(\d*\.?\d+)([kKmM])?%?$/);
  if (!m) return undefined;
  const x = Number(m[1]) * (m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1);
  return neg ? -x : x;
}

/** "9/15/2026" or "2026-09-15" → day; "Sep 2026", "9/2026", "2026-09", "Sep-26" → month; "2026" → year. */
export function periodOf(v: string): string | undefined {
  const s = (v ?? "").trim();
  if (!s) return undefined;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s)) return parseDate(s.slice(0, 10));
  const short = s.match(/^([A-Za-z]{3,9})[\s-]+'?(\d{2})$/); // "Sep-26", "Sep '26"
  if (short) return parsePeriod(`${short[1]} 20${short[2]}`);
  const p = parsePeriod(s.replace(/-(\d{4})$/, " $1"));
  if (p) return p;
  if (/\d{4}/.test(s) && /[A-Za-z]/.test(s) && !Number.isNaN(Date.parse(s))) return parseDate(s); // "September 15, 2026"
  return undefined;
}

export interface IncomingTab {
  name: string;
  rows: string[][];
}

/** Reads every tab that has a Month/Date column plus at least one number column. */
export function readSheet(input: { name: string; url?: string; tabs: IncomingTab[]; onlyTab?: string }): ReportSheet {
  const rows: ReportRow[] = [];
  const skipped: ReportSheet["skipped"] = [];
  const used: string[] = [];
  const metrics = new Set<ReportMetric>();
  const ignored = new Set<string>();
  let hasAgent = false;
  let hasSource = false;
  const tabs = input.onlyTab ? input.tabs.filter((t) => t.name.trim().toLowerCase() === input.onlyTab!.trim().toLowerCase()) : input.tabs;
  for (const tab of tabs) {
    // The header is the first of the top 10 rows that names a period column and a metric.
    const headerIdx = tab.rows.slice(0, 10).findIndex((r) => {
      const cols = r.map((c) => colFor(String(c)));
      return cols.includes("period") && cols.some((c) => c && (REPORT_METRICS as readonly string[]).includes(c));
    });
    if (headerIdx < 0) continue;
    const header = tab.rows[headerIdx].map((c) => String(c));
    const cols = header.map(colFor);
    const seen = new Set<Col>();
    const map = cols.map((c) => (c && !seen.has(c) ? (seen.add(c), c) : undefined)); // first column wins
    header.forEach((h, i) => {
      if (h.trim() && !map[i]) ignored.add(h.trim());
    });
    used.push(tab.name);
    for (const m of map) if (m && (REPORT_METRICS as readonly string[]).includes(m)) metrics.add(m as ReportMetric);
    if (map.includes("agent")) hasAgent = true;
    if (map.includes("source")) hasSource = true;
    tab.rows.slice(headerIdx + 1).forEach((r, k) => {
      const cells = r.map((c) => String(c ?? ""));
      if (!cells.some((c) => c.trim())) return;
      const at = (c: Col) => {
        const i = map.indexOf(c);
        return i >= 0 ? (cells[i] ?? "").trim() : "";
      };
      const rawPeriod = at("period");
      if (/^(total|totals|ytd|grand total|sum|average|avg)\b/i.test(rawPeriod)) return; // summary rows
      const period = periodOf(rawPeriod);
      if (!period) {
        skipped.push({ tab: tab.name, row: headerIdx + k + 2, reason: rawPeriod ? `"${rawPeriod}" isn't a month or date` : "No month" });
        return;
      }
      const values: ReportRow["values"] = {};
      for (const m of REPORT_METRICS) {
        if (!map.includes(m)) continue;
        const v = num(at(m));
        if (v !== undefined) values[m] = v;
      }
      if (Object.keys(values).length === 0) return;
      rows.push({ period, agent: at("agent") || undefined, source: at("source") || undefined, values });
    });
  }
  return {
    syncedAt: new Date().toISOString(),
    name: input.name || "Reporting sheet",
    url: input.url,
    tabs: used,
    metrics: REPORT_METRICS.filter((m) => metrics.has(m)),
    hasAgent,
    hasSource,
    rows,
    skipped: skipped.slice(0, 50),
    ignoredColumns: [...ignored].slice(0, 30),
  };
}

// ---------------------------------------------------------------------------
// Totals over a date range. A month (or year) row is spread evenly over its days, so any range works;
// the current month only counts the days so far.

const DAY = 86_400_000;
function window(period: string, now: Date) {
  const [y, m, d] = period.split("-").map(Number);
  const start = d ? Date.UTC(y, m - 1, d) : m ? Date.UTC(y, m - 1, 1) : Date.UTC(y, 0, 1);
  let end = d ? start + DAY : m ? Date.UTC(y, m, 1) : Date.UTC(y + 1, 0, 1);
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY;
  if (start < tomorrow) end = Math.min(end, tomorrow);
  return { start, end };
}

/** Share of a row that falls inside [start, end). */
export function rowShare(period: string, start: Date, end: Date, now = new Date()) {
  const w = window(period, now);
  const overlap = Math.max(0, Math.min(w.end, end.getTime()) - Math.max(w.start, start.getTime()));
  return w.end > w.start ? overlap / (w.end - w.start) : 0;
}

export type Totals = Partial<Record<ReportMetric, number>>;

/** Metrics that are a snapshot at month end, not a running count: a range shows its latest month instead of a sum. */
export const SNAPSHOT_METRICS: ReportMetric[] = ["pending"];

function accumulate(rows: ReportRow[], start: Date, end: Date, now: Date): Totals {
  const out: Totals = {};
  let latest = "";
  for (const r of rows) {
    const f = rowShare(r.period, start, end, now);
    if (f <= 0) continue;
    for (const [m, v] of Object.entries(r.values) as [ReportMetric, number][]) {
      if (SNAPSHOT_METRICS.includes(m)) {
        if (r.period > latest) latest = r.period;
        continue;
      }
      out[m] = (out[m] ?? 0) + v * f;
    }
  }
  if (latest) {
    for (const m of SNAPSHOT_METRICS) {
      const at = rows.filter((r) => r.period === latest && r.values[m] !== undefined);
      if (at.length) out[m] = at.reduce((a, r) => a + r.values[m]!, 0);
    }
  }
  return out;
}

export function totalsIn(rows: ReportRow[], start: Date, end: Date, filter?: (r: ReportRow) => boolean, now = new Date()): Totals {
  return accumulate(filter ? rows.filter(filter) : rows, start, end, now);
}

/** Totals grouped by a key (agent, source or month) within [start, end). */
export function groupTotals(rows: ReportRow[], by: (r: ReportRow) => string | undefined, start: Date, end: Date, now = new Date()) {
  const keyed = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const k = by(r);
    if (!k) continue;
    if (!keyed.has(k)) keyed.set(k, []);
    keyed.get(k)!.push(r);
  }
  const groups = new Map<string, Totals>();
  for (const [k, rs] of keyed) {
    const t = accumulate(rs, start, end, now);
    if (Object.keys(t).length) groups.set(k, t);
  }
  return groups;
}

/** Years covered by the sheet, newest first. */
export const sheetYears = (sheet: ReportSheet) => [...new Set(sheet.rows.map((r) => Number(r.period.slice(0, 4))))].sort((a, b) => b - a);

/** Overlays the sheet's yearly totals onto the Trends records (targets still come from settings). */
export function mergeSheetYears(records: YearRecord[], sheet: ReportSheet | null, now = new Date()) {
  const fromSheet = new Set<number>();
  if (!sheet) return { years: records, fromSheet };
  const map: [ReportMetric, keyof YearRecord][] = [
    ["submitted", "submitted"], ["paid", "paid"], ["chargebacks", "chargebacks"], ["apptsSet", "apptsSet"], ["connected", "connectedAppts"],
  ];
  const usable = map.filter(([m]) => sheet.metrics.includes(m));
  if (usable.length === 0) return { years: records, fromSheet };
  const byYear = new Map(records.map((r) => [r.year, { ...r }]));
  for (const year of sheetYears(sheet)) {
    const t = totalsIn(sheet.rows, new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1)), undefined, now);
    const r = byYear.get(year) ?? { year, submitted: 0, paid: 0, chargebacks: 0, apptsSet: 0, connectedAppts: 0 };
    for (const [m, k] of usable) (r as unknown as Record<string, number>)[k] = Math.round(t[m] ?? 0);
    byYear.set(year, r);
    fromSheet.add(year);
  }
  return { years: [...byYear.values()].sort((a, b) => a.year - b.year), fromSheet };
}

// ---------------------------------------------------------------------------
// The Apps Script that lives in the sheet (Extensions → Apps Script).

export function sheetScript(endpoint: string) {
  return `/**
 * OnRadar CRM: send this reporting sheet to the dashboard whenever it changes.
 * 1. In the Google Sheet: Extensions → Apps Script. Delete what's there, paste this, click Save.
 * 2. Choose "setup" in the function menu and click Run. Approve the permissions.
 * 3. Done. Edits show on the dashboard within about a minute (and it re-sends every 15 minutes as a backup).
 * It only reads the sheet; it never changes it.
 */
const ENDPOINT = ${JSON.stringify(endpoint)};
// Leave blank to read every tab that has a Month column, or put one tab's name (e.g. "Data") to read only that tab.
const ONLY_TAB = "";

function setup() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendSheet") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendSheet").forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger("sendSheet").timeBased().everyMinutes(15).create();
  sendSheet();
}

function sendSheet() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const ss = SpreadsheetApp.getActive();
    const tabs = ss.getSheets()
      .filter(function (s) { return !s.isSheetHidden(); })
      .slice(0, 12)
      .map(function (s) { return { name: s.getName(), rows: s.getDataRange().getDisplayValues().slice(0, 5000) }; });
    const res = UrlFetchApp.fetch(ENDPOINT, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify({ name: ss.getName(), url: ss.getUrl(), onlyTab: ONLY_TAB, tabs: tabs }),
    });
    if (res.getResponseCode() >= 300) throw new Error("OnRadar " + res.getResponseCode() + ": " + res.getContentText());
    console.log(res.getContentText());
  } finally {
    lock.releaseLock();
  }
}
`;
}
