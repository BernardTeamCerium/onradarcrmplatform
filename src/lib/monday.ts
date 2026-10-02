import "server-only";
import { deleteJson, readJson, writeJson } from "./store";
import type { Client, MondayColumn, MondayConfig, MondayItem, MondaySnapshot } from "./types";

const API = () => process.env.MONDAY_API_URL || "https://api.monday.com/v2";
const key = (clientId: string) => `monday/${clientId}.json`;
const PAGE = 500;
const MAX_PAGES = 40;

async function gql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(API(), {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new Error("Monday.com rejected the API token. Copy it again from your avatar → Developers → My access tokens.");
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[]; error_message?: string } | null;
  if (!res.ok || !body || body.errors?.length || body.error_message) {
    throw new Error(`Monday.com: ${body?.errors?.[0]?.message ?? body?.error_message ?? `request failed (${res.status})`}`);
  }
  return body.data as T;
}

/** Accepts a board link (https://acme.monday.com/boards/1234567890/views/…) or the bare board ID. */
export function boardIdFrom(input: string) {
  const s = input.trim();
  return s.match(/boards\/(\d+)/)?.[1] ?? s.replace(/\D/g, "");
}

interface RawItem {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  group?: { title?: string };
  column_values: { id: string; text?: string | null }[];
}
const ITEM_FIELDS = "id name created_at updated_at group { title } column_values { id text }";
const toItem = (r: RawItem): MondayItem => ({
  id: r.id,
  name: r.name,
  group: r.group?.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  values: Object.fromEntries(r.column_values.filter((c) => c.text).map((c) => [c.id, String(c.text)])),
});

/** Stage labels in the order they appear on the board (falls back to label index order). */
function stageOrder(settings: string | undefined) {
  try {
    const s = JSON.parse(settings ?? "{}") as { labels?: Record<string, string>; labels_positions_v2?: Record<string, number> };
    const labels = Object.entries(s.labels ?? {}).filter(([, l]) => l && l.trim());
    const pos = s.labels_positions_v2 ?? {};
    return labels.sort(([a], [b]) => (pos[a] ?? Number(a)) - (pos[b] ?? Number(b))).map(([, l]) => l.trim());
  } catch {
    return [];
  }
}

/** Reads the whole board: columns, stage labels and every item (500 per page). */
export async function fetchBoard(token: string, boardId: string, stageColumn?: string): Promise<MondaySnapshot> {
  const first = await gql<{
    me?: { account?: { slug?: string } };
    boards: { name: string; columns: (MondayColumn & { settings_str?: string })[]; items_page: { cursor: string | null; items: RawItem[] } }[];
  }>(
    token,
    `query ($ids: [ID!]) { me { account { slug } } boards(ids: $ids) { name columns { id title type settings_str } items_page(limit: ${PAGE}) { cursor items { ${ITEM_FIELDS} } } } }`,
    { ids: [boardId] },
  );
  const board = first.boards?.[0];
  if (!board) throw new Error("Board not found. Check the board link, and that the token's user can see the board.");
  const items = board.items_page.items.map(toItem);
  let cursor = board.items_page.cursor;
  for (let page = 1; cursor && page < MAX_PAGES; page++) {
    const next = await gql<{ next_items_page: { cursor: string | null; items: RawItem[] } }>(
      token,
      `query ($cursor: String!) { next_items_page(limit: ${PAGE}, cursor: $cursor) { cursor items { ${ITEM_FIELDS} } } }`,
      { cursor },
    );
    items.push(...next.next_items_page.items.map(toItem));
    cursor = next.next_items_page.cursor;
  }
  const columns = board.columns.map(({ id, title, type }) => ({ id, title, type }));
  const stageCol = board.columns.find((c) => c.id === (stageColumn ?? autoMap(columns).stage));
  return {
    syncedAt: new Date().toISOString(),
    boardId,
    boardName: board.name,
    accountSlug: first.me?.account?.slug,
    columns,
    stages: stageOrder(stageCol?.settings_str),
    items,
  };
}

// ---------------------------------------------------------------------------
// Column mapping

