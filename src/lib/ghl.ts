import "server-only";

/**
 * Thin client for the GoHighLevel (LeadConnector) API v2.
 * Auth uses a sub-account Private Integration token, created in GoHighLevel under
 * Settings → Private Integrations with these read scopes:
 *   contacts.readonly, conversations.readonly, opportunities.readonly,
 *   calendars.readonly, calendars/events.readonly, locations.readonly
 */
const BASE_URL = "https://services.leadconnectorhq.com";

export class GhlError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export interface GhlCredentials {
  locationId: string;
  apiToken: string;
}

async function request<T>(
  creds: GhlCredentials,
  path: string,
  opts: { version: string; query?: Record<string, string | number | undefined>; body?: unknown },
): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: opts.body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        Version: opts.version,
        Accept: "application/json",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GhlError(`CRM request ${path} failed (${res.status}): ${text.slice(0, 200)}`, res.status);
    }
    return (await res.json()) as T;
  }
  throw new GhlError(`CRM request ${path} was rate limited`, 429);
}

export interface GhlLocation {
  id: string;
  name: string;
}

export async function getLocation(creds: GhlCredentials) {
  const data = await request<{ location: GhlLocation }>(creds, `/locations/${creds.locationId}`, {
    version: "2021-07-28",
  });
  return data.location;
}

interface ContactSearchResponse {
  contacts: { id: string; dateAdded: string }[];
  total: number;
}

/** Contacts created in [start, end). Returns the total plus creation dates (capped) for the daily trend. */
export async function contactsCreated(
  creds: GhlCredentials,
  start: Date,
  end: Date,
  opts: { withDates: boolean; maxPages?: number } = { withDates: true },
) {
  const pageLimit = opts.withDates ? 100 : 1;
  const maxPages = opts.withDates ? (opts.maxPages ?? 50) : 1;
  const dates: string[] = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const data = await request<ContactSearchResponse>(creds, "/contacts/search", {
      version: "2021-07-28",
      body: {
        locationId: creds.locationId,
        page,
        pageLimit,
        filters: [
          {
            field: "dateAdded",
            operator: "range",
            value: { gte: start.toISOString(), lte: new Date(end.getTime() - 1).toISOString() },
          },
        ],
        sort: [{ field: "dateAdded", direction: "desc" }],
      },
    });
    total = data.total ?? total;
    for (const c of data.contacts ?? []) {
      const t = new Date(c.dateAdded).getTime();
      if (t >= start.getTime() && t < end.getTime()) dates.push(c.dateAdded);
    }
    if (!opts.withDates || (data.contacts ?? []).length < pageLimit) break;
  }
  return { total: Math.max(total, dates.length), dates };
}

/** Conversations started (dateAdded) in [start, end). */
export async function conversationsStarted(creds: GhlCredentials, start: Date, end: Date) {
  const data = await request<{ total: number }>(creds, "/conversations/search", {
    version: "2021-04-15",
    query: {
      locationId: creds.locationId,
      startDate: start.getTime(),
      endDate: end.getTime() - 1,
      limit: 1,
    },
  });
  return data.total ?? 0;
}

interface GhlCalendar {
  id: string;
  name: string;
}

interface GhlEvent {
  id: string;
  startTime: string;
  appointmentStatus?: string;
}

const EXCLUDED_APPOINTMENT_STATUSES = new Set(["cancelled", "invalid", "noshow"]);

/**
 * Appointment start times across every calendar in the sub-account.
 * `set` is every booking except invalid ones; `connected` also excludes cancelled and no-show.
 */
export async function appointments(creds: GhlCredentials, start: Date, end: Date) {
  const { calendars } = await request<{ calendars: GhlCalendar[] }>(creds, "/calendars/", {
    version: "2021-04-15",
    query: { locationId: creds.locationId },
  });
  const seen = new Set<string>();
  const set: string[] = [];
  const connected: string[] = [];
  for (const cal of calendars ?? []) {
    const { events } = await request<{ events: GhlEvent[] }>(creds, "/calendars/events", {
      version: "2021-04-15",
      query: {
        locationId: creds.locationId,
        calendarId: cal.id,
        startTime: start.getTime(),
        endTime: end.getTime() - 1,
      },
    });
    for (const ev of events ?? []) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      const status = (ev.appointmentStatus ?? "").toLowerCase();
      if (status === "invalid") continue;
      set.push(ev.startTime);
      if (!EXCLUDED_APPOINTMENT_STATUSES.has(status)) connected.push(ev.startTime);
    }
  }
  return { set, connected };
}

export interface GhlPipeline {
  id: string;
  name: string;
  stages: { id: string; name: string; position?: number }[];
}

export async function pipelines(creds: GhlCredentials) {
  const data = await request<{ pipelines: GhlPipeline[] }>(creds, "/opportunities/pipelines", {
    version: "2021-07-28",
    query: { locationId: creds.locationId },
  });
  return data.pipelines ?? [];
}

export interface GhlOpportunity {
  id: string;
  monetaryValue?: number;
  pipelineId: string;
  pipelineStageId: string;
  status: "open" | "won" | "lost" | "abandoned";
  createdAt: string;
  updatedAt?: string;
  lastStatusChangeAt?: string;
  lastStageChangeAt?: string;
}

/** Opportunities created on or after `since` (newest first), capped at `maxPages` × 100. */
export async function opportunitiesSince(creds: GhlCredentials, since: Date, maxPages = 30) {
  const out: GhlOpportunity[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await request<{ opportunities: GhlOpportunity[]; meta?: { nextPage?: number | null } }>(
      creds,
      "/opportunities/search",
      {
        version: "2021-07-28",
        query: { location_id: creds.locationId, status: "all", order: "added_desc", limit: 100, page },
      },
    );
    const batch = data.opportunities ?? [];
    out.push(...batch);
    const oldest = batch.at(-1);
    if (batch.length < 100 || !data.meta?.nextPage) break;
    // Opportunities that change status later can have been created well before the window,
    // so look back up to a year before stopping.
    if (oldest && new Date(oldest.createdAt).getTime() < since.getTime() - 365 * 86_400_000) break;
  }
  return out;
}
