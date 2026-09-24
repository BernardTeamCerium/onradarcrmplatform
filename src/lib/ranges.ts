export const RANGE_PRESETS = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "mtd", label: "Month to date" },
  { key: "lastmonth", label: "Last month" },
  { key: "ytd", label: "Year to date" },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];

export interface DateRange {
  key: RangeKey;
  label: string;
  /** Inclusive start, midnight UTC. */
  start: Date;
  /** Exclusive end, midnight UTC. */
  end: Date;
  days: number;
}

const DAY = 86_400_000;

function utcMidnight(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function resolveRange(key: string | undefined, now = new Date()): DateRange {
  const preset = RANGE_PRESETS.find((p) => p.key === key) ?? RANGE_PRESETS[3]; // default: month to date
  const tomorrow = new Date(utcMidnight(now).getTime() + DAY);
  let start: Date;
  let end = tomorrow;
  switch (preset.key) {
    case "7d":
      start = new Date(tomorrow.getTime() - 7 * DAY);
      break;
    case "90d":
      start = new Date(tomorrow.getTime() - 90 * DAY);
      break;
    case "mtd":
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      break;
    case "lastmonth":
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      break;
    case "ytd":
      start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      break;
    default:
      start = new Date(tomorrow.getTime() - 30 * DAY);
  }
  return { key: preset.key, label: preset.label, start, end, days: Math.round((end.getTime() - start.getTime()) / DAY) };
}

/** The equally long window immediately before `range`, used for period-over-period deltas. */
export function previousRange(range: DateRange): DateRange {
  const len = range.end.getTime() - range.start.getTime();
  return { ...range, start: new Date(range.start.getTime() - len), end: new Date(range.start) };
}

export function eachDay(range: Pick<DateRange, "start" | "end">): string[] {
  const out: string[] = [];
  for (let t = range.start.getTime(); t < range.end.getTime(); t += DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function dayKey(value: string | number | Date) {
  return new Date(value).toISOString().slice(0, 10);
}
