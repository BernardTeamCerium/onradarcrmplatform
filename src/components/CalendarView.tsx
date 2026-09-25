import Link from "next/link";
import { addDays, getCalendarWeek, nowIn, weekStart } from "@/lib/calendar";
import { count, money, moneyShort } from "@/lib/format";
import type { ApptStatus, CalendarAppt, Client } from "@/lib/types";

const STATUS_TONE: Record<ApptStatus, string> = {
  Scheduled: "var(--ink-muted)",
  Confirmed: "var(--series-1)",
  Showed: "var(--good)",
  "No-show": "var(--bad)",
  Cancelled: "var(--bad)",
};

const dayName = (d: string, style: "short" | "long" = "short") =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: style, timeZone: "UTC" });
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const time12 = (t: string) => {
  const h = Number(t.slice(0, 2));
  return `${((h + 11) % 12) + 1}:${t.slice(3, 5)} ${h < 12 ? "AM" : "PM"}`;
};
const active = (a: CalendarAppt) => a.status !== "Cancelled";
const assetsOf = (list: CalendarAppt[]) => list.filter(active).reduce((s, a) => s + (a.assets ?? 0), 0);

export async function CalendarView({
  client,
  basePath,
  search,
}: {
  client: Client;
  basePath: string;
  search: { week?: string; day?: string; agent?: string };
}) {
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
  const today = nowIn(client.timeZone).date;
  const start = weekStart(valid(search.week) ?? valid(search.day) ?? today);
  const week = await getCalendarWeek(client, start);
  const selected = valid(search.day) && week.days.some((d) => d.date === search.day) ? search.day! : week.days.some((d) => d.date === today) ? today : start;
  const agentId = week.agents.some((a) => a.id === search.agent) ? search.agent : undefined;
  const agentName = (id: string) => week.agents.find((a) => a.id === id)?.name ?? "Unassigned";
  const filter = (list: CalendarAppt[]) => (agentId ? list.filter((a) => a.agentId === agentId) : list);
  const href = (p: { week?: string; day?: string; agent?: string | null }) => {
    const q = new URLSearchParams();
    const w = p.week ?? start;
    q.set("week", w);
    if (p.day) q.set("day", p.day);
    const ag = p.agent === null ? undefined : p.agent ?? agentId;
    if (ag) q.set("agent", ag);
    return `${basePath}?${q.toString()}`;
  };

  // Today's preview always shows today, whichever week is on screen.
  const todayWeek = week.days.some((d) => d.date === today) ? week : await getCalendarWeek(client, weekStart(today));
  const todayAll = filter(todayWeek.days.find((d) => d.date === today)?.appts ?? []);
  const nowMin = week.today.minutes;
  const upcoming = todayAll.filter((a) => active(a) && Number(a.time.slice(0, 2)) * 60 + Number(a.time.slice(3)) >= nowMin);
  const next = upcoming[0];

  const dayAppts = filter(week.days.find((d) => d.date === selected)?.appts ?? []);
  const byAgent = week.agents
    .map((a) => ({ agent: a, appts: dayAppts.filter((x) => x.agentId === a.id) }))
    .filter((g) => g.appts.length > 0 || !agentId || g.agent.id === agentId);

  return (
    <div className="stack">
      {/* Today preview */}
      <section className="engine-live" aria-label="Today">
        <div className="engine-live-head">
          <span className="badge engine-badge">
            <span className="dot live-dot" style={{ background: "var(--green)" }} />
            Today · {dayName(today, "long")}, {dayLabel(today)}
          </span>
          <span className="small" style={{ opacity: 0.75 }}>{agentId ? agentName(agentId) : "All agents"} · {week.source === "ghl" ? "Live from OnRadar CRM" : "Sample data"}</span>
        </div>
        <div className="engine-live-grid">
          <div>
            <div className="engine-num">{count(todayAll.filter(active).length)}</div>
            <div className="small" style={{ opacity: 0.8 }}>Appointments today</div>
          </div>
          <div>
            <div className="engine-num">{moneyShort(assetsOf(todayAll))}</div>
            <div className="small" style={{ opacity: 0.8 }}>Projected assets today</div>
          </div>
          <div>
            <div className="engine-num">{count(upcoming.length)}</div>
            <div className="small" style={{ opacity: 0.8 }}>Still to come · {moneyShort(assetsOf(upcoming))} in assets</div>
          </div>
          <div>
            <div className="engine-num" style={{ fontSize: 22, paddingTop: 8 }}>{next ? `${time12(next.time)} · ${next.name}` : "Done for today"}</div>
            <div className="small" style={{ opacity: 0.8 }}>{next ? `Next up with ${agentName(next.agentId)}` : "No more appointments"}</div>
          </div>
        </div>
        {!agentId && week.agents.length > 1 && (
          <div className="today-agents">
            {week.agents.map((a) => {
              const mine = todayAll.filter((x) => x.agentId === a.id && active(x));
              return (
                <span key={a.id}>
                  <b>{a.name}</b> {mine.length} appt{mine.length === 1 ? "" : "s"} · {moneyShort(assetsOf(mine))}
                </span>
              );
            })}
          </div>
        )}
      </section>

      {week.warnings.map((w) => (
        <p key={w} className="notice">{w}</p>
      ))}

      {/* Controls */}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <nav className="chips" aria-label="Agent">
          <Link className={!agentId ? "chip on" : "chip"} href={href({ day: selected, agent: null })}>All agents</Link>
          {week.agents.map((a) => (
            <Link key={a.id} className={agentId === a.id ? "chip on" : "chip"} href={href({ day: selected, agent: a.id })}>
              {a.name}
            </Link>
          ))}
        </nav>
        <div className="row">
          <Link className="btn sm" href={href({ week: addDays(start, -7) })} aria-label="Previous week">←</Link>
          <Link className="btn sm" href={href({ week: weekStart(today), day: today })}>Today</Link>
          <Link className="btn sm" href={href({ week: addDays(start, 7) })} aria-label="Next week">→</Link>
          <span className="muted small">
            {dayLabel(start)} – {dayLabel(addDays(start, 6))}
          </span>
        </div>
      </div>

      {/* Week */}
      <section className="week-grid" aria-label="Week">
        {week.days.map((d) => {
          const list = filter(d.appts);
          const isSel = d.date === selected;
          return (
            <Link key={d.date} href={href({ day: d.date })} className={`week-day${isSel ? " selected" : ""}${d.date === today ? " today" : ""}`} scroll={false}>
              <div className="week-day-head">
                <span>{dayName(d.date)}</span>
                <b>{dayLabel(d.date)}</b>
              </div>
              <div className="week-day-sum">
                <b>{list.filter(active).length}</b> appts · {moneyShort(assetsOf(list))}
              </div>
              <ul>
                {list.slice(0, 6).map((a) => (
                  <li key={a.id} style={{ opacity: a.status === "Cancelled" ? 0.5 : 1 }}>
                    <span className="muted">{time12(a.time)}</span> {a.name.split(" ")[0]} {a.name.split(" ").slice(-1)[0][0]}.
                  </li>
                ))}
                {list.length > 6 && <li className="muted">+{list.length - 6} more</li>}
              </ul>
            </Link>
          );
        })}
      </section>

      {/* Selected day detail */}
      <section className="card" style={{ padding: 0 }}>
        <div className="card-head" style={{ padding: "20px 20px 0" }}>
          <div>
            <h2>
              {dayName(selected, "long")}, {dayLabel(selected)}
              {selected === today ? " (today)" : ""}
            </h2>
            <p className="muted small">
              {count(dayAppts.filter(active).length)} appointments · {money(assetsOf(dayAppts))} projected assets (excluding cancelled). Assets are
              estimated from each prospect&apos;s quiz answer.
            </p>
          </div>
        </div>
        {dayAppts.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>No appointments on this day.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="compact">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Prospect</th>
                  <th>Age</th>
                  <th className="num">Assets</th>
                  <th>Location</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Quiz bio</th>
                </tr>
              </thead>
              <tbody>
                {byAgent.map((g) => (
                  <AgentRows key={g.agent.id} name={g.agent.name} appts={g.appts} bioBase={basePath} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="muted small">
        {week.source === "ghl"
          ? "Appointments come from the CRM calendars, grouped by the assigned user. Age, assets and the quiz bio come from the prospect's Typeform quiz when their email or phone matches a quiz lead."
          : "Sample appointments until your OnRadar CRM account is connected. Agents can be renamed in client settings."}{" "}
        Times are {client.timeZone.replace("_", " ")}.
      </p>
    </div>
  );
}

function AgentRows({ name, appts, bioBase }: { name: string; appts: CalendarAppt[]; bioBase: string }) {
  const assets = appts.filter(active).reduce((s, a) => s + (a.assets ?? 0), 0);
  return (
    <>
      <tr className="group-row">
        <td colSpan={8}>
          {name} <span className="muted" style={{ fontWeight: 400 }}>· {appts.filter(active).length} appts · {moneyShort(assets)} projected assets</span>
        </td>
      </tr>
      {appts.length === 0 && (
        <tr>
          <td colSpan={8} className="muted">No appointments</td>
        </tr>
      )}
      {appts.map((a) => (
        <tr key={a.id} style={{ opacity: a.status === "Cancelled" ? 0.6 : 1 }}>
          <td>{time12(a.time)}</td>
          <td>
            <b>{a.name}</b>
          </td>
          <td>{a.age ?? "—"}</td>
          <td className="num">{a.assets ? moneyShort(a.assets) : "—"}</td>
          <td>{a.city === "Unknown" ? "—" : `${a.city}, ${a.state}`}</td>
          <td>{a.source}</td>
          <td>
            <span className="badge">
              <span className="dot" style={{ background: STATUS_TONE[a.status] }} />
              {a.status}
            </span>
          </td>
          <td>
            {a.quiz ? (
              <Link href={`${bioBase}/${encodeURIComponent(a.id)}`} className="btn sm">
                View bio
              </Link>
            ) : (
              <span className="muted small">No quiz</span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}
