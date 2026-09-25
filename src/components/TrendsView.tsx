import { count, moneyShort, percent, signedPercent } from "@/lib/format";
import { buildYears, gapsToTarget, type Gap, type YearView } from "@/lib/trends";
import type { Client } from "@/lib/types";
import { YearBars } from "./YearBars";

const SERIES = [
  { key: "submitted", name: "Submitted", color: "var(--series-1)" },
  { key: "paid", name: "Paid", color: "var(--series-2)" },
  { key: "chargebacks", name: "Chargebacks", color: "var(--series-3)" },
] as const;

type Money = "submitted" | "paid" | "chargebacks";
const TARGET_KEY: Record<Money, "targetSubmitted" | "targetPaid" | "targetChargebacks"> = {
  submitted: "targetSubmitted",
  paid: "targetPaid",
  chargebacks: "targetChargebacks",
};

function Delta({ value, upIsGood = true, suffix = "" }: { value: number | null; upIsGood?: boolean; suffix?: string }) {
  if (value === null) return <span className="muted">—</span>;
  const good = value >= 0 === upIsGood;
  return (
    <span style={{ color: good ? "var(--good)" : "var(--bad)", whiteSpace: "nowrap" }}>
      <span aria-hidden="true">{value >= 0 ? "▲" : "▼"} </span>
      {signedPercent(value)}
      {suffix}
    </span>
  );
}

/** "On target" / "Behind" / "Over limit" with icon, never color alone. */
function Status({ ok, lowerIsBetter, ytd }: { ok: boolean; lowerIsBetter?: boolean; ytd?: boolean }) {
  const text = ytd
    ? ok
      ? lowerIsBetter ? "Within limit pace" : "On pace"
      : lowerIsBetter ? "Pacing over limit" : "Behind pace"
    : ok
      ? lowerIsBetter ? "Within limit" : "Hit target"
      : lowerIsBetter ? "Over limit" : "Missed target";
  return (
    <span className="badge" style={{ whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ color: ok ? "var(--good)" : "var(--bad)" }}>{ok ? "✔" : ytd ? "!" : "✖"}</span>
      {text}
    </span>
  );
}

function vsTarget(y: YearView, key: Money) {
  const target = y[TARGET_KEY[key]];
  if (!target) return null;
  const basis = y.ytd ? y.projected[key] : y[key];
  const lowerIsBetter = key === "chargebacks";
  return { target, basis, diff: basis - target, pct: basis / target, ok: lowerIsBetter ? basis <= target : basis >= target, lowerIsBetter };
}

function GapLine({ gap, lowerIsBetter }: { gap: Gap; lowerIsBetter?: boolean }) {
  if (lowerIsBetter) {
    return (
      <li>
        <b>Chargebacks:</b> {moneyShort(gap.actual)} so far against a {moneyShort(gap.target)} limit, leaving{" "}
        <b>{moneyShort(Math.max(0, gap.remaining))}</b> of room (about {moneyShort(Math.max(0, gap.perMonthNeeded))} a month). At the
        current pace of {moneyShort(gap.perMonthPace)} a month the year ends near {moneyShort(gap.projected)},{" "}
        {gap.onTrack ? "inside the limit." : <b style={{ color: "var(--bad)" }}>{moneyShort(gap.projected - gap.target)} over the limit.</b>}
      </li>
    );
  }
  const lift = gap.perMonthPace > 0 ? gap.perMonthNeeded / gap.perMonthPace : null;
  return (
    <li>
      <b>{gap.label}:</b> {moneyShort(gap.actual)} of {moneyShort(gap.target)} ({percent(gap.actual / gap.target, 0)}).{" "}
      {gap.remaining > 0 ? (
        <>
          Need <b>{moneyShort(gap.remaining)}</b> more, which is <b>{moneyShort(gap.perMonthNeeded)} a month</b> versus the current{" "}
          {moneyShort(gap.perMonthPace)} a month{lift && lift > 1 ? ` (${lift.toFixed(1)}× the current pace)` : ""}.
        </>
      ) : (
        <>Target already reached.</>
      )}
    </li>
  );
}

