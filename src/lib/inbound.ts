import "server-only";
import { createHash, timingSafeEqual } from "crypto";
import { matchSource, OTHER } from "./sources";
import type { Client, Lead, QuizAnswer } from "./types";

type NewLead = Omit<Lead, "id" | "status" | "statusUpdatedAt">;

export function checkKey(client: Client, key: string | null) {
  if (!key || !client.inboundKey) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(client.inboundKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Field labels we recognise in lead emails and posted data (lower-case, punctuation stripped). */
const FIELD: Record<string, "first" | "last" | "name" | "email" | "phone" | "city" | "state" | "zip" | "source" | "address"> = {
  "first name": "first", firstname: "first", first: "first", fname: "first",
  "last name": "last", lastname: "last", last: "last", lname: "last", surname: "last",
  name: "name", "full name": "name", fullname: "name", "contact name": "name", "lead name": "name", "client name": "name", "customer name": "name",
  email: "email", "email address": "email", "e mail": "email",
  phone: "phone", "phone number": "phone", "home phone": "phone", "cell phone": "phone", cell: "phone", mobile: "phone", "mobile phone": "phone", "primary phone": "phone", telephone: "phone", "best phone": "phone",
  city: "city", town: "city",
  state: "state", province: "state", st: "state",
  zip: "zip", "zip code": "zip", zipcode: "zip", "postal code": "zip",
  address: "address", "street address": "address", "address 1": "address",
  source: "source", "lead source": "source", vendor: "source", "lead vendor": "source", campaign: "source", provider: "source", "lead type": "source",
};

const norm = (label: string) => label.toLowerCase().replace(/[_\-*:#]+/g, " ").replace(/\s+/g, " ").trim();
const tidyName = (s: string) => s.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Builds a lead from label → value pairs, keeping every unrecognised field as an answer. */
export function leadFromFields(
  client: Client,
  pairs: [string, string][],
  defaults: { source?: string; channel: NewLead["channel"]; externalId?: string; receivedAt?: string },
): NewLead {
  const found: Partial<Record<string, string>> = {};
  const answers: QuizAnswer[] = [];
  for (const [rawLabel, rawValue] of pairs) {
    const value = String(rawValue ?? "").trim();
    if (!rawLabel || !value) continue;
    const key = FIELD[norm(rawLabel)];
    if (key && !found[key]) found[key] = value;
    else answers.push({ question: rawLabel.replace(/[_]+/g, " ").trim(), answer: value });
  }
  const name = found.name || [found.first, found.last].filter(Boolean).join(" ") || found.email || found.phone || "Unknown lead";
  const rawSource = found.source || defaults.source || "";
  const matched = matchSource(client, rawSource);
  if (found.address) answers.unshift({ question: "Address", answer: found.address });
  if (found.zip) answers.unshift({ question: "ZIP", answer: found.zip });
  return {
    name: tidyName(name),
    email: found.email?.toLowerCase(),
    phone: found.phone,
    city: found.city ? tidyName(found.city) : undefined,
    state: found.state ? (found.state.length === 2 ? found.state.toUpperCase() : tidyName(found.state)) : undefined,
    source: matched !== OTHER ? matched : rawSource || "Email lead",
    receivedAt: defaults.receivedAt ?? new Date().toISOString(),
    answers,
    channel: defaults.channel,
    externalId: defaults.externalId,
  };
}

export function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ": ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

const BOILERPLATE = /^on .{5,160} wrote:$|unsubscribe|privacy policy|click here|view (this |the )?lead|all rights reserved|©|manage (your )?preferences|sent from my|do not reply|this (e-?mail|message) (was|is)|confidential/i;
const HEADER = /^(from|to|cc|bcc|sent|date|subject|reply-to|reply to)$/i;

/** Strips email formatting noise: *bold* / _italic_ markers, <mailto:…> / <tel:…> / <https://…> link tails, odd spaces. */
function cleanLine(raw: string) {
  return raw
    .replace(/\u00a0|\u200b|\u200c|\u200d|\ufeff/g, " ")
    .replace(/<(mailto:|tel:|https?:)[^>]*>/gi, "")
    .replace(/^[>\s•·-]+/, "")
    .replace(/(^|\s)[*_]+|[*_]+(?=\s|:|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const isKnownLabel = (l: string) => !!FIELD[norm(l.replace(/[:?]+$/, ""))];
const looksLikeLabel = (l: string) => l.length <= 80 && /[A-Za-z]/.test(l) && (isKnownLabel(l) || /[:?]$/.test(l));

/** Pulls label → value pairs from the lines of an email body. */
function pairsFrom(body: string): { pairs: [string, string][]; headers: Record<string, string> } {
  const lines = body.split(/\r?\n/).map(cleanLine);
  const pairs: [string, string][] = [];
  const headers: Record<string, string> = {};
  // Inside a block of label-line / value-line pairs, unknown labels ("Retirement Savings") count too.
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (BOILERPLATE.test(line)) {
      inBlock = false;
      continue;
    }
    // "Label: value", "Label = value", "Label<tab>value", or "Question? answer"
    const m = line.match(/^([A-Za-z][A-Za-z0-9 _/#&().,'-]{0,78}?)\s*(?::|=|\t)\s*(.+)$/) ?? line.match(/^([A-Z][^?]{2,78}\?)\s+(.+)$/);
    if (m && !/^https?$/i.test(m[1].trim())) {
      inBlock = false;
      const label = m[1].trim();
      if (HEADER.test(label)) headers[label.toLowerCase()] ??= m[2].trim(); // forwarded-message headers
      else pairs.push([label.replace(/[?]$/, "?"), m[2].trim()]);
      continue;
    }
    // Label on its own line, value on the next (how Gmail's plain text shows most vendor tables).
    const next = lines.slice(i + 1).find((x) => x) ?? "";
    const nextIdx = lines.indexOf(next, i + 1);
    const unknownInBlock = inBlock && line.length <= 60 && !/@|\d{3}\D{0,3}\d{3}\D{0,3}\d{4}|\$/.test(line);
    if ((looksLikeLabel(line) || unknownInBlock) && next && !looksLikeLabel(next) && !BOILERPLATE.test(next)) {
      pairs.push([line.replace(/:$/, "").trim(), next]);
      i = nextIdx;
      inBlock = true;
      continue;
    }
    inBlock = false;
  }
  return { pairs, headers };
}

/** Second pass for label/value blocks with labels we don't know (e.g. "Retirement Savings" then "$500k-$1M"). */
function alternatingPairs(body: string): [string, string][] {
  const lines = body.split(/\r?\n/).map(cleanLine).filter((l) => l && !BOILERPLATE.test(l));
  // Find where known labels alternate with values, then read that whole block two lines at a time.
  const starts = lines.map((l, i) => (isKnownLabel(l) && lines[i + 1] && !isKnownLabel(lines[i + 1]) ? i : -1)).filter((i) => i >= 0);
  if (starts.length < 2) return [];
  const out: [string, string][] = [];
  for (let i = starts[0]; i + 1 < lines.length; i += 2) {
    const [label, value] = [lines[i], lines[i + 1]];
    if (label.length > 60 || /[:=\t]/.test(label) || /@|\d{3}.*\d{4}/.test(label)) break; // block ended
    out.push([label.replace(/[:]$/, ""), value]);
  }
  return out;
}

/** "12 Oak St, Mandeville, LA 70448" → city, state, zip */
function placeFromAddress(addr: string) {
  const m = addr.match(/,\s*([A-Za-z .'-]+?),?\s+([A-Z]{2})\.?\s*(\d{5})?(?:-\d{4})?\s*(?:,?\s*(USA|US|United States))?$/);
  return m ? { city: m[1].trim(), state: m[2], zip: m[3] } : null;
}

/** "New lead: Margaret Doucet" → "Margaret Doucet" (only when it looks like a person's name). */
function nameFromSubject(subject: string) {
  const s = subject.replace(/^((re|fw|fwd)\s*:\s*)+/i, "");
  const m = s.match(/(?:lead|inquiry|enquiry|request|submission|contact)\s*(?:from|for)?\s*[:\-–—]\s*(.+)$/i) ?? s.match(/\bfrom\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){1,2})\s*$/);
  const n = m?.[1].trim();
  return n && /^[A-Z][a-zA-Z'-]+(\s+[A-Z][a-zA-Z'.-]+){1,3}$/.test(n) ? n : undefined;
}

/**
 * Reads a lead notification email. Vendors list fields as "Label: value", as a table, or (in Gmail's plain text)
 * with the label and value on separate lines; all three are handled. Both the plain-text and HTML versions are
 * read and the one with more recognisable fields is used.
 */
export function leadFromEmail(
  client: Client,
  mail: { subject?: string; text?: string; html?: string; from?: string; messageId?: string; date?: string },
): NewLead {
  const candidates = [mail.text ?? "", mail.html ? htmlToText(mail.html) : ""].filter((b) => b.trim());
  const scored = candidates.map((body) => {
    const r = pairsFrom(body);
    const known = new Set(r.pairs.map(([l]) => FIELD[norm(l)]).filter(Boolean));
    if (known.size < 2 || r.pairs.length < 4) {
      const alt = alternatingPairs(body);
      if (alt.length > r.pairs.length) {
        r.pairs = alt;
        for (const [l] of alt) if (FIELD[norm(l)]) known.add(FIELD[norm(l)]);
      }
    }
    return { body, ...r, score: known.size * 10 + r.pairs.length };
  });
  const best = scored.sort((a, b) => b.score - a.score)[0] ?? { body: "", pairs: [] as [string, string][], headers: {} as Record<string, string> };
  const { body, headers } = best;
  const pairs = best.pairs.filter(([, v]) => !BOILERPLATE.test(v));

  const labelled = new Set(pairs.map(([l]) => FIELD[norm(l)]).filter(Boolean));
  if (!labelled.has("email")) {
    const own = (mail.from ?? "").toLowerCase();
    const em = [...body.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)].map((x) => x[0]).find((e) => !own.includes(e.toLowerCase()) && !/no-?reply|notifications?@|mailer/i.test(e));
    if (em) pairs.push(["Email", em]);
  }
  if (!labelled.has("phone")) {
    const ph = body.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    if (ph) pairs.push(["Phone", ph[0]]);
  }
  // City / state from a full address line when they aren't their own fields.
  if (!labelled.has("city") || !labelled.has("state")) {
    const addr = pairs.find(([l]) => FIELD[norm(l)] === "address")?.[1];
    const place = addr ? placeFromAddress(addr) : null;
    if (place) {
      if (!labelled.has("city")) pairs.push(["City", place.city]);
      if (!labelled.has("state")) pairs.push(["State", place.state]);
      if (place.zip && !labelled.has("zip")) pairs.push(["Zip", place.zip]);
    }
  }
  const subject = headers.subject && /^((fw|fwd)\s*:)/i.test(mail.subject ?? "") ? headers.subject : mail.subject ?? "";
  if (!labelled.has("name") && !(labelled.has("first") && labelled.has("last"))) {
    const n = nameFromSubject(subject);
    if (n) pairs.unshift(["Name", n]);
  }
  // Source: a labelled field wins; otherwise the sender (the original sender when forwarded) and subject.
  const hint = [headers.from, mail.from, subject].filter(Boolean).join(" ");
  const fromSource = matchSource(client, hint);
  const lead = leadFromFields(client, pairs, {
    source: fromSource !== OTHER ? fromSource : "Email lead",
    channel: "email",
    externalId: mail.messageId || createHash("sha256").update(`${mail.subject}|${body}`).digest("hex").slice(0, 32),
    receivedAt: mail.date && !Number.isNaN(Date.parse(mail.date)) ? new Date(mail.date).toISOString() : undefined,
  });
  if (/@/.test(lead.name)) lead.name = lead.name.toLowerCase();
  if (subject) lead.answers.push({ question: "Email subject", answer: subject });
  return lead;
}

/** The Google Apps Script the admin pastes into script.google.com to forward labelled Gmail messages. */
export function gmailScript(endpoint: string, label = "OnRadar Leads", what = "lead emails", tab = "Leads tab") {
  return `/**
 * OnRadar CRM: send ${what} from Gmail to the ${tab}.
 * 1. Paste this into a new project at https://script.google.com and save.
 * 2. Run "setup" once and approve access. It creates the Gmail labels and a 5-minute timer.
 * 3. In Gmail, add the label "${label}" to ${what} (or create a filter that does it).
 *    Leave "Skip the Inbox" unticked in the filter so emails stay in the inbox.
 * Safe for the mailbox: it only reads labelled emails and swaps "${label}" for "${label}/Imported".
 * It never archives, deletes, moves or marks emails as read.
 */
const ENDPOINT = ${JSON.stringify(endpoint)};
const LABEL = ${JSON.stringify(label)};
const DONE_LABEL = LABEL + "/Imported";
const ME = (Session.getActiveUser().getEmail() || "").toLowerCase();

function setup() {
  GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sendLeads").timeBased().everyMinutes(5).create();
  sendLeads();
}

function sendLeads() {
  const label = GmailApp.getUserLabelByName(LABEL);
  const done = GmailApp.getUserLabelByName(DONE_LABEL);
  if (!label) return;
  label.getThreads(0, 50).forEach(function (thread) {
    let ok = true;
    thread.getMessages().forEach(function (m) {
      // Skip replies sent from this mailbox: only the incoming emails are leads / updates.
      if (ME && m.getFrom().toLowerCase().indexOf(ME) >= 0) return;
      const res = UrlFetchApp.fetch(ENDPOINT, {
        method: "post",
        contentType: "application/json",
        muteHttpExceptions: true,
        payload: JSON.stringify({
          subject: m.getSubject(),
          from: m.getFrom(),
          date: m.getDate().toISOString(),
          messageId: m.getHeader("Message-ID") || m.getId(),
          text: m.getPlainBody(),
          html: m.getBody(),
        }),
      });
      if (res.getResponseCode() >= 300) { ok = false; console.log("OnRadar error " + res.getResponseCode() + ": " + res.getContentText()); }
    });
    if (ok) { thread.removeLabel(label); thread.addLabel(done); }
  });
}
`;
}
