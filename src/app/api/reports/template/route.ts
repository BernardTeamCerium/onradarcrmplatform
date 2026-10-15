import { requireUser } from "@/lib/auth";
import { toCsv } from "@/lib/production";
import { TEMPLATE_HEADERS } from "@/lib/sheet";

/** Starter reporting sheet: import into Google Sheets (File → Import) and replace the example rows. */
export async function GET() {
  await requireUser();
  const rows = [
    TEMPLATE_HEADERS,
    ["2026-09", "Troy Sibley", "Facebook", "12000", "120", "70", "22", "16", "6", "4", "1450000", "980000", "0"],
    ["2026-09", "Troy Sibley", "TV", "18000", "95", "60", "20", "15", "7", "5", "1900000", "1300000", "50000"],
    ["2026-10", "Troy Sibley", "Facebook", "11000", "110", "64", "19", "14", "5", "3", "1200000", "", ""],
  ];
  return new Response(toCsv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="onradar-reporting-template.csv"' },
  });
}
