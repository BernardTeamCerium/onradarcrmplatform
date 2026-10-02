import "server-only";

export interface IcsEvent {
  uid: string;
  start: Date;
  end?: Date;
  allDay: boolean;
  summary: string;
  description: string;
  location: string;
  cancelled: boolean;
}

/** Wall-clock time in `timeZone` → the real instant (handles daylight saving). */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

function parseIcsDate(value: string, params: string, fallbackTz: string): { date: Date; allDay: boolean } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { date: new Date(Date.UTC(+y, +mo - 1, +d, 12)), allDay: true };
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
  const tz = params.match(/TZID=([^;:]+)/)?.[1]?.replace(/^"|"$/g, "") || fallbackTz;
  try {
    return { date: zonedToUtc(+y, +mo, +d, +h, +mi, +s, tz), allDay: false };
  } catch {
    return { date: zonedToUtc(+y, +mo, +d, +h, +mi, +s, fallbackTz), allDay: false };
  }
}

const unescape = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** Minimal iCalendar (.ics) reader for Google Calendar feeds: one-off events, times and text fields. */
export function parseIcs(text: string, fallbackTz: string): IcsEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out: IcsEvent[] = [];
  let cur: Record<string, { value: string; params: string }> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT" && cur) {
      const start = cur.DTSTART && parseIcsDate(cur.DTSTART.value, cur.DTSTART.params, fallbackTz);
      if (start) {
        const end = cur.DTEND && parseIcsDate(cur.DTEND.value, cur.DTEND.params, fallbackTz);
        out.push({
          uid: cur.UID?.value ?? `${start.date.toISOString()}-${cur.SUMMARY?.value ?? ""}`,
          start: start.date,
          end: end ? end.date : undefined,
          allDay: start.allDay,
          summary: unescape(cur.SUMMARY?.value ?? ""),
          description: unescape(cur.DESCRIPTION?.value ?? ""),
          location: unescape(cur.LOCATION?.value ?? ""),
          cancelled: (cur.STATUS?.value ?? "").toUpperCase() === "CANCELLED",
        });
      }
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const head = line.slice(0, i);
      const [name, ...params] = head.split(";");
      if (!cur[name]) cur[name] = { value: line.slice(i + 1), params: params.join(";") };
    }
  }
  return out;
}

const cache = new Map<string, { at: number; events: IcsEvent[] }>();

/** Fetches an agent's Google Calendar feed (cached for 5 minutes). */
export async function fetchIcs(url: string, fallbackTz: string): Promise<IcsEvent[]> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.events;
  const u = new URL(url.replace(/^webcal:/i, "https:"));
  if (u.protocol !== "https:") throw new Error("Calendar address must start with https://");
  const res = await fetch(u, { cache: "no-store", headers: { Accept: "text/calendar" } });
  if (!res.ok) throw new Error(`Calendar feed returned ${res.status}`);
  const events = parseIcs(await res.text(), fallbackTz);
  cache.set(url, { at: Date.now(), events });
  return events;
}
