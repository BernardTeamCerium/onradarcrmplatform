"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { applyCaseEmail, looksLikeCase, parseCaseEmail } from "@/lib/caseEmail";
import { clearMetricsCache } from "@/lib/metrics";
import { entriesFromCsv, matchAgent, mergeImport, normaliseStatus, parseDate, parsePeriod, withProduction } from "@/lib/production";
import { stagesFor } from "@/lib/stages";
import { getClient, newId } from "@/lib/store";
import type { CaseStatus, ProductionEntry } from "@/lib/types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const money = (v: string) => {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return v === "" || !Number.isFinite(n) ? undefined : n;
};

/** Client team members can log production for their own company; admins for any client. */
async function access(clientId: string) {
  const user = await requireUser();
  if (user.role !== "admin" && user.clientId !== clientId) throw new Error("Not allowed");
  const client = await getClient(clientId);
  if (!client) throw new Error("Unknown client");
  return { user, client };
}

function done(clientId: string, back: string, msg: string): never {
  clearMetricsCache(clientId);
  revalidatePath("/", "layout");
  const sep = back.includes("?") ? "&" : "?";
  redirect(`${back}${sep}msg=${encodeURIComponent(msg)}`);
}

const safeBack = (f: FormData) => {
  const b = str(f, "returnTo");
  return b.startsWith("/") && !b.startsWith("//") ? b.replace(/[?&]msg=[^&]*/, "") : "/dashboard/production";
};

export async function addCase(form: FormData) {
  const clientId = str(form, "clientId");
  const { user, client } = await access(clientId);
  const back = safeBack(form);
  const date = parseDate(str(form, "date"));
  const premium = money(str(form, "premium"));
  const agentName = str(form, "agent");
  if (!date || premium === undefined || premium <= 0 || !agentName) done(clientId, back, "Enter a date, an agent and a premium amount.");
  const agent = matchAgent(client.agents, agentName);
  const status = normaliseStatus(str(form, "status")) as CaseStatus;
  const entry: ProductionEntry = {
    id: newId("pr"),
    kind: "case",
    date,
    agentName: agent?.name ?? agentName,
    agentId: agent?.id,
    clientName: str(form, "clientName") || undefined,
    carrier: str(form, "carrier") || undefined,
    product: str(form, "product") || undefined,
    premium,
    status,
    paidDate: status === "Paid" || status === "Chargeback" ? parseDate(str(form, "paidDate")) ?? date : undefined,
    source: str(form, "source") || undefined,
    notes: str(form, "notes") || undefined,
    stage: status === "Submitted" ? (stagesFor(client).includes(str(form, "stage")) ? str(form, "stage") : stagesFor(client)[0]) : undefined,
    stageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    createdBy: user.name,
  };
  await withProduction(client, (entries) => void entries.push(entry));
  done(clientId, back, `Logged ${entry.clientName ?? "case"} for ${entry.agentName}.`);
}

/** Moves a case along: Submitted → Paid → Chargeback (or Declined), stamping today's date. */
export async function setCaseStatus(clientId: string, id: string, status: CaseStatus) {
  const { user, client } = await access(clientId);
  const today = new Date().toISOString().slice(0, 10);
  await withProduction(client, (entries) => {
    const e = entries.find((x) => x.id === id && x.kind === "case");
    if (!e) return;
    e.status = status;
    if ((status === "Paid" || status === "Chargeback") && !e.paidDate) e.paidDate = today;
    if (status === "Chargeback" && !e.chargebackDate) e.chargebackDate = today;
    if (status === "Submitted" || status === "Declined") {
      e.paidDate = undefined;
      e.chargebackDate = undefined;
    }
    e.updatedAt = new Date().toISOString();
    e.createdBy ??= user.name;
  });
  clearMetricsCache(clientId);
  revalidatePath("/", "layout");
}

export async function deleteEntry(clientId: string, id: string) {
  const { client } = await access(clientId);
  await withProduction(client, (entries) => {
    const i = entries.findIndex((x) => x.id === id);
    if (i >= 0) entries.splice(i, 1);
  });
  clearMetricsCache(clientId);
  revalidatePath("/", "layout");
}

