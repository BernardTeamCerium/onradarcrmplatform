import type { Client, ProductionEntry } from "./types";

/** Pending-business stages, matching how Sibley's team tracks a case from application to funded. */
export const DEFAULT_STAGES = [
  "Submitted",
  "In Review",
  "Suit Req",
  "Final Review",
  "AOF",
  "Needs Attention",
  "Transfer Out",
  "Transfer Out NIGO",
  "Awaiting Transfer",
  "Funds En Route",
];

/** A case sitting in one stage this long is flagged as stuck. */
export const STUCK_DAYS = 14;

export const stagesFor = (client: Client) => (client.pipelineStages?.length ? client.pipelineStages : DEFAULT_STAGES);

// Most specific first: "Transfer Out NIGO" before "Transfer Out", "Funds En Route" before "Transfer".
const KEYWORDS: [RegExp, string][] = [
  [/funds?\s+en\s+route|check\s+mailed|funds\s+sent|wire\s+sent/i, "Funds En Route"],
  [/awaiting\s+(transfer|funds)|pending\s+transfer/i, "Awaiting Transfer"],
  [/nigo|not\s+in\s+good\s+order/i, "Transfer Out NIGO"],
  [/transfer|rollover|1035|exchange/i, "Transfer Out"],
  [/\baof\b|awaiting\s+(original|signature)|signature/i, "AOF"],
  [/suit(ability)?\s*(req|review)?|suit\b/i, "Suit Req"],
  [/final\s+review/i, "Final Review"],
  [/requirement|needs\s+attention|outstanding|missing|incomplete|pending\s+info/i, "Needs Attention"],
  [/in\s+review|new\s+business|received|submitted|processing|under\s+review/i, "In Review"],
];

/** Picks a stage from a carrier/IMO status line: an exact stage name wins, then the built-in keywords. */
export function stageFromStatus(status: string | undefined, stages: string[]) {
  if (!status) return undefined;
  const s = status.toLowerCase();
  const named = [...stages].sort((a, b) => b.length - a.length).find((st) => s.includes(st.toLowerCase()));
  if (named) return named;
  for (const [re, stage] of KEYWORDS) {
    if (!re.test(status)) continue;
    // Map onto the client's own list when they've renamed stages; skip keywords for stages they don't use.
    const hit = stages.find((st) => st.toLowerCase() === stage.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

/** The stage a case shows in: its saved stage if that's still on the list, otherwise the first stage. */
export function stageOf(e: ProductionEntry, stages: string[]) {
  return e.stage && stages.includes(e.stage) ? e.stage : stages[0];
}

/** Pending = a logged case that hasn't been paid, declined or charged back. */
export const isPending = (e: ProductionEntry) => e.kind === "case" && (e.status ?? "Submitted") === "Submitted";
