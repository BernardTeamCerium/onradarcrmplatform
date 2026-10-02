import { CASE_HEADERS, TOTAL_HEADERS, toCsv } from "@/lib/production";

/** Blank CSV templates (with one example row) for importing historical production. */
export function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind") === "totals" ? "totals" : "cases";
  const csv =
    kind === "totals"
      ? toCsv([TOTAL_HEADERS, ["2025-03", "Troy Sibley", "1250000", "980000", "45000", "7"], ["2024", "Troy Sibley", "16800000", "12700000", "1150000", "92"]])
      : toCsv([CASE_HEADERS, ["2025-03-14", "Jane Example", "Troy Sibley", "Carrier name", "Fixed indexed annuity", "250000", "Paid", "2025-04-02", "", "", "TV", ""]]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="production-${kind}-template.csv"`,
    },
  });
}
