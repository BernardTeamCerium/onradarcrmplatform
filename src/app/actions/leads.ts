"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { leadFromEmail } from "@/lib/inbound";
import { formIdFrom, importTypeform } from "@/lib/typeform";
import { addLead, deleteLead, deleteLeads, leadFromTypeform, sampleTypeformPayload, setLeadStatus, type LeadScope } from "@/lib/leads";
import { withBooked } from "@/lib/appointments";
import { getClient, newId, randomSecret, updateDb } from "@/lib/store";
import { LEAD_STATUSES, type ApptStatus, type BookedAppt, type Lead, type LeadStatus } from "@/lib/types";

async function assertAccess(clientId: string) {
  const user = await requireUser();
  if (user.role !== "admin" && user.clientId !== clientId) throw new Error("Not allowed");
  return user;
}

export async function updateLeadStatus(clientId: string, leadId: string, status: string): Promise<Lead | null> {
  await assertAccess(clientId);
  if (!LEAD_STATUSES.includes(status as LeadStatus)) throw new Error("Unknown status");
  return setLeadStatus(clientId, leadId, status as LeadStatus);
}

/** Simulates a quiz submission, running it through the same parser as a real Typeform webhook. */
export async function sendTestLead(clientId: string): Promise<Lead> {
  await requireAdmin();
  if (!(await getClient(clientId))) throw new Error("Unknown client");
  return addLead(clientId, { ...leadFromTypeform(sampleTypeformPayload(), (await getClient(clientId))!), test: true });
}

export async function removeLead(clientId: string, leadId: string) {
  await requireAdmin();
  await deleteLead(clientId, leadId);
}

export async function regenerateTypeformSecret(form: FormData) {
  await requireAdmin();
  const id = String(form.get("clientId") ?? "");
  await updateDb((db) => {
    const c = db.clients.find((x) => x.id === id);
    if (c) c.typeformSecret = randomSecret();
  });
  revalidatePath(`/admin/clients/${id}/settings`);
  redirect(`/admin/clients/${id}/settings?msg=${encodeURIComponent("New webhook secret created. Update it in Typeform.")}`);
}

/** Admin pastes a lead email (subject + body) and it's added to the Leads tab. */
export async function importEmailLead(form: FormData) {
  await requireAdmin();
  const id = String(form.get("clientId") ?? "");
  const client = await getClient(id);
  const back = (m: string) => `/admin/clients/${id}/settings?msg=${encodeURIComponent(m)}#email-leads`;
  if (!client) redirect(back("Unknown client."));
  const lead = leadFromEmail(client, {
    subject: String(form.get("subject") ?? ""),
    from: String(form.get("from") ?? ""),
    text: String(form.get("body") ?? ""),
  });
  if (!lead.email && !lead.phone) redirect(back("Couldn't find an email address or phone number in that email."));
  const saved = await addLead(id, { ...lead, channel: "manual" });
  redirect(back(`Added ${saved.name} to Leads (${saved.source}).`));
}

export async function regenerateInboundKey(form: FormData) {
  await requireAdmin();
  const id = String(form.get("clientId") ?? "");
  await updateDb((db) => {
    const c = db.clients.find((x) => x.id === id);
    if (c) c.inboundKey = randomSecret();
  });
  revalidatePath(`/admin/clients/${id}/settings`);
  redirect(`/admin/clients/${id}/settings?msg=${encodeURIComponent("New key created. Update the Gmail script and any tools that send leads.")}#email-leads`);
}

const APPT_TYPES = ["New money", "Policy review", "Annuity review", "401(k) rollover", "Retirement income plan", "Beneficiary & estate review"] as const;

/** Books an appointment for a lead from the Leads tab; it shows on the agent's Calendar. */
export async function bookAppointment(
  clientId: string,
  leadId: string,
  input: { date: string; time: string; agentId: string; minutes: number; apptType?: string; notes?: string },
): Promise<BookedAppt> {
  const user = await assertAccess(clientId);
  const client = await getClient(clientId);
  if (!client) throw new Error("Unknown client");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) throw new Error("Pick a date and time");
  if (!client.agents.some((a) => a.id === input.agentId)) throw new Error("Pick an agent");
  const appt: BookedAppt = {
    id: newId("ap"),
    leadId,
    agentId: input.agentId,
    date: input.date,
    time: input.time,
    minutes: Math.min(240, Math.max(15, Math.round(input.minutes) || 60)),
    apptType: APPT_TYPES.find((t) => t === input.apptType),
    status: "Scheduled",
    notes: input.notes?.slice(0, 500) || undefined,
    createdAt: new Date().toISOString(),
    createdBy: user.name,
  };
  await withBooked(clientId, (list) => void list.push(appt));
  await setLeadStatus(clientId, leadId, "Appointment set");
  revalidatePath("/", "layout");
  return appt;
}

