"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { addLead, deleteLead, leadFromTypeform, sampleTypeformPayload, setLeadStatus } from "@/lib/leads";
import { getClient, randomSecret, updateDb } from "@/lib/store";
import { LEAD_STATUSES, type Lead, type LeadStatus } from "@/lib/types";

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
  return addLead(clientId, { ...leadFromTypeform(sampleTypeformPayload()), test: true });
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
