import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { newId, readJson, writeJson } from "./store";
import { matchSource, OTHER } from "./sources";
import { LEAD_STATUSES, type Client, type Lead, type LeadStatus, type QuizAnswer } from "./types";

const MAX_LEADS = 20000;
const leadsKey = (clientId: string) => `leads/${clientId}.json`;

// Serialise read-modify-write per client so simultaneous webhooks don't drop leads.
const queues = new Map<string, Promise<unknown>>();
function withLeads<T>(clientId: string, fn: (leads: Lead[]) => T | Promise<T>): Promise<T> {
  const prev = queues.get(clientId) ?? Promise.resolve();
  const run = prev.then(async () => {
    const leads = await loadLeads(clientId);
    const result = await fn(leads);
    await writeJson(leadsKey(clientId), leads.slice(0, MAX_LEADS));
    return result;
  });
  queues.set(clientId, run.catch(() => undefined));
  return run;
}

async function loadLeads(clientId: string): Promise<Lead[]> {
  const stored = await readJson<Lead[]>(leadsKey(clientId));
  if (stored) return stored;
  const seeded = clientId === "cl_sibley" ? sampleLeads() : [];
  await writeJson(leadsKey(clientId), seeded);
  return seeded;
}

/** Newest first. */
export async function listLeads(clientId: string) {
  return (await loadLeads(clientId)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export async function addLead(clientId: string, lead: Omit<Lead, "id" | "status" | "statusUpdatedAt">) {
  return withLeads(clientId, (leads) => {
    if (lead.externalId) {
      const dupe = leads.find((l) => l.externalId === lead.externalId);
      if (dupe) return dupe;
    }
    const now = new Date().toISOString();
    const created: Lead = { id: newId("lead"), status: "New", statusUpdatedAt: now, ...lead };
    leads.unshift(created);
    return created;
  });
}

/** Adds many leads in one write (used for imports); repeats of an existing externalId are skipped. */
export async function addLeads(clientId: string, incoming: Omit<Lead, "id" | "status" | "statusUpdatedAt">[]) {
  return withLeads(clientId, (leads) => {
    const seen = new Set(leads.map((l) => l.externalId).filter(Boolean));
    let added = 0;
    const now = new Date().toISOString();
    for (const lead of incoming) {
      if (lead.externalId && seen.has(lead.externalId)) continue;
      if (lead.externalId) seen.add(lead.externalId);
      leads.push({ id: newId("lead"), status: "New", statusUpdatedAt: now, ...lead });
      added++;
    }
    leads.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return { added, skipped: incoming.length - added };
  });
}

export async function setLeadStatus(clientId: string, leadId: string, status: LeadStatus) {
  if (!LEAD_STATUSES.includes(status)) throw new Error("Unknown status");
  return withLeads(clientId, (leads) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return null;
    lead.status = status;
    lead.statusUpdatedAt = new Date().toISOString();
    return lead;
  });
}

export async function deleteLead(clientId: string, leadId: string) {
  return withLeads(clientId, (leads) => {
    const i = leads.findIndex((l) => l.id === leadId);
    if (i >= 0) leads.splice(i, 1);
  });
}

// ---------------------------------------------------------------------------
// Typeform

/** Verifies the `Typeform-Signature` header (sha256=<base64 HMAC of the raw body>). */
export function verifyTypeformSignature(rawBody: string, header: string | null, secret: string) {
  if (!header || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("base64")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface TypeformField {
  id: string;
  title?: string;
  type?: string;
  ref?: string;
  /** Question groups, matrices and contact/address blocks nest their questions here. */
  properties?: { fields?: TypeformField[] };
}

interface TypeformAnswer {
  type: string;
  field: TypeformField;
  text?: string;
  email?: string;
  phone_number?: string;
  number?: number;
  boolean?: boolean;
  date?: string;
  url?: string;
  file_url?: string;
  choice?: { label?: string; other?: string };
  choices?: { labels?: string[]; other?: string };
  payment?: { amount?: string; name?: string; success?: boolean };
  multi_format?: { text?: string; audio_url?: string; video_url?: string };
}

export interface TypeformResponseBody {
  form_id?: string;
  token?: string;
  response_id?: string;
  landed_at?: string;
  submitted_at?: string;
  definition?: { title?: string; fields?: TypeformField[] };
  answers?: TypeformAnswer[];
  hidden?: Record<string, string>;
  calculated?: { score?: number };
  variables?: { key: string; type?: string; number?: number; text?: string }[];
  ending?: { id?: string; ref?: string };
}

export interface TypeformPayload {
  event_id?: string;
  event_type?: string;
  form_response?: TypeformResponseBody;
}

function answerText(a: TypeformAnswer): string {
  switch (a.type) {
    case "choice":
      return a.choice?.label ?? a.choice?.other ?? "";
    case "choices":
      return [...(a.choices?.labels ?? []), ...(a.choices?.other ? [a.choices.other] : [])].join(", ");
    case "boolean":
      return a.boolean ? "Yes" : "No";
    case "number":
      return a.number === undefined ? "" : String(a.number);
    case "payment":
      return a.payment ? `${a.payment.amount ?? ""}${a.payment.success === false ? " (failed)" : ""}`.trim() : "";
    case "multi_format":
      return a.multi_format?.text ?? a.multi_format?.video_url ?? a.multi_format?.audio_url ?? "";
    default:
      return String(a.text ?? a.email ?? a.phone_number ?? a.date ?? a.url ?? a.file_url ?? "");
  }
}

/** Every question in the form, including ones nested inside groups, matrices and contact/address blocks. */
function flattenFields(fields: TypeformField[] = [], out = new Map<string, TypeformField>()) {
  for (const f of fields) {
    out.set(f.id, f);
    if (f.properties?.fields) flattenFields(f.properties.fields, out);
  }
  return out;
}

const HIDDEN_LABELS: Record<string, string> = {
  utm_source: "UTM source",
  utm_medium: "UTM medium",
  utm_campaign: "UTM campaign",
  utm_content: "UTM content",
  utm_term: "UTM term",
  fbclid: "Facebook click ID",
  gclid: "Google click ID",
};

/**
 * Turns a Typeform submission (webhook or Responses API) into a lead: contact details, every question and
 * answer (including grouped ones), hidden fields such as UTM tags, score and variables, and the marketing
 * source when a hidden field names one.
 */
export function leadFromTypeform(payload: TypeformPayload, client?: Client): Omit<Lead, "id" | "status" | "statusUpdatedAt"> {
  const fr = payload.form_response;
  if (!fr?.answers) throw new Error("Not a Typeform form response");
  const fields = flattenFields(fr.definition?.fields);
  const hidden = fr.hidden ?? {};
  const byRef = new Map<string, string>();
  for (const a of fr.answers) if (a.field.ref) byRef.set(a.field.ref, answerText(a).trim());
  const vars = new Map((fr.variables ?? []).map((v) => [v.key, v.number !== undefined ? String(v.number) : v.text ?? ""]));
  // Fill "recall" placeholders like {{field:ref}}, {{hidden:name}} and {{var:score}} in question titles.
  const recall = (t: string) =>
    t
      .replace(/\{\{field:([^}]+)\}\}/g, (_, r) => byRef.get(r) ?? "")
      .replace(/\{\{hidden:([^}]+)\}\}/g, (_, k) => hidden[k] ?? "")
      .replace(/\{\{var:([^}]+)\}\}/g, (_, k) => vars.get(k) ?? "")
      .replace(/\*/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s+([,?.!])/g, "$1")
      .trim();

  const answers: QuizAnswer[] = [];
  let email: string | undefined;
  let phone: string | undefined;
  let first = "";
  let last = "";
  let full = "";
  let city: string | undefined;
  let state: string | undefined;

  for (const a of fr.answers) {
    const def = fields.get(a.field.id);
    const question = recall(def?.title ?? a.field.title ?? a.field.ref ?? "Question") || "Question";
    const answer = answerText(a).trim();
    answers.push({ question, answer });
    const q = question.toLowerCase();
    if (a.type === "email" && !email) email = a.email;
    else if (a.type === "phone_number" && !phone) phone = a.phone_number;
    else if (a.type === "text" && /name/.test(q) && !/company|business|spouse|agent/.test(q)) {
      if (/first/.test(q)) first = answer;
      else if (/last|sur/.test(q)) last = answer;
      else if (!full) full = answer;
    } else if (a.type === "text" && /\bcity\b|\btown\b/.test(q) && !city) city = answer;
    else if ((a.type === "text" || a.type === "choice") && /\bstate\b|region|province/.test(q) && !state) state = answer;
  }

  // Hidden fields (UTM tags, ad IDs, anything passed in the link) and quiz scoring are kept with the answers.
  for (const [k, v] of Object.entries(hidden)) {
    if (v) answers.push({ question: HIDDEN_LABELS[k.toLowerCase()] ?? `Hidden: ${k.replace(/_/g, " ")}`, answer: String(v) });
  }
  if (fr.calculated?.score !== undefined) answers.push({ question: "Quiz score", answer: String(fr.calculated.score) });
  for (const v of fr.variables ?? []) {
    if (v.key !== "score") answers.push({ question: `Variable: ${v.key}`, answer: v.number !== undefined ? String(v.number) : v.text ?? "" });
  }
  if (fr.landed_at && fr.submitted_at) {
    const secs = Math.round((Date.parse(fr.submitted_at) - Date.parse(fr.landed_at)) / 1000);
    if (secs > 0 && secs < 86_400) answers.push({ question: "Time to complete", answer: secs < 90 ? `${secs} sec` : `${Math.round(secs / 60)} min` });
  }

  // Marketing source: a hidden source / utm_source wins (e.g. ?utm_source=facebook on the quiz link).
  const hiddenSource = hidden.source ?? hidden.utm_source ?? hidden.lead_source ?? "";
  const matched = client && hiddenSource ? matchSource(client, hiddenSource) : OTHER;
  const name = full || [first, last].filter(Boolean).join(" ") || hidden.name || email || phone || "Unknown lead";
  return {
    name,
    email: email ?? hidden.email,
    phone: phone ?? hidden.phone,
    city: city || hidden.city || undefined,
    state: (state || hidden.state || undefined)?.trim(),
    source: matched !== OTHER ? matched : fr.definition?.title ?? "Typeform",
    receivedAt: fr.submitted_at ? new Date(fr.submitted_at).toISOString() : new Date().toISOString(),
    answers,
    channel: "typeform",
    externalId: fr.token ?? fr.response_id,
  };
}

