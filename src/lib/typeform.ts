import "server-only";
import { addLeads, leadFromTypeform, type TypeformField, type TypeformResponseBody } from "./leads";
import type { Client } from "./types";

const BASE = (region: "us" | "eu") =>
  process.env.TYPEFORM_API_BASE || (region === "eu" ? "https://api.eu.typeform.com" : "https://api.typeform.com");

async function tf<T>(region: "us" | "eu", token: string, path: string): Promise<T> {
  const res = await fetch(`${BASE(region)}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 401 || res.status === 403) throw new Error("Typeform rejected the access token. Check it has the Responses: read and Forms: read scopes.");
  if (res.status === 404) throw new Error("Form not found. Check the form ID (the part after /to/ in the quiz link).");
  if (!res.ok) throw new Error(`Typeform returned ${res.status}`);
  return (await res.json()) as T;
}

/** Accepts a bare form ID or a full typeform link (…/to/AbC123 or admin …/form/AbC123/…). */
export function formIdFrom(input: string) {
  const s = input.trim();
  const m = s.match(/\/to\/([A-Za-z0-9]+)/) ?? s.match(/\/form\/([A-Za-z0-9]+)/);
  return m ? m[1] : s.replace(/[^A-Za-z0-9]/g, "");
}

/**
 * Imports every completed response for each form (newest first, 1,000 per page) through the same parser
 * as the webhook. Responses already on the Leads tab (same response token) are skipped.
 */
export async function importTypeform(client: Client, opts: { token: string; formIds: string[]; region: "us" | "eu" }) {
  let added = 0;
  let skipped = 0;
  let read = 0;
  for (const formId of opts.formIds) {
    const form = await tf<{ title?: string; fields?: TypeformField[] }>(
      opts.region,
      opts.token,
      `/forms/${encodeURIComponent(formId)}`,
    );
    let before: string | undefined;
    for (let page = 0; page < 50; page++) {
      const q = new URLSearchParams({ page_size: "1000", completed: "true" });
      if (before) q.set("before", before);
      const data = await tf<{ items?: (TypeformResponseBody & { token: string })[] }>(opts.region, opts.token, `/forms/${encodeURIComponent(formId)}/responses?${q}`);
      const items = data.items ?? [];
      if (items.length === 0) break;
      read += items.length;
      const leads = items
        .filter((it) => it.answers && it.answers.length > 0)
        .map((it) => leadFromTypeform({ form_response: { ...it, form_id: formId, definition: { title: form.title, fields: form.fields } } }, client));
      const r = await addLeads(client.id, leads);
      added += r.added;
      skipped += r.skipped + (items.length - leads.length);
      before = items[items.length - 1].token;
      if (items.length < 1000) break;
    }
  }
  return { read, added, skipped };
}
