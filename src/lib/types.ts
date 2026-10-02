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
  /** Typeform API access for importing past responses. */
  typeformApi?: { token: string; formIds: string[]; region: "us" | "eu"; lastImportAt?: string; lastResult?: string };
  /** Key that lets the Gmail script and other tools post leads for this client. */
  inboundKey: string;
  /** Agents whose calendars show on the Calendar tab. */
  agents: Agent[];
  /** IANA time zone for the client's calendar, e.g. America/Chicago. */
  timeZone: string;
  /** Show generated sample appointments on the Calendar (turn off once real calendars are connected). */
  calendarSamples?: boolean;
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
  /** ghl = live CRM, own = live from OnRadar's own records (Leads tab, spend, production), demo = sample data. */
  source: "ghl" | "own" | "demo";
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
  city?: string;
  state?: string;
  /** Where the lead came from, e.g. the Typeform quiz title, "Lead Seller #1" or "Email". */
  source: string;
  status: LeadStatus;
  statusUpdatedAt: string;
  receivedAt: string;
  answers: QuizAnswer[];
  /** How the lead arrived. */
  channel?: "typeform" | "email" | "api" | "manual";
  /** Typeform response token or email Message-ID, used to ignore duplicate deliveries. */
  externalId?: string;
  test?: boolean;
  /** Fictional lead seeded for demos (removed by Go live). */
  sample?: boolean;
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
  /** ghl = live CRM, own = live from OnRadar's own records (Leads tab, spend, production), demo = sample data. */
  source: "ghl" | "own" | "demo";
  fetchedAt: string;
  warnings: string[];
}

export interface Agent {
  id: string;
  name: string;
  /** The agent's user ID in the CRM, used to match live calendar appointments. */
  crmUserId?: string;
  /** Google Calendar "secret address in iCal format"; the agent's events show on the Calendar tab. */
  googleIcsUrl?: string;
}

/** An appointment booked from the Leads tab. */
export interface BookedAppt {
  id: string;
  leadId: string;
  agentId: string;
  date: string;
  time: string;
  minutes: number;
  apptType?: ApptType;
  status: ApptStatus;
  notes?: string;
  createdAt: string;
  createdBy?: string;
}

export type ApptStatus = "Scheduled" | "Confirmed" | "Showed" | "No-show" | "Cancelled";

export interface CalendarAppt {
  id: string;
  agentId: string;
  /** YYYY-MM-DD in the client's time zone. */
  date: string;
  /** HH:MM (24h) in the client's time zone. */
  time: string;
  minutes: number;
  status: ApptStatus;
  name: string;
  age?: string;
  /** Investable assets in dollars (estimate from the quiz). */
  assets: number | null;
  assetsLabel?: string;
  city: string;
  state: string;
  source: string;
  phone?: string;
  email?: string;
  /** Quiz title and answers, for the prospect bio. */
  quiz?: { title: string; answers: QuizAnswer[] };
  /** What the meeting is for (new money, policy review, ...). */
  apptType?: ApptType;
  /** Where the appointment came from. */
  origin?: "sample" | "crm" | "booked" | "google";
  /** Lead this appointment belongs to, if known. */
  leadId?: string;
  /** Fuller background for the agent's prep brief (Word download). */
  profile?: ProspectProfile;
}

export type ApptType =
  | "New money"
  | "Policy review"
  | "Annuity review"
  | "401(k) rollover"
  | "Retirement income plan"
  | "Beneficiary & estate review";

export interface ExistingPolicy {
  product: string;
  issued: string;
  value: string;
  note?: string;
}

export interface ProspectProfile {
  apptType: ApptType;
  existingClient: boolean;
  meetingFormat: string;
  maritalStatus: string;
  spouse?: string;
  employment: string;
  householdIncome: string;
  riskTolerance: string;
  /** New money coming in, if any. */
  newMoney?: { amount: number; source: string; timing: string };
  existingPolicies: ExistingPolicy[];
  goals: string[];
  notes: string[];
  prep: string[];
}

export const CASE_STATUSES = ["Submitted", "Paid", "Chargeback", "Declined"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const PRODUCTS = [
  "Fixed indexed annuity",
  "MYGA",
  "Variable annuity",
  "Income annuity",
  "Whole life",
  "Indexed universal life",
  "Term life",
  "Long-term care",
  "Other",
] as const;

export interface CaseUpdate {
  /** ISO time the update was sent. */
  at: string;
  status: string;
  note?: string;
  from?: string;
  /** Email Message-ID (or a hash), so the same email is never applied twice. */
  ref?: string;
}

/**
 * One line of production: either a single case (kind "case") or a historical total for an agent over a
 * month or year (kind "summary"), used to load history that isn't available case by case.
 */
export interface ProductionEntry {
  id: string;
  kind: "case" | "summary";
  agentName: string;
  agentId?: string;
  // Case fields
  /** Date submitted (YYYY-MM-DD). */
  date?: string;
  clientName?: string;
  carrier?: string;
  product?: string;
  premium?: number;
  status?: CaseStatus;
  paidDate?: string;
  chargebackDate?: string;
  /** Defaults to the full premium. */
  chargebackAmount?: number;
  source?: string;
  notes?: string;
  /** Carrier / IMO case or policy number (e.g. TB00071984); status emails are matched on it. */
  caseNumber?: string;
  /** Latest status wording from the carrier or IMO, e.g. "Transfer - Funds En Route". */
  carrierStatus?: string;
  /** Status updates read from emails, oldest first. */
  updates?: CaseUpdate[];
  // Summary fields
  /** "YYYY" or "YYYY-MM". */
  period?: string;
  submitted?: number;
  paid?: number;
  chargebacks?: number;
  cases?: number;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  sample?: boolean;
}
