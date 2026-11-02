import "server-only";
import { loadSheet } from "./sheet";
import { readJson, writeJson } from "./store";
import { MONTHLY_FIELDS, REPORT_METRICS, type MonthlyEntry, type ReportMetric, type ReportRow, type ReportSheet } from "./types";

/**
 * Monthly numbers the team types in on the Overview: appointments, connected appointments, submitted business,
 * paid business and pending submits. They feed the same reporting as the Google Sheet; for a month the team
 * has entered, their numbers win over the sheet's.
 */

const key = (clientId: string) => `monthly/${clientId}.json`;
export const loadMonthly = async (clientId: string) => (await readJson<MonthlyEntry[]>(key(clientId))) ?? [];

const queues = new Map<string, Promise<unknown>>();
export function withMonthly<T>(clientId: string, fn: (entries: MonthlyEntry[]) => T): Promise<T> {
  const run = (queues.get(clientId) ?? Promise.resolve()).then(async () => {
    const entries = await loadMonthly(clientId);
    const result = fn(entries);
    entries.sort((a, b) => b.month.localeCompare(a.month));
    await writeJson(key(clientId), entries);
    return result;
  });
  queues.set(clientId, run.catch(() => undefined));
  return run;
}

/** The sheet and the team's monthly numbers, combined (null when there's neither). */
export async function loadReporting(clientId: string): Promise<ReportSheet | null> {
  const [sheet, monthly] = await Promise.all([loadSheet(clientId), loadMonthly(clientId)]);
  const entered = monthly.filter((e) => Object.keys(e.values).length > 0);
  if (!entered.length) return sheet;
  const fields = new Set<ReportMetric>(entered.flatMap((e) => Object.keys(e.values) as ReportMetric[]));
  const months = new Map(entered.map((e) => [e.month, e]));
  // Sheet rows in an entered month lose the numbers the team typed in for that month.
  const sheetRows: ReportRow[] = (sheet?.rows ?? []).flatMap((r) => {
    const e = months.get(r.period.slice(0, 7));
    if (!e) return [r];
    const values = Object.fromEntries(Object.entries(r.values).filter(([m]) => !(m in e.values)));
    return Object.keys(values).length ? [{ ...r, values }] : [];
  });
  const rows = [...sheetRows, ...entered.map((e): ReportRow => ({ period: e.month, values: { ...e.values } }))];
  const latest = entered.reduce((a, e) => (e.updatedAt > a ? e.updatedAt : a), "");
  return {
    syncedAt: sheet && sheet.syncedAt > latest ? sheet.syncedAt : latest,
    name: sheet ? sheet.name : "Monthly numbers",
    url: sheet?.url,
    tabs: sheet?.tabs ?? [],
    metrics: REPORT_METRICS.filter((m) => fields.has(m) || sheet?.metrics.includes(m)),
    hasAgent: !!sheet?.hasAgent,
    hasSource: !!sheet?.hasSource,
    rows,
    skipped: sheet?.skipped ?? [],
    ignoredColumns: sheet?.ignoredColumns ?? [],
  };
}

export const isMonthlyField = (k: string): k is (typeof MONTHLY_FIELDS)[number] => (MONTHLY_FIELDS as readonly string[]).includes(k);
