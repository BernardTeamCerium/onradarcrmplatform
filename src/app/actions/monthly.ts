"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { clearMetricsCache } from "@/lib/metrics";
import { withMonthly } from "@/lib/monthly";
import { importWorkbook } from "@/lib/monthlyImport";
import { parseCsv } from "@/lib/production";
import { updateDb } from "@/lib/store";
import { readXlsx } from "@/lib/xlsx";
import { MONTHLY_FIELDS, type MonthlyEntry, type MonthlyField } from "@/lib/types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** The team's monthly numbers (team members for their own company, admins for any client). Blank = not entered. */
export async function saveMonthlyNumbers(form: FormData) {
  const user = await requireUser();
  const clientId = str(form, "clientId");
  if (user.role !== "admin" && user.clientId !== clientId) throw new Error("Not allowed");
  const raw = str(form, "returnTo");
  const back = (raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard").replace(/[?&]msg=[^&#]*/, "").replace(/#.*$/, "");
  const go = (msg: string): never => redirect(`${back}${back.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}#monthly`);

  const month = str(form, "month");
  const [y, m] = month.split("-").map(Number);
  if (!/^\d{4}-\d{2}$/.test(month) || m < 1 || m > 12 || y < 2000 || y > 2100) go("Pick a month.");
  const values: MonthlyEntry["values"] = {};
  for (const f of MONTHLY_FIELDS) {
    const v = str(form, f).replace(/[$,\s]/g, "");
    if (v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) go("Numbers can't be negative or contain letters.");
    values[f] = f === "apptsSet" || f === "connected" ? Math.round(n) : n;
  }
  if (values.connected !== undefined && values.apptsSet !== undefined && values.connected > values.apptsSet) {
    go("Connected appointments can't be more than appointments.");
  }
  const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const cleared = Object.keys(values).length === 0;
  await withMonthly(clientId, (entries) => {
    const i = entries.findIndex((e) => e.month === month);
    if (cleared) {
      if (i >= 0) entries.splice(i, 1);
      return;
    }
    const entry: MonthlyEntry = { month, values, updatedAt: new Date().toISOString(), updatedBy: user.name };
    if (i >= 0) entries[i] = entry;
    else entries.push(entry);
  });
  clearMetricsCache(clientId);
  revalidatePath("/", "layout");
  go(cleared ? `${label} cleared.` : `${label} saved.`);
}

const FIELD_LABEL: Record<MonthlyField, string> = {
  apptsSet: "appointments",
  connected: "connected appointments",
  submitted: "submitted business",
  paid: "paid business",
  pending: "pending submits",
};
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** Upload a production report (.xlsx or .csv): fills in the monthly numbers it has and yearly chargebacks. */
export async function importMonthlyFile(form: FormData) {
  const user = await requireUser();
  const clientId = str(form, "clientId");
  if (user.role !== "admin" && user.clientId !== clientId) throw new Error("Not allowed");
  const raw = str(form, "returnTo");
  const back = (raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard").replace(/[?&]msg=[^&#]*/, "").replace(/#.*$/, "");
  const go = (msg: string): never => redirect(`${back}${back.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}#monthly`);

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) go("Choose a spreadsheet to import.");
  const f = file as File;
  if (f.size > 4 * 1024 * 1024) go("That file is over 4 MB.");
  let tabs: { name: string; rows: string[][] }[];
  try {
    const buf = Buffer.from(await f.arrayBuffer());
    tabs = /\.csv$/i.test(f.name) || f.type === "text/csv"
      ? [{ name: f.name.replace(/\.csv$/i, ""), rows: parseCsv(buf.toString("utf8").replace(/^\ufeff/, "")) }]
      : readXlsx(buf);
  } catch (err) {
    go((err as Error).message || "Couldn't read that file. Save it as .xlsx or .csv and try again.");
  }
  const result = importWorkbook(tabs!);
  if (result.months.size === 0 && result.chargebacks.size === 0) {
    go("No monthly numbers found. Use tabs named like Connected Appointments / Submitted Business / Paid Business with months across, or a Month column.");
  }
  const now = new Date().toISOString();
  await withMonthly(clientId, (entries) => {
    for (const [month, values] of result.months) {
      const rounded = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, k === "apptsSet" || k === "connected" ? Math.round(v) : Math.round(v * 100) / 100]),
      );
      const e = entries.find((x) => x.month === month);
      // Imported numbers replace those measures for the month; anything else already entered stays.
      if (e) Object.assign(e, { values: { ...e.values, ...rounded }, updatedAt: now, updatedBy: `${user.name} (import)` });
      else entries.push({ month, values: rounded, updatedAt: now, updatedBy: `${user.name} (import)` });
    }
  });
  if (result.chargebacks.size) {
    await updateDb((db) => {
      const c = db.clients.find((x) => x.id === clientId);
      if (!c) return;
      for (const [year, amount] of result.chargebacks) {
        const y = c.yearly.find((r) => r.year === year);
        if (y) y.chargebacks = Math.round(amount);
        else c.yearly.push({ year, submitted: 0, paid: 0, chargebacks: Math.round(amount), apptsSet: 0, connectedAppts: 0 });
      }
      c.yearly.sort((a, b) => a.year - b.year);
    });
  }
  clearMetricsCache(clientId);
  revalidatePath("/", "layout");

  const months = [...result.months.keys()].sort();
  const fields = MONTHLY_FIELDS.filter((x) => [...result.months.values()].some((v) => v[x] !== undefined));
  const missing = MONTHLY_FIELDS.filter((x) => !fields.includes(x));
  const parts = [
    months.length ? `Imported ${months.length} months (${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}): ${fields.map((x) => FIELD_LABEL[x]).join(", ")}.` : "",
    result.chargebacks.size ? `Chargebacks for ${[...result.chargebacks.keys()].sort().join(", ")}.` : "",
    missing.length && months.length ? `Not in the file: ${missing.map((x) => FIELD_LABEL[x]).join(", ")}.` : "",
    ...result.notes.slice(0, 3),
  ];
  go(parts.filter(Boolean).join(" "));
}
