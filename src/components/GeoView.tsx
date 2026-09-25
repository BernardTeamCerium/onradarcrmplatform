import { getDashboardData } from "@/lib/metrics";
import { shortDate } from "@/lib/format";
import type { DateRange } from "@/lib/ranges";
import type { Client } from "@/lib/types";
import { GeoExplorer } from "./GeoExplorer";
import { RangePicker } from "./RangePicker";

export async function GeoView({ client, range, basePath }: { client: Client; range: DateRange; basePath: string }) {
  const data = await getDashboardData(client, range);
  const lastDay = new Date(range.end.getTime() - 86_400_000).toISOString().slice(0, 10);
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <RangePicker basePath={basePath} active={range.key} />
        <span className="muted small">
          {shortDate(range.start.toISOString().slice(0, 10))} – {shortDate(lastDay)} · {data.source === "ghl" ? "Live from OnRadar CRM" : "Sample data"}
        </span>
      </div>
      <GeoExplorer cells={data.byGeo} sourceOrder={client.sources.map((s) => s.name)} />
      <p className="muted small">
        {data.source === "ghl"
          ? "Places come from each lead's city and state in the CRM; appointments, applications and sales follow the lead they belong to. Leads without a city or state are grouped as Unknown."
          : "Sample data centred on Sibley's market until your OnRadar CRM account is connected."}{" "}
        Marketing spend isn&apos;t tracked by place, so each source&apos;s spend is shared across places in proportion to the leads it produced there.
      </p>
    </div>
  );
}
