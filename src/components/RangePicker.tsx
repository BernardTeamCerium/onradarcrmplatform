import Link from "next/link";
import { RANGE_PRESETS, type RangeKey } from "@/lib/ranges";

export function RangePicker({ basePath, active }: { basePath: string; active: RangeKey }) {
  return (
    <nav className="segmented" aria-label="Date range">
      {RANGE_PRESETS.map((p) => (
        <Link key={p.key} href={`${basePath}?range=${p.key}`} aria-current={p.key === active ? "true" : undefined} scroll={false}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
