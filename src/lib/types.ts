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