export function TrendsView({ client }: { client: Client }) {
  const years = buildYears(client.yearly);
  if (years.length === 0) {
    return (
      <section className="card">
        <h2>No yearly numbers yet</h2>
        <p className="muted" style={{ marginTop: 6 }}>Your OnRadar account manager can add yearly production and targets in client settings.</p>
      </section>
    );
  }
  const current = years.find((y) => y.ytd) ?? years[years.length - 1];
  const gaps = current.ytd ? gapsToTarget(current) : null;
  const pctElapsed = Math.round(current.elapsed * 100);

  const headline = (key: Money, label: string) => {
    const t = vsTarget(current, key);
    const lowerIsBetter = key === "chargebacks";
    return (
      <div className="kpi">
        <div className="label">{label} {current.ytd ? `${current.year} YTD` : current.year}</div>
        <div className="value">{moneyShort(current[key])}</div>
        {t ? (
          <span className="delta">
            {current.ytd
              ? `${percent(current[key] / t.target, 0)} of ${lowerIsBetter ? "limit" : "target"} · ${pctElapsed}% of year gone`
              : `${percent(t.pct, 0)} of ${lowerIsBetter ? "limit" : "target"}`}
          </span>
        ) : null}
        <div className="formula">
          Growth vs {current.year - 1}: <Delta value={current.growth[key]} upIsGood={!lowerIsBetter} />
          {current.ytd ? " (full-year pace)" : ""}
        </div>
      </div>
    );
  };

  return (
    <div className="stack">
      <section className="kpi-grid" aria-label={`${current.year} headline`}>
        {headline("submitted", "Submitted")}
        {headline("paid", "Paid")}
        {headline("chargebacks", "Chargebacks")}
        <div className="kpi">
          <div className="label">Paid production per connect</div>
          <div className="value">{moneyShort(current.paidPerConnect)}</div>
          <span className="delta">{count(current.connectedAppts)} connected appts {current.ytd ? "YTD" : ""}</span>
          <div className="formula">
            Growth vs {current.year - 1}: <Delta value={current.growth.paidPerConnect} />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Production by year</h2>
            <p className="muted small">
              Submitted, paid and chargebacks, with each year&apos;s target
              {current.ytd ? `. The lighter bar shows where ${current.year} lands at its current pace.` : "."}
            </p>
          </div>
        </div>
        <YearBars
          label="Submitted, paid and chargebacks by year with targets"
          series={SERIES.map((s) => ({ ...s }))}
          groups={years.map((y) => ({
            year: y.year,
            ytd: y.ytd,
            values: Object.fromEntries(
              SERIES.map((s) => [
                s.key,
                {
                  actual: y[s.key],
                  projected: y.ytd ? y.projected[s.key] : undefined,
                  target: y[TARGET_KEY[s.key]],
                  lowerIsBetter: s.key === "chargebacks",
                },
              ]),
            ),
          }))}
        />
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div style={{ padding: "20px 20px 0" }}>
          <h2>Growth and targets</h2>
          <p className="muted small">
            Growth compares each year with the one before.{current.ytd ? ` ${current.year} is compared on its full-year pace (${pctElapsed}% of the year so far).` : ""}
          </p>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Actual</th>
                <th className="num">Growth</th>
                <th className="num">Target</th>
                <th className="num">Difference</th>
                <th className="num">% of target</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {SERIES.map((s) => (
                <FragmentRows key={s.key} name={s.name} color={s.color} years={years} metric={s.key} />
              ))}
              <tr className="group-row"><td colSpan={7}>Quality</td></tr>
              {years.map((y) => (
                <tr key={`q${y.year}`}>
                  <td>{y.year}{y.ytd ? " YTD" : ""}</td>
                  <td className="num" colSpan={6} style={{ textAlign: "left" }}>
                    Placement rate (paid ÷ submitted) <b>{percent(y.placementRate, 0)}</b>
                    <span className="muted"> · </span>
                    Chargeback rate (chargebacks ÷ paid) <b>{percent(y.chargebackRate, 1)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {gaps && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>What it takes to hit the {current.year} targets</h2>
              <p className="muted small">About {gaps.monthsLeft.toFixed(1)} months left in the year.</p>
            </div>
          </div>
          <ul className="plan">
            {gaps.paid && <GapLine gap={gaps.paid} />}
            {gaps.submitted && <GapLine gap={gaps.submitted} />}
            {gaps.chargebacks && <GapLine gap={gaps.chargebacks} lowerIsBetter />}
            {gaps.appointmentPlan && current.paidPerConnect && current.connectRate && (
              <li>
                <b>In appointments:</b> at {moneyShort(current.paidPerConnect)} paid per connected appointment, the paid gap takes about{" "}
                <b>{count(gaps.appointmentPlan.connectsNeeded)} more connected appointments</b> ({count(gaps.appointmentPlan.connectsPerMonth)} a
                month vs {count(gaps.appointmentPlan.connectsPace)} now). At a {percent(current.connectRate, 0)} connected rate, that means setting about{" "}
                <b>{count(gaps.appointmentPlan.setPerMonth)} appointments a month</b> (vs {count(gaps.appointmentPlan.setPace)} now).
              </li>
            )}
            {gaps.appointmentPlan && (
              <li>
                <b>Or raise production per connect:</b> keeping today&apos;s pace of {count(gaps.appointmentPlan.connectsPace)} connected appointments a month,
                each would need to produce about <b>{moneyShort(gaps.appointmentPlan.ppcNeededAtPace)}</b> in paid premium to close the gap.
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="card" style={{ padding: 0 }}>
        <div style={{ padding: "20px 20px 0" }}>
          <h2>Appointments by year</h2>
          <p className="muted small">Paid production per connect = paid premium ÷ connected appointments.</p>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Appts set</th>
                <th className="num">Growth</th>
                <th className="num">Connected appts</th>
                <th className="num">Growth</th>
                <th className="num">Connected rate</th>
                <th className="num">Paid per connect</th>
                <th className="num">Growth</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.year}>
                  <td>{y.year}{y.ytd ? " YTD" : ""}</td>
                  <td className="num">
                    {count(y.apptsSet)}
                    {y.targetApptsSet ? <div className="muted small">target {count(y.targetApptsSet)}{y.ytd ? ` · pace ${count(y.projected.apptsSet)}` : ""}</div> : null}
                  </td>
                  <td className="num"><Delta value={y.growth.apptsSet} /></td>
                  <td className="num">
                    {count(y.connectedAppts)}
                    {y.targetConnectedAppts ? <div className="muted small">target {count(y.targetConnectedAppts)}{y.ytd ? ` · pace ${count(y.projected.connectedAppts)}` : ""}</div> : null}
                  </td>
                  <td className="num"><Delta value={y.growth.connectedAppts} /></td>
                  <td className="num">{percent(y.connectRate, 0)}</td>
                  <td className="num">{moneyShort(y.paidPerConnect)}</td>
                  <td className="num"><Delta value={y.growth.paidPerConnect} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FragmentRows({ name, color, years, metric }: { name: string; color: string; years: YearView[]; metric: Money }) {
  const lowerIsBetter = metric === "chargebacks";
  return (
    <>
      <tr className="group-row">
        <td colSpan={7}>
          <span className="sw" style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: color, marginRight: 8 }} />
          {name}
          {lowerIsBetter ? <span className="muted" style={{ fontWeight: 400 }}> (target is a limit, lower is better)</span> : null}
        </td>
      </tr>
      {years.map((y) => {
        const t = vsTarget(y, metric);
        return (
          <tr key={`${metric}${y.year}`}>
            <td>
              {y.year}
              {y.ytd ? <span className="muted"> YTD</span> : null}
            </td>
            <td className="num">
              {moneyShort(y[metric])}
              {y.ytd ? <div className="muted small">pace {moneyShort(y.projected[metric])}</div> : null}
            </td>
            <td className="num"><Delta value={y.growth[metric]} upIsGood={!lowerIsBetter} /></td>
            <td className="num">{t ? moneyShort(t.target) : "—"}</td>
            <td className="num">
              {t ? (
                <span style={{ color: t.ok ? "var(--good)" : "var(--bad)" }}>
                  {Math.abs(t.diff) < 500 ? "" : t.diff > 0 ? "+" : "−"}
                  {moneyShort(Math.abs(t.diff))}
                </span>
              ) : "—"}
              {t && y.ytd ? <div className="muted small">on pace</div> : null}
            </td>
            <td className="num">{t ? percent(t.pct, 0) : "—"}</td>
            <td>{t ? <Status ok={t.ok} lowerIsBetter={lowerIsBetter} ytd={y.ytd} /> : null}</td>
          </tr>
        );
      })}
    </>
  );
}
