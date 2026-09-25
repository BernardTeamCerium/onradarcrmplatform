import type { YearRecord } from "./types";

export interface YearView extends YearRecord {
  /** True for the current calendar year (numbers are year to date). */
  ytd: boolean;
  /** Share of the year elapsed (1 for past years). */
  elapsed: number;
  projected: { submitted: number; paid: number; chargebacks: number; apptsSet: number; connectedAppts: number };
  placementRate: number | null;
  chargebackRate: number | null;
  connectRate: number | null;
  paidPerConnect: number | null;
  /** Growth vs the previous year (full-year pace for the current year). */
  growth: { submitted: number | null; paid: number | null; chargebacks: number | null; apptsSet: number | null; connectedAppts: number | null; paidPerConnect: number | null };
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const change = (now: number | null, before: number | null | undefined) =>
  now === null || !before ? null : (now - before) / before;

export function yearElapsed(year: number, now = new Date()) {
  const y = now.getUTCFullYear();
  if (year < y) return 1;
  if (year > y) return 0;
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return (now.getTime() - start) / (end - start);
}

export function buildYears(records: YearRecord[], now = new Date()): YearView[] {
  const sorted = [...records].sort((a, b) => a.year - b.year);
  const views: YearView[] = [];
  for (const r of sorted) {
    const elapsed = yearElapsed(r.year, now);
    const ytd = elapsed > 0 && elapsed < 1;
    const k = ytd ? 1 / elapsed : 1;
    const projected = {
      submitted: r.submitted * k,
      paid: r.paid * k,
      chargebacks: r.chargebacks * k,
      apptsSet: r.apptsSet * k,
      connectedAppts: r.connectedAppts * k,
    };
    const prev = views.find((v) => v.year === r.year - 1);
    const paidPerConnect = ratio(r.paid, r.connectedAppts);
    views.push({
      ...r,
      ytd,
      elapsed,
      projected,
      placementRate: ratio(r.paid, r.submitted),
      chargebackRate: ratio(r.chargebacks, r.paid),
      connectRate: ratio(r.connectedAppts, r.apptsSet),
      paidPerConnect,
      growth: {
        submitted: change(projected.submitted, prev?.submitted),
        paid: change(projected.paid, prev?.paid),
        chargebacks: change(projected.chargebacks, prev?.chargebacks),
        apptsSet: change(projected.apptsSet, prev?.apptsSet),
        connectedAppts: change(projected.connectedAppts, prev?.connectedAppts),
        paidPerConnect: change(paidPerConnect, prev?.paidPerConnect),
      },
    });
  }
  return views;
}

export interface Gap {
  label: string;
  actual: number;
  target: number;
  /** Positive = still needed (or, for chargebacks, allowance left). */
  remaining: number;
  perMonthNeeded: number;
  perMonthPace: number;
  projected: number;
  onTrack: boolean;
}

/** What the rest of the current year needs to look like to land each target. */
export function gapsToTarget(y: YearView) {
  const monthsGone = y.elapsed * 12;
  const monthsLeft = Math.max(0.0001, 12 - monthsGone);
  const make = (label: string, actual: number, target: number | undefined, lowerIsBetter = false): Gap | null => {
    if (!target) return null;
    const pace = actual / Math.max(monthsGone, 0.0001);
    const projected = actual / Math.max(y.elapsed, 0.0001);
    return {
      label,
      actual,
      target,
      remaining: target - actual,
      perMonthNeeded: (target - actual) / monthsLeft,
      perMonthPace: pace,
      projected,
      onTrack: lowerIsBetter ? projected <= target : projected >= target,
    };
  };
  const submitted = make("Submitted", y.submitted, y.targetSubmitted);
  const paid = make("Paid", y.paid, y.targetPaid);
  const chargebacks = make("Chargebacks", y.chargebacks, y.targetChargebacks, true);
  const apptsSet = make("Appointments set", y.apptsSet, y.targetApptsSet);
  const connected = make("Connected appointments", y.connectedAppts, y.targetConnectedAppts);

  // Translate the paid gap into appointments, using this year's paid production per connect and connect rate.
  let appointmentPlan: null | {
    connectsNeeded: number;
    connectsPerMonth: number;
    connectsPace: number;
    setNeeded: number;
    setPerMonth: number;
    setPace: number;
    ppcNeededAtPace: number;
  } = null;
  if (paid && paid.remaining > 0 && y.paidPerConnect && y.connectRate) {
    const connectsNeeded = paid.remaining / y.paidPerConnect;
    const setNeeded = connectsNeeded / y.connectRate;
    const connectsPace = y.connectedAppts / Math.max(monthsGone, 0.0001);
    appointmentPlan = {
      connectsNeeded,
      connectsPerMonth: connectsNeeded / monthsLeft,
      connectsPace,
      setNeeded,
      setPerMonth: setNeeded / monthsLeft,
      setPace: y.apptsSet / Math.max(monthsGone, 0.0001),
      ppcNeededAtPace: paid.remaining / (connectsPace * monthsLeft),
    };
  }
  return { monthsLeft, submitted, paid, chargebacks, apptsSet, connected, appointmentPlan };
}
