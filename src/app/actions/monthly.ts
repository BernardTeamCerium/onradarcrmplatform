"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { clearMetricsCache } from "@/lib/metrics";
import { withMonthly } from "@/lib/monthly";
import { MONTHLY_FIELDS, type MonthlyEntry } from "@/lib/types";

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
