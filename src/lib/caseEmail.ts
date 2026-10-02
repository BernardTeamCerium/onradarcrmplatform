import "server-only";
import { createHash } from "crypto";
import { htmlToText } from "./inbound";
import { normaliseStatus, withProduction } from "./production";
import { stageFromStatus, stagesFor } from "./stages";
import { newId } from "./store";
import type { Agent, CaseStatus, Client, ProductionEntry } from "./types";

/**
 * Case status emails from the IMO / carrier (e.g. Allied Elite Financial via OneHQ):
 *
 *   Subject: Status Update- Transfer *Funds En Route* TB00071984: Veraea Cravens SILAC (...)
 *   Number   TB00071984
 *   Carrier  SILAC (Formerly Equitable Casualty and Life Insurance)
 *   Product  Teton Bonus
 *   Advisor  Christopher Troy Sibley
 *   Clients  Veraea Cravens
 *   Premium  $422,276.00 (Initial)
 *
 * Each email creates the case on the Production tab, or updates the case with the same number.
 */

export interface CaseEmail {
  caseNumber?: string;
  carrier?: string;
  product?: string;
  advisor?: string;
  clientName?: string;
  premium?: number;
  /** Status wording from the subject (or a "Status:" line). */
  status?: string;
  note?: string;
  sentAt?: string;
  from?: string;
  ref: string;
}

