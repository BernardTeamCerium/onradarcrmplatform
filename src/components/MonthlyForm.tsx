"use client";

import { useState } from "react";
import { saveMonthlyNumbers } from "@/app/actions/monthly";

type Values = Partial<Record<"apptsSet" | "connected" | "submitted" | "paid" | "pending", number>>;

const FIELDS: { key: keyof Values; label: string; money?: boolean; hint: string }[] = [
  { key: "apptsSet", label: "Appointments", hint: "Appointments set this month" },
  { key: "connected", label: "Connected appointments", hint: "Appointments that actually happened" },
  { key: "submitted", label: "Submitted business ($)", money: true, hint: "Premium submitted this month" },
  { key: "paid", label: "Paid business ($)", money: true, hint: "Premium paid this month" },
  { key: "pending", label: "Pending submits ($)", money: true, hint: "Business still waiting to be submitted at month end" },
];

const show = (v: number | undefined, money?: boolean) => (v === undefined ? "" : money ? v.toLocaleString("en-US") : String(v));

/** Pick a month, type the five numbers, save. Choosing a month fills in what was already entered. */
export function MonthlyForm({ clientId, returnTo, months, entries }: { clientId: string; returnTo: string; months: { value: string; label: string }[]; entries: Record<string, Values> }) {
  const [month, setMonth] = useState(months[0]?.value ?? "");
  const current = entries[month] ?? {};
  return (
    <form action={saveMonthlyNumbers} className="stack" style={{ gap: 12 }} key={month}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="form-grid">
        <label className="field">
          Month
          <select name="month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>{m.label}{entries[m.value] ? " ✓" : ""}</option>
            ))}
          </select>
          <span className="hint">✓ = already entered (saving again replaces it)</span>
        </label>
        {FIELDS.map((f) => (
          <label className="field" key={f.key}>
            {f.label}
            <input name={f.key} inputMode="decimal" defaultValue={show(current[f.key], f.money)} placeholder={f.money ? "250,000" : "0"} />
            <span className="hint">{f.hint}</span>
          </label>
        ))}
      </div>
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button className="btn primary" type="submit">Save {months.find((m) => m.value === month)?.label ?? "month"}</button>
        <span className="muted small">Leave a box blank if you don&apos;t have that number yet. Clear every box and save to remove the month.</span>
      </div>
    </form>
  );
}