/** Seeded sample leads and "send test lead" leads. Their emails use example.com, which is reserved and never real. */
export function isSampleLead(l: Lead) {
  return !!l.sample || !!l.test || /@example\.com$/i.test(l.email ?? "");
}

/** Removes sample and test leads; returns the removed lead ids. */
export async function removeSampleLeads(clientId: string) {
  return withLeads(clientId, (leads) => {
    const removed: string[] = [];
    for (let i = leads.length - 1; i >= 0; i--) {
      if (isSampleLead(leads[i])) removed.push(...leads.splice(i, 1).map((l) => l.id));
    }
    return removed;
  });
}

// ---------------------------------------------------------------------------
// Sample data (fictional people) for demos

const QUIZ_TITLE = "Retirement Readiness Quiz";
const QUESTIONS = [
  { id: "q_name", title: "What's your full name?", type: "short_text" },
  { id: "q_age", title: "How old are you?", type: "multiple_choice" },
  { id: "q_retire", title: "When are you planning to retire?", type: "multiple_choice" },
  { id: "q_saved", title: "Roughly how much have you saved for retirement?", type: "multiple_choice" },
  { id: "q_concern", title: "What's your biggest retirement concern?", type: "multiple_choice" },
  { id: "q_advisor", title: "Do you currently work with a financial advisor?", type: "yes_no" },
  { id: "q_contact", title: "What's the best time to reach you?", type: "multiple_choice" },
  { id: "q_email", title: "What's your email address?", type: "email" },
  { id: "q_phone", title: "What's the best phone number to reach you?", type: "phone_number" },
];

