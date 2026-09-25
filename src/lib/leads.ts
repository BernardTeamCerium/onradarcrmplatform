import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { newId, readJson, writeJson } from "./store";
import { LEAD_STATUSES, type Lead, type LeadStatus, type QuizAnswer } from "./types";

const MAX_LEADS = 2000;
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

interface TypeformField {
  id: string;
  title?: string;
  type?: string;
  ref?: string;
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
  payment?: { amount?: string; name?: string };
}

export interface TypeformPayload {
  event_id?: string;
  event_type?: string;
  form_response?: {
    form_id?: string;
    token?: string;
    submitted_at?: string;
    definition?: { title?: string; fields?: TypeformField[] };
    answers?: TypeformAnswer[];
    hidden?: Record<string, string>;
  };
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
      return a.payment?.amount ?? "";
    default:
      return String(a.text ?? a.email ?? a.phone_number ?? a.date ?? a.url ?? a.file_url ?? "");
  }
}

/** Turns a Typeform webhook payload into a lead: contact details plus every question and answer. */
export function leadFromTypeform(payload: TypeformPayload): Omit<Lead, "id" | "status" | "statusUpdatedAt"> {
  const fr = payload.form_response;
  if (!fr?.answers) throw new Error("Not a Typeform form response");
  const titles = new Map((fr.definition?.fields ?? []).map((f) => [f.id, f.title ?? f.ref ?? "Question"]));
  const answers: QuizAnswer[] = [];
  let email: string | undefined;
  let phone: string | undefined;
  let first = "";
  let last = "";
  let full = "";

  for (const a of fr.answers) {
    const question = (titles.get(a.field.id) ?? a.field.title ?? a.field.ref ?? "Question").replace(/\*/g, "").trim();
    const answer = answerText(a).trim();
    answers.push({ question, answer });
    const q = question.toLowerCase();
    if (a.type === "email" && !email) email = a.email;
    else if (a.type === "phone_number" && !phone) phone = a.phone_number;
    else if (a.type === "text" && /name/.test(q)) {
      if (/first/.test(q)) first = answer;
      else if (/last|sur/.test(q)) last = answer;
      else if (!full) full = answer;
    }
  }
  const hidden = fr.hidden ?? {};
  const name = full || [first, last].filter(Boolean).join(" ") || hidden.name || email || phone || "Unknown lead";
  return {
    name,
    email: email ?? hidden.email,
    phone: phone ?? hidden.phone,
    source: fr.definition?.title ?? "Typeform",
    receivedAt: fr.submitted_at ? new Date(fr.submitted_at).toISOString() : new Date().toISOString(),
    answers,
    externalId: fr.token,
  };
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
    return { ...lead, id: newId("lead"), status, statusUpdatedAt: at.toISOString(), externalId: undefined };
  });
}