const pick = (cols: MondayColumn[], types: string[], ...patterns: RegExp[]) => {
  const typed = cols.filter((c) => types.includes(c.type));
  for (const re of patterns) {
    const hit = typed.find((c) => re.test(c.title));
    if (hit) return hit.id;
  }
  return undefined;
};

/** Guesses the columns from the Monday sales CRM template's titles and types. */
export function autoMap(cols: MondayColumn[]): MondayConfig["columns"] {
  const numbers = ["numbers", "numeric"];
  return {
    stage: pick(cols, ["status", "color"], /deal stage/i, /stage/i, /status/i, /./),
    value: pick(cols, numbers, /^deal value$/i, /deal (size|value)/i, /^(value|premium|amount)$/i, /premium|value|amount/i),
    actual: pick(cols, numbers, /actual/i),
    owner: pick(cols, ["people", "multiple-person", "person"], /owner/i, /rep|agent|advisor|sales/i, /./),
    closeDate: pick(cols, ["date"], /^close date$/i, /actual close|closed|close/i, /date/i),
    source: pick(cols, ["status", "color", "dropdown", "text", "long_text"], /source/i),
    product: pick(cols, ["status", "color", "dropdown", "text"], /product|carrier|plan/i),
  };
}

export const DEFAULT_WON = /^(paid|won|closed won|sold|placed|in force)$/i;
export const DEFAULT_LOST = /cancel|lost|no.?show|declin|dead|withdr|not interested|not taken|chargeback/i;

export function defaultStages(stages: string[]) {
  return {
    wonStages: stages.filter((s) => DEFAULT_WON.test(s)),
    lostStages: stages.filter((s) => !DEFAULT_WON.test(s) && DEFAULT_LOST.test(s)),
  };
}

// ---------------------------------------------------------------------------
// Storage

export const loadSnapshot = (clientId: string) => readJson<MondaySnapshot>(key(clientId));
export const saveSnapshot = (clientId: string, snap: MondaySnapshot) => writeJson(key(clientId), snap);
export const deleteSnapshot = (clientId: string) => deleteJson(key(clientId));

const STALE_MS = 30 * 60_000;

/** The saved board, refreshed from Monday when it's over 30 minutes old (falls back to the saved copy on error). */
export async function getSnapshot(client: Client): Promise<{ snap: MondaySnapshot | null; warning?: string }> {
  const cfg = client.monday;
  const snap = await loadSnapshot(client.id);
  if (!cfg?.token || !cfg.boardId) return { snap };
  if (snap && snap.boardId === cfg.boardId && Date.now() - Date.parse(snap.syncedAt) < STALE_MS) return { snap };
  try {
    const fresh = await fetchBoard(cfg.token, cfg.boardId, cfg.columns.stage);
    await saveSnapshot(client.id, fresh);
    return { snap: fresh };
  } catch (err) {
    console.error(`Monday sync failed for ${client.id}:`, err);
    return { snap, warning: `Couldn't refresh from Monday.com${snap ? ", so the last synced copy is shown" : ""}: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Pipeline numbers

export type DealOutcome = "open" | "won" | "lost";

export interface Deal {
  id: string;
  name: string;
  group?: string;
  stage: string;
  outcome: DealOutcome;
  owners: string[];
  value: number;
  /** Won amount: the actual value when the board has one, else the deal value. */
  wonValue: number;
  closeDate?: string;
  createdAt?: string;
  source?: string;
  product?: string;
  url?: string;
}

const num = (s?: string) => {
  const n = Number((s ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function toDeals(snap: MondaySnapshot, cfg: MondayConfig): Deal[] {
  const c = cfg.columns;
  const won = new Set(cfg.wonStages.map((s) => s.toLowerCase()));
  const lost = new Set(cfg.lostStages.map((s) => s.toLowerCase()));
  return snap.items.map((it) => {
    const stage = (c.stage && it.values[c.stage]?.trim()) || "No stage";
    const outcome: DealOutcome = won.has(stage.toLowerCase()) ? "won" : lost.has(stage.toLowerCase()) ? "lost" : "open";
    const value = num(c.value ? it.values[c.value] : undefined);
    const actual = num(c.actual ? it.values[c.actual] : undefined);
    const close = c.closeDate ? it.values[c.closeDate]?.slice(0, 10) : undefined;
    return {
      id: it.id,
      name: it.name,
      group: it.group,
      stage,
      outcome,
      owners: (c.owner ? it.values[c.owner] ?? "" : "").split(",").map((s) => s.trim()).filter(Boolean),
      value,
      wonValue: actual > 0 ? actual : value,
      closeDate: close && /^\d{4}-\d{2}-\d{2}$/.test(close) ? close : undefined,
      createdAt: it.createdAt,
      source: c.source ? it.values[c.source] : undefined,
      product: c.product ? it.values[c.product] : undefined,
      url: snap.accountSlug ? `https://${snap.accountSlug}.monday.com/boards/${snap.boardId}/pulses/${it.id}` : undefined,
    };
  });
}

