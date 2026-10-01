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

function htmlToText(html: string) {
  return html
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

/**
 * Reads a lead notification email. Vendor emails almost always list fields one per line as
 * "Label: value"; we pick those out, and fall back to spotting an email address and phone number.
 */
export function leadFromEmail(
  client: Client,
  mail: { subject?: string; text?: string; html?: string; from?: string; messageId?: string; date?: string },
): NewLead {
  const body = (mail.text && mail.text.trim()) || (mail.html ? htmlToText(mail.html) : "");
  const pairs: [string, string][] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/^[>\s*•-]+/, "").trim();
    const m = line.match(/^([A-Za-z][A-Za-z0-9 _/#&().'-]{0,40}?)\s*[:=\t]\s*(.+)$/);
    // Skip forwarded-message headers ("From:", "Sent:", ...) and link fragments.
    if (m && !/^(https?|from|to|cc|bcc|sent|date|subject|reply to)$/i.test(m[1].trim())) pairs.push([m[1].trim(), m[2].trim()]);
  }
  const labelled = new Set(pairs.map(([l]) => FIELD[norm(l)]).filter(Boolean));
  if (!labelled.has("email")) {
    const em = body.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (em) pairs.push(["Email", em[0]]);
  }
  if (!labelled.has("phone")) {
    const ph = body.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    if (ph) pairs.push(["Phone", ph[0]]);
  }
  // Source: a labelled field wins; otherwise try the sender and subject against the client's sources.
  const hint = [mail.from, mail.subject].filter(Boolean).join(" ");
  const fromSource = matchSource(client, hint);
  const lead = leadFromFields(client, pairs, {
    source: fromSource !== OTHER ? fromSource : "Email lead",
    channel: "email",
    externalId: mail.messageId || createHash("sha256").update(`${mail.subject}|${body}`).digest("hex").slice(0, 32),
    receivedAt: mail.date && !Number.isNaN(Date.parse(mail.date)) ? new Date(mail.date).toISOString() : undefined,
  });
  if (mail.subject) lead.answers.unshift({ question: "Email subject", answer: mail.subject });
  return lead;
}

/** The Google Apps Script the admin pastes into script.google.com to forward labelled Gmail messages. */
export function gmailScript(endpoint: string, label = "OnRadar Leads") {
  return `/**
 * OnRadar CRM: send lead emails from Gmail to the Leads tab.
 * 1. Paste this into a new project at https://script.google.com and save.
 * 2. Run "setup" once and approve access. It creates the Gmail labels and a 5-minute timer.
 * 3. In Gmail, add the label "${label}" to lead emails (or create a filter that does it).
 */
const ENDPOINT = ${JSON.stringify(endpoint)};
const LABEL = ${JSON.stringify(label)};
const DONE_LABEL = LABEL + "/Imported";

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
