import "server-only";
import { readJson, writeJson } from "./store";
import type { IcsEvent } from "./ics";

/**
 * Events sent by the Google Apps Script calendar sync (for calendars that have no secret iCal address,
 * e.g. Google Workspace accounts with external sharing turned off). Each sync replaces the agent's copy.
 */
export interface PushedCalendar {
  agentId: string;
  calendar?: string;
  receivedAt: string;
  from: string;
  to: string;
  events: { uid: string; start: string; end?: string; allDay: boolean; summary: string; description: string; location: string; cancelled: boolean }[];
}

const key = (clientId: string, agentId: string) => `calendar-push/${clientId}/${agentId.replace(/[^\w-]/g, "")}.json`;
export const MAX_PUSHED_EVENTS = 3000;

export const loadPushed = (clientId: string, agentId: string) => readJson<PushedCalendar>(key(clientId, agentId));
export const savePushed = (clientId: string, cal: PushedCalendar) => writeJson(key(clientId, cal.agentId), cal);

export function pushedEvents(cal: PushedCalendar): IcsEvent[] {
  return cal.events.map((e) => ({
    uid: e.uid,
    start: new Date(e.start),
    end: e.end ? new Date(e.end) : undefined,
    allDay: e.allDay,
    summary: e.summary,
    description: e.description,
    location: e.location,
    cancelled: e.cancelled,
  }));
}

/** The Apps Script the agent runs in their own Google account (script.google.com). */
export function calendarSyncScript(endpoint: string, agentName: string) {
  return `/**
 * OnRadar CRM: send ${agentName}'s Google Calendar appointments to the Calendar tab.
 * Works without the "secret address" (fine for Google Workspace accounts).
 * 1. Sign in as ${agentName} (or an assistant the calendar is shared with) and open https://script.google.com → New project.
 * 2. Paste this, Save, choose "setup" in the function menu and click Run. Approve the permissions.
 * 3. Done: it sends the calendar every 15 minutes. Read-only: it never changes the calendar.
 */
const ENDPOINT = ${JSON.stringify(endpoint)};
// "primary" = the signed-in person's own calendar. If you're an assistant, put the agent's email address here.
const CALENDAR_ID = "primary";
// Leave blank to send every timed event, or e.g. "appt" to send only events whose title contains that word.
const ONLY_IF_TITLE_HAS = "";
const DAYS_BACK = 14;
const DAYS_AHEAD = 60;

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "syncCalendar") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncCalendar").timeBased().everyMinutes(15).create();
  syncCalendar();
}

function syncCalendar() {
  const cal = CALENDAR_ID === "primary" ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error("Calendar not found: " + CALENDAR_ID + ". Check the address, and that it's shared with you.");
  const from = new Date(Date.now() - DAYS_BACK * 86400000);
  const to = new Date(Date.now() + DAYS_AHEAD * 86400000);
  const filter = ONLY_IF_TITLE_HAS.toLowerCase();
  const events = cal.getEvents(from, to)
    .filter(function (e) { return !filter || e.getTitle().toLowerCase().indexOf(filter) >= 0; })
    .slice(0, ${MAX_PUSHED_EVENTS})
    .map(function (e) {
      let declined = false;
      try { declined = String(e.getMyStatus()) === "NO"; } catch (err) {}
      return {
        id: e.getId(),
        title: e.getTitle(),
        start: e.getStartTime().toISOString(),
        end: e.getEndTime().toISOString(),
        allDay: e.isAllDayEvent(),
        description: (e.getDescription() || "").slice(0, 4000),
        location: e.getLocation() || "",
        cancelled: declined,
      };
    });
  const res = UrlFetchApp.fetch(ENDPOINT, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({ calendar: cal.getName(), from: from.toISOString(), to: to.toISOString(), events: events }),
  });
  if (res.getResponseCode() >= 300) throw new Error("OnRadar " + res.getResponseCode() + ": " + res.getContentText());
  console.log("Sent " + events.length + " events to OnRadar");
}
`;
}