export async function addTotal(form: FormData) {
  const clientId = str(form, "clientId");
  const { user, client } = await access(clientId);
  const back = safeBack(form);
  const month = str(form, "month");
  const year = str(form, "year");
  const period = parsePeriod(str(form, "scope") === "year" ? year : month);
  const agentName = str(form, "agent");
  const submitted = money(str(form, "submitted"));
  const paid = money(str(form, "paid"));
  const chargebacks = money(str(form, "chargebacks"));
  if (!period || !agentName || (submitted === undefined && paid === undefined && chargebacks === undefined)) {
    done(clientId, back, "Choose a period and agent, and enter at least one amount.");
  }
  const agent = matchAgent(client.agents, agentName);
  const entry: ProductionEntry = {
    id: newId("pr"), kind: "summary", period, agentName: agent?.name ?? agentName, agentId: agent?.id,
    submitted, paid, chargebacks, cases: money(str(form, "cases")), createdAt: new Date().toISOString(), createdBy: user.name,
  };
  const { replaced } = await withProduction(client, (entries) => mergeImport(entries, [entry]));
  done(clientId, back, `${replaced ? "Updated" : "Saved"} ${entry.agentName}'s totals for ${period}.`);
}

export async function importProduction(form: FormData) {
  const clientId = str(form, "clientId");
  const { user, client } = await access(clientId);
  const back = safeBack(form);
  const file = form.get("file");
  let text = str(form, "csv");
  if (file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) done(clientId, back, "That file is over 5 MB. Split it into smaller files.");
    text = await file.text();
  }
  if (!text) done(clientId, back, "Choose a CSV file or paste CSV text.");
  const parsed = entriesFromCsv(client, text, user.name);
  if (form.get("clearSamples") === "on") {
    await withProduction(client, (entries) => {
      for (let i = entries.length - 1; i >= 0; i--) if (entries[i].sample) entries.splice(i, 1);
    });
  }
  const { added, replaced } = await withProduction(client, (entries) => mergeImport(entries, parsed.entries));
  const skippedNote = parsed.skipped.length
    ? ` Skipped ${parsed.skipped.length} row${parsed.skipped.length === 1 ? "" : "s"}: ${parsed.skipped.slice(0, 3).map((s) => `row ${s.row} (${s.reason})`).join(", ")}${parsed.skipped.length > 3 ? "…" : ""}.`
    : "";
  done(clientId, back, `Imported ${parsed.kind}: ${added} added${replaced ? `, ${replaced} updated` : ""}.${skippedNote}`);
}

export async function clearSampleProduction(form: FormData) {
  const clientId = str(form, "clientId");
  const { client } = await access(clientId);
  const back = safeBack(form);
  const removed = await withProduction(client, (entries) => {
    let n = 0;
    for (let i = entries.length - 1; i >= 0; i--)
      if (entries[i].sample) {
        entries.splice(i, 1);
        n++;
      }
    return n;
  });
  done(clientId, back, `Removed ${removed} sample entries.`);
}

/** A pasted case status email (copied from Gmail or Outlook, headers and all). */
export async function importCaseEmail(form: FormData) {
  const clientId = str(form, "clientId");
  const { user, client } = await access(clientId);
  const back = safeBack(form);
  const body = str(form, "body");
  if (!body) done(clientId, back, "Paste the email first.");
  const parsed = parseCaseEmail({ subject: str(form, "subject") || undefined, text: body });
  if (!looksLikeCase(parsed)) done(clientId, back, "Couldn't find a case number or premium in that email.");
  const { action, entry } = await applyCaseEmail(client, parsed, user.name);
  const what = `${entry.clientName ?? "case"}${entry.caseNumber ? ` (${entry.caseNumber})` : ""}`;
  done(
    clientId,
    back,
    action === "duplicate"
      ? `That email was already imported for ${what}.`
      : `${action === "created" ? "Added" : "Updated"} ${what} for ${entry.agentName}: ${entry.carrierStatus ?? entry.status}.`,
  );
}

/** Moves a pending case to another stage on the pipeline board (also records who moved it). */
export async function setCaseStage(clientId: string, id: string, stage: string) {
  const { user, client } = await access(clientId);
  if (!stagesFor(client).includes(stage)) throw new Error("Unknown stage");
  await withProduction(client, (entries) => {
    const e = entries.find((x) => x.id === id && x.kind === "case");
    if (!e || e.stage === stage) return;
    const at = new Date().toISOString();
    e.stage = stage;
    e.stageAt = at;
    e.updatedAt = at;
    e.updates = [...(e.updates ?? []), { at, status: `Moved to ${stage}`, from: user.name, ref: `stage-${at}` }];
  });
  revalidatePath("/", "layout");
}
