import "server-only";
import * as ghl from "./ghl";
import { cleanPlace, samplePlace } from "./geo";
import { leadFromTypeform, listLeads, sampleTypeformPayload } from "./leads";
import { demoRows, hash, rng, usesLiveData } from "./metrics";
import { sampleProfile } from "./profiles";
import { matchSource, OTHER, profile } from "./sources";
import { createHash } from "crypto";
import { listBooked } from "./appointments";
import { fetchIcs } from "./ics";
import type { Agent, ApptStatus, ApptType, BookedAppt, CalendarAppt, Client, Lead } from "./types";

const DAY = 86_400_000;

/** Today's date (YYYY-MM-DD) and minutes past midnight in the client's time zone. */
export function nowIn(timeZone: string, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Monday of the week containing `date`. */
export function weekStart(date: string) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

/** Parses a quiz savings answer like "$250k–$500k" or "$2M+" into a dollar estimate. */
function assetsFrom(label: string | undefined, rand: () => number) {
  if (!label) return null;
  const nums = [...label.matchAll(/\$?(\d+(?:\.\d+)?)\s*([kKmM])/g)].map((m) => Number(m[1]) * (m[2].toLowerCase() === "m" ? 1_000_000 : 1_000));
  if (nums.length === 0) return null;
  const lo = nums[0];
  const hi = nums[1] ?? lo * 2;
  return Math.round((lo + rand() * (hi - lo)) / 5_000) * 5_000;
}

const answerTo = (answers: { question: string; answer: string }[], re: RegExp) => answers.find((a) => re.test(a.question.toLowerCase()))?.answer;

// ---------------------------------------------------------------------------
// Sample calendar

const SLOTS = Array.from({ length: 17 }, (_, i) => 9 * 60 + i * 30); // 9:00 to 17:00

function agentWeights(agents: Agent[]) {
  // The lead agent takes the biggest share of appointments.
  return agents.map((_, i) => (i === 0 ? 0.45 : 0.55 / Math.max(1, agents.length - 1)));
}

function pickWeighted<T>(items: T[], weights: number[], rand: () => number) {
  let x = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
}

function sampleDay(client: Client, date: string, today: { date: string; minutes: number }): CalendarAppt[] {
  if (client.agents.length === 0) return [];
  const utcDay = { start: new Date(`${date}T00:00:00Z`), end: new Date(Date.parse(`${date}T00:00:00Z`) + DAY) };
  let set: number;
  let connected: number;
  if (date <= today.date) {
    const row = demoRows(client, utcDay)[0];
    set = row.apptsSet;
    connected = row.appointments;
  } else {
    // Future days: booked at the recent pace (weekdays, a light Saturday, no Sunday), thinning out further ahead.
    const ahead = (Date.parse(date) - Date.parse(today.date)) / DAY;
    const recent = demoRows(client, { start: new Date(Date.parse(`${today.date}T00:00:00Z`) - 14 * DAY), end: new Date(`${today.date}T00:00:00Z`) });
    const perDay = recent.reduce((a, r) => a + r.apptsSet, 0) / 12; // ~12 working days in two weeks
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const dayFactor = dow === 0 ? 0 : dow === 6 ? 0.3 : 1;
    const expected = perDay * dayFactor * Math.max(0, 1 - ahead / 12);
    const r = rng(hash(`${client.id}:${date}:booked`))();
    set = Math.floor(expected) + (r < expected - Math.floor(expected) ? 1 : 0);
    connected = set;
  }

  const weights = agentWeights(client.agents);
  const taken = new Map<string, Set<number>>();
  const sourceNames = client.sources.map((s) => s.name);
  const sourceW = sourceNames.map((n) => profile(n).leads);
  const appts: CalendarAppt[] = [];
  for (let i = 0; i < set; i++) {
    const rand = rng(hash(`${client.id}:${date}:appt:${i}`));
    let agent = pickWeighted(client.agents, weights, rand);
    let free = SLOTS.filter((m) => !taken.get(agent.id)?.has(m));
    if (free.length === 0) {
      agent = client.agents.find((a) => SLOTS.some((m) => !taken.get(a.id)?.has(m))) ?? agent;
      free = SLOTS.filter((m) => !taken.get(agent.id)?.has(m));
      if (free.length === 0) break;
    }
    const minute = free[Math.floor(rand() * free.length)];
    taken.set(agent.id, new Set([...(taken.get(agent.id) ?? []), minute]));

    const lead = leadFromTypeform(sampleTypeformPayload(rand, new Date(Date.parse(`${date}T12:00:00Z`) - (2 + rand() * 10) * DAY)));
    const source = sourceNames.length ? pickWeighted(sourceNames, sourceW, rand) : OTHER;
    const place = samplePlace(source, rand);
    const saved = answerTo(lead.answers, /saved/);
    const assets = assetsFrom(saved, rand);
    appts.push({
      id: `${date}~${i}`,
      agentId: agent.id,
      date,
      time: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
      minutes: 60,
      status: "Scheduled",
      name: lead.name,
      age: answerTo(lead.answers, /old|age/),
      assets,
      assetsLabel: saved,
      city: place.city,
      state: place.state,
      source,
      phone: lead.phone,
      email: lead.email,
      quiz: { title: lead.source, answers: lead.answers },
      profile: sampleProfile(rng(hash(`${client.id}:${date}:profile:${i}`)), lead.answers, assets),
    });
    appts[appts.length - 1].apptType = appts[appts.length - 1].profile!.apptType;
  }
  appts.sort((a, b) => a.time.localeCompare(b.time) || a.agentId.localeCompare(b.agentId));

  // Outcomes: past appointments showed / no-showed / cancelled in line with the day's connected count.
  const rand = rng(hash(`${client.id}:${date}:outcomes`));
  const isPast = (a: CalendarAppt) => a.date < today.date || (a.date === today.date && toMinutes(a.time) + a.minutes <= today.minutes);
  const past = appts.filter(isPast);
  const showRate = set > 0 ? connected / set : 0.6;
  const shows = date < today.date ? connected : Math.round(past.length * showRate);
  const order = [...past];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.forEach((a, i) => (a.status = i < shows ? "Showed" : rand() < 0.6 ? "No-show" : "Cancelled"));
  for (const a of appts) if (!isPast(a)) a.status = rand() < 0.65 ? "Confirmed" : "Scheduled";
  return appts;
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// ---------------------------------------------------------------------------
// Live calendar

function matchLead(leads: Lead[], c: ghl.CrmContactDetail) {
  const email = c.email?.toLowerCase();
  const phone = c.phone?.replace(/\D/g, "").slice(-10);
  return leads.find((l) => (email && l.email?.toLowerCase() === email) || (phone && l.phone?.replace(/\D/g, "").slice(-10) === phone));
}

/** Reads the meeting type from the CRM appointment title, e.g. "Policy review - Jane Doe". */
function typeFromTitle(title?: string): ApptType | undefined {
  const t = (title ?? "").toLowerCase();
  if (/rollover|401/.test(t)) return "401(k) rollover";
  if (/annuity/.test(t)) return "Annuity review";
  if (/policy|review/.test(t)) return "Policy review";
  if (/income/.test(t)) return "Retirement income plan";
  if (/estate|beneficiar/.test(t)) return "Beneficiary & estate review";
  if (/new money|new client|consult|strategy/.test(t)) return "New money";
  return undefined;
}

function mapStatus(s: string | undefined, past: boolean): ApptStatus {
  switch ((s ?? "").toLowerCase()) {
    case "showed":
      return "Showed";
    case "noshow":
      return "No-show";
    case "cancelled":
      return "Cancelled";
    case "confirmed":
      return past ? "Showed" : "Confirmed";
    default:
      return "Scheduled";
  }
}

async function liveDays(client: Client, dates: string[], today: { date: string; minutes: number }) {
  const creds = { locationId: client.ghl.locationId, apiToken: client.ghl.apiToken };
  // Pad a day each side so time-zone offsets don't drop events at the edges.
  const start = new Date(Date.parse(`${dates[0]}T00:00:00Z`) - DAY);
  const end = new Date(Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) + 2 * DAY);
  const [events, crmUsers, leads] = await Promise.all([ghl.calendarEvents(creds, start, end), ghl.users(creds).catch(() => []), listLeads(client.id)]);
  const agents = [...client.agents];
  const agentFor = (userId?: string) => {
    let a = agents.find((x) => x.crmUserId && x.crmUserId === userId);
    if (!a) {
      const name = crmUsers.find((u) => u.id === userId)?.name ?? "Unassigned";
      a = agents.find((x) => x.name === name) ?? { id: `crm_${userId ?? "none"}`, name, crmUserId: userId };
      if (!agents.includes(a)) agents.push(a);
    }
    return a;
  };
  const inRange = events.filter((e) => dates.includes(nowIn(client.timeZone, new Date(e.startTime)).date));
  const contacts = new Map<string, ghl.CrmContactDetail>();
  await Promise.all(
    [...new Set(inRange.map((e) => e.contactId).filter(Boolean) as string[])].slice(0, 150).map(async (id) => {
      contacts.set(id, await ghl.contact(creds, id).catch(() => ({ id, name: "Unknown" })));
    }),
  );
  const appts: CalendarAppt[] = inRange.map((e) => {
    const local = nowIn(client.timeZone, new Date(e.startTime));
    const c = (e.contactId && contacts.get(e.contactId)) || { id: "", name: e.title ?? "Appointment" };
    const lead = matchLead(leads, c);
    const saved = lead ? answerTo(lead.answers, /saved|assets|invest/) : undefined;
    const place = cleanPlace(c.city, c.state);
    const minutes = e.endTime ? Math.max(15, Math.round((Date.parse(e.endTime) - Date.parse(e.startTime)) / 60_000)) : 60;
    const past = local.date < today.date || (local.date === today.date && local.minutes + minutes <= today.minutes);
    return {
      id: `live~${e.id}`,
      agentId: agentFor(e.assignedUserId).id,
      date: local.date,
      time: `${String(Math.floor(local.minutes / 60)).padStart(2, "0")}:${String(local.minutes % 60).padStart(2, "0")}`,
      minutes,
      status: mapStatus(e.appointmentStatus, past),
      name: c.name,
      age: lead ? answerTo(lead.answers, /old|age/) : undefined,
      assets: assetsFrom(saved, () => 0.5),
      assetsLabel: saved,
      city: place.city,
      state: place.state,
      source: matchSource(client, c.source),
      phone: c.phone,
      email: c.email,
      quiz: lead ? { title: lead.source, answers: lead.answers } : undefined,
      apptType: typeFromTitle(e.title),
    };
  });
  return { agents, appts: appts.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)) };
}

