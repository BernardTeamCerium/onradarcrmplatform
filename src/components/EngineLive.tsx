"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Share of a day's outreach done by this time: mostly 7am–8pm, with a trickle of overnight automation. */
function dayProgress(d: Date) {
  const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  const business = Math.min(1, Math.max(0, (h - 7) / 13));
  return 0.1 * (h / 24) + 0.9 * business;
}

export function EngineLive({
  today,
  activeNow,
  refreshMs = 30_000,
}: {
  today: { sms: number; email: number; calls: number; fullDay: boolean };
  activeNow: number;
  refreshMs?: number;
}) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 1000);
    const refresh = setInterval(() => router.refresh(), refreshMs);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router, refreshMs]);

  // Sample data gives the whole day's plan, so count it up as the day goes by; live data is already "so far".
  const f = today.fullDay ? (now ? dayProgress(now) : 0) : 1;
  const v = (n: number) => Math.floor(n * f).toLocaleString();
  const items = [
    { label: "Texts sent today", value: v(today.sms) },
    { label: "Emails sent today", value: v(today.email) },
    { label: "Calls made today", value: v(today.calls) },
    { label: "Active conversations", value: activeNow.toLocaleString(), note: "last 24 hours" },
  ];
  return (
    <section className="engine-live" aria-label="Activity today">
      <div className="engine-live-head">
        <span className="badge engine-badge">
          <span className="dot live-dot" style={{ background: "var(--green)" }} />
          Engine running
        </span>
        <span className="small" style={{ opacity: 0.75 }}>
          {now ? `Today so far · ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Today so far"}
        </span>
      </div>
      <div className="engine-live-grid">
        {items.map((it) => (
          <div key={it.label}>
            <div className="engine-num" aria-live="off">{it.value}</div>
            <div className="small" style={{ opacity: 0.8 }}>
              {it.label}
              {it.note ? <span style={{ opacity: 0.7 }}> · {it.note}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
