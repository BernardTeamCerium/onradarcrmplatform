import type { Client } from "./types";

/** Client tabs an admin can hide from the client's own logins (Overview always shows). */
export const HIDEABLE_TABS = [
  { key: "reports", label: "Reports" },
  { key: "engine", label: "Engine" },
  { key: "calendar", label: "Calendar" },
  { key: "leads", label: "Leads" },
  { key: "production", label: "Production" },
  { key: "pipeline", label: "Pipeline" },
  { key: "trends", label: "Trends" },
] as const;

export const tabHidden = (client: Client, key: string) => !!client.hiddenTabs?.includes(key);