// ---------------------------------------------------------------------------

export interface CalendarWeek {
  agents: Agent[];
  today: { date: string; minutes: number };
  days: { date: string; appts: CalendarAppt[] }[];
  source: "ghl" | "demo";
  /** What's on screen, e.g. "Sample data" or "Booked appointments + Google Calendar". */
  label: string;
  warnings: string[];
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Fills an appointment's prospect details (quiz, contact, assets) from a Leads-tab lead. */
function fromLead(client: Client, lead: Lead | undefined, base: CalendarAppt): CalendarAppt {
  if (!lead) return base;
  const saved = answerTo(lead.answers, /saved|assets|invest|savings/);
  return {
    ...base,
    leadId: lead.id,
    name: lead.name,
    phone: lead.phone ?? base.phone,
    email: lead.email ?? base.email,
    city: lead.city ?? base.city,
    state: lead.state ?? base.state,
    source: matchSource(client, lead.source) !== OTHER ? matchSource(client, lead.source) : lead.source,
    age: answerTo(lead.answers, /old|age/) ?? base.age,
    assets: base.assets ?? assetsFrom(saved, () => 0.5),
    assetsLabel: base.assetsLabel ?? saved,
    quiz: { title: lead.source, answers: lead.answers },
  };
}

function bookedToAppt(client: Client, b: BookedAppt, leads: Lead[]): CalendarAppt {
  const lead = leads.find((l) => l.id === b.leadId);
  return fromLead(client, lead, {
    id: `bk~${b.id}`,
    origin: "booked",
    agentId: b.agentId,
    date: b.date,
    time: b.time,
    minutes: b.minutes,
    status: b.status,
    name: lead?.name ?? "Lead",
    assets: null,
    city: "Unknown",
    state: "Unknown",
    source: OTHER,
    apptType: b.apptType,
  });
}

/** Matches a Google Calendar event to a lead by email, phone or full name mentioned in the event. */
function leadForEvent(leads: Lead[], text: string) {
  const t = text.toLowerCase();
  const digits = text.replace(/\D/g, "");
  return leads.find(
    (l) =>
      (l.email && t.includes(l.email.toLowerCase())) ||
      (l.phone && l.phone.replace(/\D/g, "").slice(-10).length === 10 && digits.includes(l.phone.replace(/\D/g, "").slice(-10))) ||
      (l.name.includes(" ") && t.includes(l.name.toLowerCase())),
  );
}

async function googleAppts(client: Client, dates: string[], today: { date: string; minutes: number }, leads: Lead[], warnings: string[]) {
  const out: CalendarAppt[] = [];
  await Promise.all(
    client.agents
      .filter((a) => a.googleIcsUrl)
      .map(async (agent) => {
        try {
          const events = await fetchIcs(agent.googleIcsUrl!, client.timeZone);
          for (const ev of events) {
            if (ev.allDay) continue; // all-day items are blocks / reminders, not appointments
            const local = nowIn(client.timeZone, ev.start);
            if (!dates.includes(local.date)) continue;
            const minutes = ev.end ? Math.max(15, Math.round((ev.end.getTime() - ev.start.getTime()) / 60_000)) : 60;
            const past = local.date < today.date || (local.date === today.date && local.minutes + minutes <= today.minutes);
            const lead = leadForEvent(leads, `${ev.summary}\n${ev.description}\n${ev.location}`);
            const title = ev.summary.replace(/^(appointment|appt|meeting|call)\s*(with|:|-)\s*/i, "").trim();
            out.push(
              fromLead(client, lead, {
                id: `gc~${local.date}~${agent.id}~${createHash("sha1").update(ev.uid + ev.start.toISOString()).digest("hex").slice(0, 12)}`,
                origin: "google",
                agentId: agent.id,
                date: local.date,
                time: hhmm(local.minutes),
                minutes,
                status: ev.cancelled ? "Cancelled" : past ? "Showed" : "Scheduled",
                name: title || "Google Calendar event",
                assets: null,
                city: "Unknown",
                state: "Unknown",
                source: "Google Calendar",
                apptType: typeFromTitle(ev.summary) ?? typeFromTitle(ev.description),
              }),
            );
          }
        } catch (err) {
          warnings.push(`Couldn't read ${agent.name}'s Google Calendar (${(err as Error).message}). Check the calendar address in settings.`);
        }
      }),
  );
  return out;
}

export async function getCalendarWeek(client: Client, start: string): Promise<CalendarWeek> {
  const today = nowIn(client.timeZone);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const warnings: string[] = [];
  let agents = client.agents;
  let base: CalendarAppt[] = [];
  let source: "ghl" | "demo" = "demo";
  const parts: string[] = [];

  if (usesLiveData(client)) {
    try {
      const live = await liveDays(client, dates, today);
      agents = live.agents;
      base = live.appts.map((a) => ({ ...a, origin: "crm" as const }));
      source = "ghl";
      parts.push("OnRadar CRM");
    } catch (err) {
      console.error(`Calendar failed for ${client.id}:`, err);
      warnings.push("Live calendar is temporarily unavailable.");
    }
  } else if (client.demoMode && client.calendarSamples !== false) {
    base = dates.flatMap((date) => sampleDay(client, date, today)).map((a) => ({ ...a, origin: "sample" as const }));
    parts.push("Sample data");
  }

  const leads = await listLeads(client.id);
  const booked = (await listBooked(client.id)).filter((b) => dates.includes(b.date)).map((b) => bookedToAppt(client, b, leads));
  if (booked.length) parts.push("Booked from Leads");
  const google = await googleAppts(client, dates, today, leads, warnings);
  if (client.agents.some((a) => a.googleIcsUrl)) parts.push("Google Calendar");

  const all = [...base, ...booked, ...google];
  return {
    agents,
    today,
    days: dates.map((date) => ({ date, appts: all.filter((a) => a.date === date).sort((a, b) => a.time.localeCompare(b.time)) })),
    source,
    label: parts.join(" + ") || "No calendars connected",
    warnings,
  };
}

/** One appointment with its prospect's full quiz answers (for the bio page). */
export async function getAppointment(client: Client, id: string) {
  if (id.startsWith("bk~")) {
    const b = (await listBooked(client.id)).find((x) => x.id === id.slice(3));
    return b ? { appt: bookedToAppt(client, b, await listLeads(client.id)), agents: client.agents } : null;
  }
  if (id.startsWith("gc~")) {
    const date = id.split("~")[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const w = await getCalendarWeek(client, weekStart(date));
    const hit = w.days.flatMap((d) => d.appts).find((a) => a.id === id);
    return hit ? { appt: hit, agents: w.agents } : null;
  }
  if (id.startsWith("live~")) {
    const today = nowIn(client.timeZone);
    for (const offset of [0, -7, 7]) {
      const w = await getCalendarWeek(client, addDays(weekStart(today.date), offset));
      const hit = w.days.flatMap((d) => d.appts).find((a) => a.id === id);
      if (hit) return { appt: hit, agents: w.agents };
    }
    return null;
  }
  const [date] = id.split("~");
  if (!client.demoMode || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const appt = sampleDay(client, date, nowIn(client.timeZone)).find((a) => a.id === id);
  return appt ? { appt: { ...appt, origin: "sample" as const }, agents: client.agents } : null;
}