/** Marks a booked appointment as showed / no-show / cancelled and moves the lead to match. */
export async function setBookedStatus(form: FormData) {
  const clientId = String(form.get("clientId") ?? "");
  await assertAccess(clientId);
  const id = String(form.get("id") ?? "").replace(/^bk~/, "");
  const status = String(form.get("status") ?? "") as ApptStatus;
  if (!["Scheduled", "Confirmed", "Showed", "No-show", "Cancelled"].includes(status)) throw new Error("Unknown status");
  const appt = await withBooked(clientId, (list) => {
    const a = list.find((x) => x.id === id);
    if (a) a.status = status;
    return a;
  });
  if (appt) {
    const leadStatus = status === "Showed" ? "Appointment held" : status === "No-show" ? "No show" : status === "Cancelled" ? "Contacted" : "Appointment set";
    await setLeadStatus(clientId, appt.leadId, leadStatus);
  }
  revalidatePath("/", "layout");
  const back = String(form.get("returnTo") ?? "");
  if (back.startsWith("/") && !back.startsWith("//")) redirect(back);
}

/** Saves Typeform API access and imports every past response into the Leads tab. */
export async function importTypeformResponses(form: FormData) {
  await requireAdmin();
  const id = String(form.get("clientId") ?? "");
  const client = await getClient(id);
  const back = (m: string) => `/admin/clients/${id}/settings?msg=${encodeURIComponent(m)}#typeform`;
  if (!client) redirect(back("Unknown client."));
  const tokenInput = String(form.get("token") ?? "").trim();
  const token = tokenInput || client.typeformApi?.token || "";
  const formIds = String(form.get("formIds") ?? "")
    .split(/[\s,]+/)
    .map(formIdFrom)
    .filter(Boolean);
  const region = form.get("region") === "eu" ? "eu" : "us";
  if (!token || formIds.length === 0) redirect(back("Enter a Typeform access token and at least one form ID."));
  let msg: string;
  try {
    const r = await importTypeform(client, { token, formIds, region });
    msg = `Typeform import: ${r.read} responses read, ${r.added} new leads added, ${r.skipped} already here or empty.`;
  } catch (err) {
    msg = `Typeform import failed: ${(err as Error).message}`;
  }
  await updateDb((db) => {
    const c = db.clients.find((x) => x.id === id);
    if (c) c.typeformApi = { token, formIds, region, lastImportAt: new Date().toISOString(), lastResult: msg };
  });
  revalidatePath("/", "layout");
  redirect(back(msg));
}

const SCOPES: LeadScope[] = ["all", "email", "typeform", "api", "sample"];

/** Bulk delete from the admin Leads page (also removes bookings made for those leads). */
export async function bulkDeleteLeads(form: FormData) {
  await requireAdmin();
  const id = String(form.get("clientId") ?? "");
  const back = (msg: string) => `/admin/clients/${id}/leads?msg=${encodeURIComponent(msg)}`;
  const scope = String(form.get("scope") ?? "") as LeadScope;
  const before = String(form.get("before") ?? "").trim() || undefined;
  if (!SCOPES.includes(scope)) redirect(back("Choose which leads to delete."));
  if (before && !/^\d{4}-\d{2}-\d{2}$/.test(before)) redirect(back("Pick a valid date."));
  if (String(form.get("confirm") ?? "").trim().toUpperCase() !== "DELETE") redirect(back("Type DELETE to confirm."));
  const removed = new Set(await deleteLeads(id, scope, before));
  const bookings = await withBooked(id, (list) => {
    const n = list.length;
    for (let i = list.length - 1; i >= 0; i--) if (removed.has(list[i].leadId)) list.splice(i, 1);
    return n - list.length;
  });
  revalidatePath("/", "layout");
  redirect(back(`Deleted ${removed.size} lead${removed.size === 1 ? "" : "s"}${bookings ? ` and ${bookings} booking${bookings === 1 ? "" : "s"}` : ""}.`));
}