export interface RepRow {
  rep: string;
  deals: number;
  open: number;
  openValue: number;
  won: number;
  wonValue: number;
  lost: number;
}

export interface PipelineSummary {
  deals: number;
  open: { count: number; value: number };
  won: { count: number; value: number; average: number | null };
  lost: { count: number; value: number };
  winRate: number | null;
  avgDaysToClose: number | null;
  byStage: { stage: string; outcome: DealOutcome; count: number; value: number }[];
  byRep: RepRow[];
  /** Won value by month (YYYY-MM) using the close date, or the last update when there's none. */
  wonByMonth: { month: string; value: number; count: number }[];
}

export function summarise(deals: Deal[], stageOrder: string[]): PipelineSummary {
  const sum = (ds: Deal[], f: (d: Deal) => number) => ds.reduce((a, d) => a + f(d), 0);
  const open = deals.filter((d) => d.outcome === "open");
  const won = deals.filter((d) => d.outcome === "won");
  const lost = deals.filter((d) => d.outcome === "lost");

  const stages = new Map<string, { stage: string; outcome: DealOutcome; count: number; value: number }>();
  for (const d of deals) {
    const s = stages.get(d.stage) ?? { stage: d.stage, outcome: d.outcome, count: 0, value: 0 };
    s.count++;
    s.value += d.outcome === "won" ? d.wonValue : d.value;
    stages.set(d.stage, s);
  }
  const order = (s: string) => {
    const i = stageOrder.findIndex((x) => x.toLowerCase() === s.toLowerCase());
    return i < 0 ? 999 : i;
  };

  // A deal with two owners counts as a deal for each, and its value is split between them so rep totals add up.
  const reps = new Map<string, RepRow>();
  for (const d of deals) {
    const owners = d.owners.length ? d.owners : ["Unassigned"];
    for (const o of owners) {
      const r = reps.get(o) ?? { rep: o, deals: 0, open: 0, openValue: 0, won: 0, wonValue: 0, lost: 0 };
      r.deals++;
      if (d.outcome === "open") {
        r.open++;
        r.openValue += d.value / owners.length;
      } else if (d.outcome === "won") {
        r.won++;
        r.wonValue += d.wonValue / owners.length;
      } else r.lost++;
      reps.set(o, r);
    }
  }

  const months = new Map<string, { month: string; value: number; count: number }>();
  for (const d of won) {
    const m = (d.closeDate ?? d.createdAt ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    const x = months.get(m) ?? { month: m, value: 0, count: 0 };
    x.value += d.wonValue;
    x.count++;
    months.set(m, x);
  }

  const cycle = won
    .filter((d) => d.closeDate && d.createdAt)
    .map((d) => (Date.parse(`${d.closeDate}T12:00:00Z`) - Date.parse(d.createdAt!)) / 86_400_000)
    .filter((n) => n >= 0);

  return {
    deals: deals.length,
    open: { count: open.length, value: sum(open, (d) => d.value) },
    won: { count: won.length, value: sum(won, (d) => d.wonValue), average: won.length ? sum(won, (d) => d.wonValue) / won.length : null },
    lost: { count: lost.length, value: sum(lost, (d) => d.value) },
    winRate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
    avgDaysToClose: cycle.length ? cycle.reduce((a, b) => a + b, 0) / cycle.length : null,
    byStage: [...stages.values()].sort((a, b) => order(a.stage) - order(b.stage) || b.count - a.count),
    byRep: [...reps.values()].sort((a, b) => b.wonValue + b.openValue - (a.wonValue + a.openValue)),
    wonByMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}
