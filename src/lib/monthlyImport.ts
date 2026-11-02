import "server-only";
import { readSheet } from "./sheet";
import { MONTHLY_FIELDS, type MonthlyField } from "./types";

/**
 * Reads a production report workbook into monthly numbers. Understands two layouts:
 *  - Report style (e.g. Sibley's "SFG Numbers"): one tab per measure ("Connected Appointments", "Submitted Business",
 *    "Paid Business", "Chargebacks"), each with a block per year: a header row of month names, then one row per agent.
 *  - List style: a Month column plus one column per measure (the reporting template).
 */

export interface ImportResult {
  months: Map<string, Partial<Record<MonthlyField, number>>>;
  /** Yearly chargebacks (positive amounts). */
  chargebacks: Map<number, number>;
  notes: string[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (cell: string) => {
  const s = cell.trim().toLowerCase();
  const i = MONTHS.indexOf(s.slice(0, 3));
  return i >= 0 && /^[a-z]{3,9}\.?$/.test(s) ? i + 1 : 0;
};
const num = (s: string) => {
  const t = (s ?? "").trim().replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return undefined;
  return Number(t);
};

function measureOf(tab: string): MonthlyField | "chargebacks" | undefined {
  const t = tab.toLowerCase();
  if (/chargeback/.test(t)) return "chargebacks";
  if (/connect|held|kept|show/.test(t)) return "connected";
  if (/pending/.test(t)) return "pending";
  if (/paid|issued|placed/.test(t)) return "paid";
  if (/submit|written/.test(t)) return "submitted";
  if (/appoint|appt/.test(t)) return "apptsSet";
  return undefined;
}

const isTotalLabel = (s: string) => /^(grand\s+)?totals?$|^sum$/i.test(s.trim());

export function importWorkbook(tabs: { name: string; rows: string[][] }[]): ImportResult {
  const out: ImportResult = { months: new Map(), chargebacks: new Map(), notes: [] };
  const put = (month: string, f: MonthlyField, v: number) => {
    const e = out.months.get(month) ?? {};
    e[f] = (e[f] ?? 0) + v;
    out.months.set(month, e);
  };

  for (const tab of tabs) {
    const measure = measureOf(tab.name);
    if (!measure) continue;
    let lastYear = 0;
    for (let i = 0; i < tab.rows.length; i++) {
      const row = tab.rows[i] ?? [];
      const monthCols = row.map((c) => monthOf(String(c ?? "")));
      const yearCell = row.find((c) => /\b(20\d{2})\b/.test(String(c ?? "")));
      const year = yearCell ? Number(String(yearCell).match(/\b(20\d{2})\b/)![1]) : 0;

      // Yearly block (Chargebacks): "2024 Chargebacks | … | Grand Total", then agent rows.
      if (measure === "chargebacks") {
        const totalCol = row.findIndex((c) => isTotalLabel(String(c ?? "")));
        if (!year || totalCol < 0) continue;
        let sum = 0;
        for (let j = i + 1; j < tab.rows.length; j++) {
          const r = tab.rows[j] ?? [];
          if (!r.some((c) => String(c ?? "").trim())) continue; // blank spacer row
          if (r.some((c) => /^\D*\b20\d{2}\b/.test(String(c ?? "")) && num(String(c)) === undefined)) break; // next year's heading
          const label = r.find((c) => String(c ?? "").trim() && num(String(c)) === undefined) ?? "";
          if (isTotalLabel(String(label))) continue;
          const v = num(String(r[totalCol] ?? ""));
          if (v !== undefined) sum += Math.abs(v);
        }
        if (sum) out.chargebacks.set(year, sum);
        continue;
      }

      // Monthly block: a header row with month names; the year is in the row (or follows the previous block).
      if (monthCols.filter(Boolean).length < 3) continue;
      const blockYear = year || (lastYear ? lastYear + 1 : 0);
      if (!blockYear) {
        out.notes.push(`${tab.name}: couldn't tell which year row ${i + 1} is for, so it was skipped.`);
        continue;
      }
      if (!year) out.notes.push(`${tab.name}: the block at row ${i + 1} has no year, so it was read as ${blockYear}.`);
      lastYear = blockYear;
      for (let j = i + 1; j < tab.rows.length; j++) {
        const r = tab.rows[j] ?? [];
        if (r.map((c) => monthOf(String(c ?? ""))).filter(Boolean).length >= 3) break; // next block
        if (!r.some((c) => String(c ?? "").trim())) continue; // blank spacer row
        const label = String(r.find((c) => String(c ?? "").trim() && num(String(c)) === undefined) ?? "");
        if (isTotalLabel(label)) continue; // a total row would double count the agents above it
        monthCols.forEach((m, col) => {
          if (!m) return;
          const v = num(String(r[col] ?? ""));
          if (v !== undefined) put(`${blockYear}-${String(m).padStart(2, "0")}`, measure, v);
        });
      }
    }
  }

  // Nothing in report style: try the list style (Month column + measure columns).
  if (out.months.size === 0) {
    const sheet = readSheet({ name: "Import", tabs });
    for (const r of sheet.rows) {
      const month = r.period.slice(0, 7);
      if (month.length !== 7) continue;
      for (const f of MONTHLY_FIELDS) if (r.values[f] !== undefined) put(month, f, r.values[f]!);
      if (r.values.chargebacks) out.chargebacks.set(Number(month.slice(0, 4)), (out.chargebacks.get(Number(month.slice(0, 4))) ?? 0) + Math.abs(r.values.chargebacks));
    }
  }
  return out;
}
