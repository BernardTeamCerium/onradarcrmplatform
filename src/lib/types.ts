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
  /** Used for estimated revenue when won opportunities carry no monetary value. */
  averageDealValue: number;
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
  appointments: number;
  conversations: number;
  leads: number;
  costPerLead: number | null;
  costPerAppointment: number | null;
  sales: number;
  salesConversion: number | null;
  applicants: number;
  estimatedRevenue: number;
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