const FIRST = ["James", "Linda", "Robert", "Patricia", "Michael", "Barbara", "David", "Susan", "William", "Karen", "Richard", "Nancy", "Thomas", "Carol", "Charles", "Sandra", "Daniel", "Donna", "Mark", "Deborah"];
const LAST = ["Walker", "Bennett", "Hayes", "Foster", "Reed", "Coleman", "Price", "Brooks", "Sanders", "Perry", "Powell", "Long", "Hughes", "Butler", "Barnes", "Fisher", "Henderson", "Graham", "Wallace", "Ellis"];
const AGES = ["50–54", "55–59", "60–64", "65–69", "70+"];
const RETIRE = ["Already retired", "Within 1 year", "1–3 years", "3–5 years", "5+ years"];
const SAVED = ["$100k–$250k", "$250k–$500k", "$500k–$1M", "$1M–$2M", "$2M+"];
const CONCERNS = ["Running out of money", "Market volatility", "Taxes in retirement", "Healthcare and long-term care costs", "Leaving a legacy for my family"];
const TIMES = ["Morning", "Afternoon", "Evening"];

function pick<T>(arr: readonly T[], rand: () => number) {
  return arr[Math.floor(rand() * arr.length)];
}

/** A realistic Typeform webhook payload for the sample quiz (used for seed data and "send test lead"). */
export function sampleTypeformPayload(rand: () => number = Math.random, submittedAt = new Date()): TypeformPayload {
  const first = pick(FIRST, rand);
  const last = pick(LAST, rand);
  // 555-01xx numbers are reserved for fiction, so sample leads never point at a real person.
  const phone = `+1985555${String(100 + Math.floor(rand() * 100)).padStart(4, "0")}`;
  const answers: TypeformAnswer[] = [
    { type: "text", field: { id: "q_name", type: "short_text" }, text: `${first} ${last}` },
    { type: "choice", field: { id: "q_age", type: "multiple_choice" }, choice: { label: pick(AGES, rand) } },
    { type: "choice", field: { id: "q_retire", type: "multiple_choice" }, choice: { label: pick(RETIRE, rand) } },
    { type: "choice", field: { id: "q_saved", type: "multiple_choice" }, choice: { label: pick(SAVED, rand) } },
    { type: "choice", field: { id: "q_concern", type: "multiple_choice" }, choice: { label: pick(CONCERNS, rand) } },
    { type: "boolean", field: { id: "q_advisor", type: "yes_no" }, boolean: rand() < 0.35 },
    { type: "choice", field: { id: "q_contact", type: "multiple_choice" }, choice: { label: pick(TIMES, rand) } },
    { type: "email", field: { id: "q_email", type: "email" }, email: `${first}.${last}@example.com`.toLowerCase() },
    { type: "phone_number", field: { id: "q_phone", type: "phone_number" }, phone_number: phone },
  ];
  return {
    event_id: crypto.randomUUID(),
    event_type: "form_response",
    form_response: {
      form_id: "sample",
      token: crypto.randomUUID(),
      submitted_at: submittedAt.toISOString(),
      definition: { title: QUIZ_TITLE, fields: QUESTIONS },
      answers,
    },
  };
}

function sampleLeads(): Lead[] {
  let seed = 20260924;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const statuses: LeadStatus[] = ["New", "New", "Contacted", "Contacted", "Appointment set", "Appointment held", "No show", "Application submitted", "Application submitted", "Sold", "Not interested", "Contacted", "Appointment set", "New"];
  const now = Date.now();
  return statuses.map((status, i) => {
    const at = new Date(now - (i * 7 + rand() * 6 + 0.3) * 3_600_000);
    const lead = leadFromTypeform(sampleTypeformPayload(rand, at));
    return { ...lead, id: newId("lead"), status, statusUpdatedAt: at.toISOString(), externalId: undefined, sample: true };
  });
}
