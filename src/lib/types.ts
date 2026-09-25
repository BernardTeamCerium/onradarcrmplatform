export type Role = "admin" | "client";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  /** Client account this user belongs to (client users only). */
  clientId?: string;
  createdAt: string;
}

export interface SpendEntry {
  id: string;
  /** Month the spend applies to, formatted YYYY-MM. Spread evenly across the month's days. */
  month: string;
  amount: number;
  note?: string;
  /** Marketing source this spend belongs to (one of the client's sources). Blank = unassigned. */
  source?: string;
}

export interface MarketingSource {
  name: string;
  /** Lower-case keywords matched against the CRM's lead source, e.g. ["facebook", "fb", "instagram"]. */
  match: string[];
}

/** Funnel counts for any slice of the data (a source, a place, or a source within a place). */
export interface Counts {
  spend: number;
  leads: number;
  conversations: number;
  apptsSet: number;
  connected: number;
  applicants: number;
  sales: number;
  premium: number;
  /** Sum of days from lead to application across these applications (÷ applicants = average). */
  cycleDaysSum: number;
}

/** One marketing source's results for a date range. */
export interface SourceRow extends Counts {
  source: string;
}

/** One source's results within one city. */
export interface GeoCell extends Counts {
  state: string;
  city: string;
  source: string;
}

export interface MonthlyFigures {
  id: string;
  /** YYYY-MM */
  month: string;
  /** Connected appointments for the month. */
  appointments?: number;
  /** Appointments set (booked) for the month. */
  apptsSet?: number;
  /** Premium submitted in the month ($). */
  premium?: number;
}

export interface YearRecord {
  year: number;
  submitted: number;
  paid: number;
  chargebacks: number;
  apptsSet: number;
  connectedAppts: number;
  targetSubmitted?: number;
  targetPaid?: number;
  /** Maximum acceptable chargebacks for the year (lower is better). */
  targetChargebacks?: number;
  targetApptsSet?: number;
  targetConnectedAppts?: number;
}

export interface GhlSettings {
  /** GoHighLevel sub-account (location) ID. */
  locationId: string;
  /** Private Integration token for the sub-account. Never sent to the browser. */
  apiToken: string;
  /**
   * Pipeline stage names containing any of these words mark the "application submitted" stage.
   * Opportunities at that stage or any later stage (or marked won) count as applicants.
   */
  applicationStageKeywords: string[];
}

export interface Client {
  id: string;
  name: string;
  slug: string;
  industry?: string;
  /** Hex brand color used for accents on this client's dashboard. */
  brandColor: string;
  /** Uploaded logo file name inside DATA_DIR/logos, a /public path, or an absolute https URL. */
  logo?: string;
  ghl: GhlSettings;
  spend: SpendEntry[];
  /** Used for submitted premium when an application's opportunity carries no monetary value. */
  averagePremium: number;
  /** Agent credited with submitted premium on the dashboard, e.g. "Troy Sibley". */
  primaryAgent?: string;
  /** Shared secret used to verify Typeform webhook signatures for this client. */
  typeformSecret: string;
  /** Marketing sources shown on the Marketing tab, in display order. */
  sources: MarketingSource[];
  /** Yearly production, appointment totals and targets shown on the Trends tab. */
  yearly: YearRecord[];
  /** Figures entered by hand for a month. They replace sample data for that month. */
  figures: MonthlyFigures[];
  /** When true (or when no API token is set), the dashboard shows generated sample data. */
  demoMode: boolean;
  createdAt: string;
}

export interface Database {
  users: User[];
  clients: Client[];
}

export interface Metrics {
  spend: number;
  apptsSet: number;
  appointments: number;
  /** Connected appointments ÷ appointments set. */
  connectRate: number | null;
  /** Connected appointments ÷ leads: share of leads who reached a connected appointment. */
  connectedPct: number | null;
  conversations: number;
  leads: number;
  costPerLead: number | null;
  costPerAppointment: number | null;
  sales: number;
  salesConversion: number | null;
  applicants: number;
  /** Premium submitted on applications in the period ($). */
  premium: number;
  /** Sum of lead-to-application days over the period's applications. */
  cycleDaysSum: number;
  /** Average days from a lead coming in to their application being submitted. */
  cycleDays: number | null;
  estimatedReturn: number | null;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  leads: number;
  appointments: number;
  spend: number;
}

export interface DashboardData {
  metrics: Metrics;
  previous: Metrics;
  daily: DailyPoint[];
  /** Current-range results split by marketing source (rows add up to `metrics`). */
  bySource: SourceRow[];
  /** Current-range results split by city and source (cells add up to `bySource`). */
  byGeo: GeoCell[];
  source: "ghl" | "demo";
  fetchedAt: string;
  warnings: string[];
}

export const LEAD_STATUSES = [
  "New",
  "Contacted",
  "Appointment set",
  "Appointment held",
  "No show",
  "Application submitted",
  "Sold",
  "Not interested",
  "Bad contact info",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface QuizAnswer {
  question: string;
  answer: string;
}

export interface Lead {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  /** Where the lead came from, e.g. the Typeform quiz title. */
  source: string;
  status: LeadStatus;
  statusUpdatedAt: string;
  receivedAt: string;
  answers: QuizAnswer[];
  /** Typeform response token, used to ignore duplicate webhook deliveries. */
  externalId?: string;
  test?: boolean;
}

/** Outreach activity ("the engine"): texts, emails and calls. */
export interface EngineTotals {
  smsOut: number;
  smsIn: number;
  emailOut: number;
  emailIn: number;
  callsOut: number;
  callsAnswered: number;
  callsIn: number;
}

export interface EngineDay {
  date: string;
  sms: number;
  email: number;
  calls: number;
}

export interface EngineSource {
  source: string;
  conversations: number;
  apptsSet: number;
  smsOut: number;
  emailOut: number;
  callsOut: number;
  replies: number;
}

export interface EngineData {
  totals: EngineTotals;
  daily: EngineDay[];
  bySource: EngineSource[];
  conversations: number;
  apptsSet: number;
  /** Conversations with a message in the last 24 hours. */
  activeNow: number;
  /** Today's outbound activity. `fullDay` (sample data) is spread across the day as it runs. */
  today: { sms: number; email: number; calls: number; fullDay: boolean };
  source: "ghl" | "demo";
  fetchedAt: string;
  warnings: string[];
}