type Field = keyof Pick<CaseEmail, "caseNumber" | "carrier" | "product" | "advisor" | "clientName" | "premium" | "status">;
const LABELS: [RegExp, Field][] = [
  [/^(case|policy|contract|application|app|tracking)?\s*(number|no\.?|#)$/i, "caseNumber"],
  [/^(carrier|company|insurance company)$/i, "carrier"],
  [/^(product|plan|product name)$/i, "product"],
  [/^(advisor|adviser|agent|writing agent|producer|rep|representative)$/i, "advisor"],
  [/^(clients?|insured|owners?|annuitants?|client names?)$/i, "clientName"],
  [/^(premium|initial premium|amount|planned premium|target premium)$/i, "premium"],
  [/^(status|case status|current status)$/i, "status"],
];
const fieldFor = (label: string) => LABELS.find(([re]) => re.test(label.trim()))?.[1];

const BOILERPLATE = /^(we will continue|thank you|thanks|to ensure|please be advised|we appreciate|powered by|sincerely|regards)/i;

/** "$422,276.00 (Initial)" → 422276 */
const money = (v: string) => {
  const m = v.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : undefined;
};

const cleanStatus = (s: string) =>
  s
    .replace(/\*+\s*([^*]+?)\s*\*+/g, " - $1")
    .replace(/\s*-\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:-]+|[\s:-]+$/g, "");

function parseDateLoose(s: string | undefined) {
  if (!s) return undefined;
  const t = Date.parse(s.replace(/\s+at\s+/i, " "));
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export function parseCaseEmail(mail: { subject?: string; text?: string; html?: string; from?: string; messageId?: string; date?: string }): CaseEmail {
  const body = (mail.html ? htmlToText(mail.html) : "") || mail.text || "";
  const text = mail.html && mail.text && mail.text.length > body.length * 1.5 ? mail.text : body;
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^[>\s*•·-]+/, "").replace(/\s+/g, " ").trim());

  // Pasted or forwarded emails carry their own Subject: / Date: / From: lines.
  const header = (name: string) => lines.find((l) => new RegExp(`^${name}\\s*:`, "i").test(l))?.replace(/^[^:]+:\s*/, "");
  const subject = (mail.subject && !/^(fw|fwd)\s*:?\s*$/i.test(mail.subject) ? mail.subject : "") || header("Subject") || mail.subject || "";

  const out: CaseEmail = { ref: "" };
  let lastField = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // "Label: value", "Label<tab>value" or "Label   value"
    let m = line.match(/^([A-Za-z][A-Za-z .#/']{0,30}?)\s*(?::|\t|\s{2,})\s*(.+)$/);
    if (!m || !fieldFor(m[1])) {
      // "Label value" for a single-word label (how the IMO table reads as plain text)
      const sp = line.match(/^(Number|Carrier|Product|Advisor|Agent|Clients?|Insured|Premium|Status)\s+(.+)$/i);
      if (sp) m = sp;
    }
    let label = m?.[1];
    let value = m?.[2];
    // Label alone on a line, value on the next.
    if (!m && fieldFor(line) && lines[i + 1] && !fieldFor(lines[i + 1])) {
      label = line;
      value = lines[++i];
    }
    const f = label ? fieldFor(label) : undefined;
    if (!f || !value || out[f] !== undefined) continue;
    if (f === "premium") out.premium = money(value);
    else (out as unknown as Record<string, string>)[f] = value.trim();
    lastField = i;
  }

  // Status from the subject: "Status Update- <status> <case number>: <client> <carrier>"
  const subj = subject.replace(/^((re|fw|fwd)\s*:\s*)+/i, "");
  const su = subj.match(/status\s*update\s*[-:–—]?\s*(.+)$/i);
  if (su) {
    let s = su[1];
    if (out.caseNumber && s.includes(out.caseNumber)) s = s.slice(0, s.indexOf(out.caseNumber));
    else s = s.replace(/\b[A-Z]{1,4}\d{5,}\b.*$/, "");
    const st = cleanStatus(s);
    if (st) out.status = st;
  }
  if (!out.status && out.caseNumber) {
    // "<status> TB00071984: ..." without the "Status Update" prefix
    const i = subj.indexOf(out.caseNumber);
    if (i > 0) out.status = cleanStatus(subj.slice(0, i)) || undefined;
  }
  if (!out.caseNumber) out.caseNumber = subj.match(/\b[A-Z]{1,4}\d{6,}\b/)?.[0];
  out.status = out.status?.replace(/^(status\s*update|update)\s*[-:]?\s*/i, "") || out.status;

  // The message itself: the lines after the case details, up to the sign-off and boilerplate.
  if (lastField >= 0) {
    const note: string[] = [];
    for (const l of lines.slice(lastField + 1)) {
      if (BOILERPLATE.test(l)) break;
      if (!l || /^[A-Z][a-z]+:$/.test(l) || /^dear\b/i.test(l)) continue;
      note.push(l.replace(/^per\s+(.+?):$/i, "Per $1:"));
    }
    const n = note.join("\n").trim();
    if (n) out.note = n.slice(0, 1500);
  }

  out.sentAt = parseDateLoose(mail.date) ?? parseDateLoose(header("Date") ?? header("Sent"));
  out.from = mail.from || header("From");
  out.ref = mail.messageId || createHash("sha256").update(`${subject}|${text}`).digest("hex").slice(0, 32);
  return out;
}

/** Enough to be a case email: a case number, or a premium with an advisor or carrier. */
export const looksLikeCase = (c: CaseEmail) => !!c.caseNumber || (c.premium !== undefined && !!(c.advisor || c.carrier));

/** "Christopher Troy Sibley" → agent "Troy Sibley": every word of the agent's name appears in the advisor's. */
export function matchAdvisor(agents: Agent[], advisor: string) {
  const words = (s: string) => s.toLowerCase().replace(/\(sample\)/, "").replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(Boolean);
  const a = words(advisor);
  const exact = agents.find((g) => words(g.name).join(" ") === a.join(" "));
  if (exact) return exact;
  const contained = agents.filter((g) => words(g.name).length > 0 && words(g.name).every((w) => a.includes(w)));
  if (contained.length === 1) return contained[0];
  const last = agents.filter((g) => words(g.name).at(-1) === a.at(-1));
  return last.length === 1 ? last[0] : undefined;
}

const RANK: Record<CaseStatus, number> = { Submitted: 0, Declined: 1, Paid: 1, Chargeback: 2 };

export interface CaseEmailResult {
  action: "created" | "updated" | "duplicate";
  entry: ProductionEntry;
}

/** Creates the case, or applies the update to the case with the same number. */
export async function applyCaseEmail(client: Client, c: CaseEmail, by = "Email"): Promise<CaseEmailResult> {
  const sentAt = c.sentAt ?? new Date().toISOString();
  const day = sentAt.slice(0, 10);
  const mapped = c.status ? normaliseStatus(c.status) : "Submitted";
  const agent = c.advisor ? matchAdvisor(client.agents, c.advisor) : client.agents[0];
  const update = { at: sentAt, status: c.status ?? "Update", note: c.note, from: c.from, ref: c.ref };
  const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const stage = stageFromStatus(c.status, stagesFor(client));

  return withProduction(client, (entries) => {
    const existing = entries.find(
      (e) =>
        e.kind === "case" &&
        (c.caseNumber
          ? norm(e.caseNumber) === norm(c.caseNumber)
          : !e.caseNumber && norm(e.clientName) === norm(c.clientName) && e.premium === c.premium && norm(e.carrier) === norm(c.carrier)),
    );
    if (existing) {
      if (existing.updates?.some((u) => u.ref === c.ref)) return { action: "duplicate", entry: existing };
      existing.updates = [...(existing.updates ?? []), update].sort((a, b) => a.at.localeCompare(b.at));
      const latest = existing.updates.at(-1)!;
      // Only the newest email sets the current status, and a case never moves back from Paid to Submitted.
      if (latest.ref === c.ref) {
        if (c.status) existing.carrierStatus = c.status;
        if (stage && stage !== existing.stage) {
          existing.stage = stage;
          existing.stageAt = sentAt;
        }
        const cur = existing.status ?? "Submitted";
        // Cancelled before it was ever paid is a declined case, not a chargeback.
        const next: CaseStatus = mapped === "Chargeback" && cur === "Submitted" ? "Declined" : mapped;
        if (RANK[next] > RANK[cur]) {
          existing.status = next;
          if ((next === "Paid" || next === "Chargeback") && !existing.paidDate) existing.paidDate = day;
          if (next === "Chargeback" && !existing.chargebackDate) existing.chargebackDate = day;
        }
      }
      existing.date = existing.date && existing.date < day ? existing.date : day;
      existing.carrier ??= c.carrier;
      existing.product ??= c.product;
      existing.clientName ??= c.clientName;
      if (c.premium !== undefined && c.premium > 0) existing.premium = c.premium;
      existing.updatedAt = new Date().toISOString();
      return { action: "updated", entry: existing };
    }
    const entry: ProductionEntry = {
      id: newId("pr"),
      kind: "case",
      date: day,
      agentName: agent?.name ?? c.advisor ?? "Unassigned",
      agentId: agent?.id,
      clientName: c.clientName,
      carrier: c.carrier,
      product: c.product,
      premium: c.premium ?? 0,
      status: mapped,
      paidDate: mapped === "Paid" || mapped === "Chargeback" ? day : undefined,
      chargebackDate: mapped === "Chargeback" ? day : undefined,
      caseNumber: c.caseNumber,
      carrierStatus: c.status,
      stage: mapped === "Submitted" ? stage ?? stagesFor(client)[0] : undefined,
      stageAt: sentAt,
      updates: [update],
      createdAt: new Date().toISOString(),
      createdBy: by,
    };
    entries.push(entry);
    return { action: "created", entry };
  });
}
