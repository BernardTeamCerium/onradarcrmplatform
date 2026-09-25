"use client";

import { Fragment, useMemo, useState } from "react";
import { count, money, percent } from "@/lib/format";
import { rates, sumCounts } from "@/lib/rates";
import type { Counts, GeoCell } from "@/lib/types";
import { SourceBars } from "./SourceBars";

type Level = "state" | "city";

/** Minimum volume a source needs in a place before it can be called "best", so one lucky lead doesn't win. */
const BEST_BY = {
  cpc: { label: "Lowest cost per connected appt", fn: (c: Counts) => rates(c).costPerConnected, lower: true, fmt: (v: number) => money(v, true), min: (c: Counts) => c.connected >= 3 },
  cpl: { label: "Lowest cost per lead", fn: (c: Counts) => rates(c).cpl, lower: true, fmt: (v: number) => money(v, true), min: (c: Counts) => c.leads >= 10 },
  conv: { label: "Best sales conversion", fn: (c: Counts) => rates(c).salesConversion, lower: false, fmt: (v: number) => percent(v, 1), min: (c: Counts) => c.leads >= 10 },
  connPct: { label: "Best connected appt %", fn: (c: Counts) => rates(c).connectedPct, lower: false, fmt: (v: number) => percent(v, 0), min: (c: Counts) => c.leads >= 10 },
  cycle: { label: "Fastest to application", fn: (c: Counts) => rates(c).cycleDays, lower: true, fmt: (v: number) => `${v.toFixed(1)} days`, min: (c: Counts) => c.applicants >= 2 },
  leads: { label: "Most leads", fn: (c: Counts) => c.leads, lower: false, fmt: (v: number) => `${count(v)} leads`, min: (c: Counts) => c.leads >= 1 },
} as const;
type BestKey = keyof typeof BEST_BY;

interface Place extends Counts {
  key: string;
  label: string;
  bySource: (Counts & { source: string })[];
}

function pickBest<T extends Counts>(items: T[], key: BestKey) {
  const b = BEST_BY[key];
  return items
    .filter(b.min)
    .map((x) => ({ x, v: b.fn(x) }))
    // A 0% conversion (or zero leads) is never "best"; costs of 0 can't happen since cost needs spend.
    .filter((e): e is { x: T; v: number } => e.v !== null && (b.lower || e.v > 0))
    .sort((p, q) => (b.lower ? p.v - q.v : q.v - p.v))[0];
}

export function GeoExplorer({ cells, sourceOrder }: { cells: GeoCell[]; sourceOrder: string[] }) {
  const [level, setLevel] = useState<Level>("state");
  const [bestBy, setBestBy] = useState<BestKey>("cpc");
  const [open, setOpen] = useState<string | null>(null);

  const places = useMemo<Place[]>(() => {
    const groups = new Map<string, GeoCell[]>();
    for (const c of cells) {
      const key = level === "state" ? c.state : `${c.city}|${c.state}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    const order = (s: string) => {
      const i = sourceOrder.indexOf(s);
      return i === -1 ? 999 : i;
    };
    return [...groups.entries()]
      .map(([key, list]) => {
        const bySourceMap = new Map<string, GeoCell[]>();
        list.forEach((c) => bySourceMap.set(c.source, [...(bySourceMap.get(c.source) ?? []), c]));
        const [city, state] = key.split("|");
        return {
          key,
          label: level === "state" ? key : `${city}, ${state}`,
          ...sumCounts(list),
          bySource: [...bySourceMap.entries()]
            .map(([source, cs]) => ({ source, ...sumCounts(cs) }))
            .sort((a, b) => order(a.source) - order(b.source)),
        };
      })
      .filter((p) => p.leads + p.spend > 0)
      .sort((a, b) => b.leads - a.leads);
  }, [cells, level, sourceOrder]);

  const total = sumCounts(places);
  const noun = level === "state" ? "state" : "city";
  const mostLeads = pickBest(places, "leads");
  const cheapest = pickBest(places, "cpc");
  const bestConv = pickBest(places, "conv");
  const fastest = pickBest(places, "cycle");
  const withLeads = places.filter((p) => p.leads > 0);
  const metric = (key: string, label: string, fn: (c: Counts) => number | null, fmt: (v: number | null) => string, lowerIsBetter = false) => ({
    key,
    label,
    lowerIsBetter,
    values: withLeads.map((p) => {
      const v = fn(p);
      return { source: p.label, value: v, display: fmt(v) };
    }),
  });
  const days = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} days`);

  const cellsRow = (c: Counts) => {
    const d = rates(c);
    return (
      <>
        <td className="num">{money(c.spend)}</td>
        <td className="num">{count(c.leads)}</td>
        <td className="num">{money(d.cpl, true)}</td>
        <td className="num">{count(c.conversations)}</td>
        <td className="num">{percent(d.contactRate, 0)}</td>
        <td className="num">{count(c.apptsSet)}</td>
        <td className="num">{count(c.connected)}</td>
        <td className="num">{percent(d.connectRate, 0)}</td>
        <td className="num">{percent(d.connectedPct, 0)}</td>
        <td className="num">{money(d.costPerConnected, true)}</td>
        <td className="num">{count(c.applicants)}</td>
        <td className="num">{d.cycleDays === null ? "—" : d.cycleDays.toFixed(1)}</td>
        <td className="num">{percent(d.salesConversion, 1)}</td>
      </>
    );
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <nav className="segmented" aria-label="Group by">
          {(["state", "city"] as Level[]).map((l) => (
            <a
              key={l}
              href="#"
              aria-current={level === l ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setLevel(l);
                setOpen(null);
              }}
            >
              By {l}
            </a>
          ))}
        </nav>
      </div>

      <section className="kpi-grid" aria-label={`${noun} highlights`}>
        {[
          { label: `Most leads (${noun})`, hit: mostLeads, fmt: BEST_BY.leads.fmt },
          { label: `Lowest cost per connected appt`, hit: cheapest, fmt: BEST_BY.cpc.fmt },
          { label: `Best sales conversion`, hit: bestConv, fmt: BEST_BY.conv.fmt },
          { label: `Fastest to application`, hit: fastest, fmt: BEST_BY.cycle.fmt },
        ].map((t) => (
          <div className="kpi" key={t.label}>
            <div className="label">{t.label}</div>
            <div className="value" style={{ fontSize: 24 }}>{t.hit ? t.hit.x.label : "—"}</div>
            <span className="delta">{t.hit ? t.fmt(t.hit.v) : "Not enough data yet"}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Compare {level === "state" ? "states" : "cities"}</h2>
            <p className="muted small">Pick a measure to rank every {noun} by it.</p>
          </div>
        </div>
        <SourceBars
          key={level}
          noun={noun}
          metrics={[
            metric("leads", "Leads", (c) => c.leads, (v) => count(v ?? 0)),
            metric("spend", "Marketing spend", (c) => c.spend, (v) => money(v)),
            metric("cpl", "Cost per lead", (c) => rates(c).cpl, (v) => money(v, true), true),
            metric("contact", "Contact rate", (c) => rates(c).contactRate, (v) => percent(v, 0)),
            metric("connected", "Connected appts", (c) => c.connected, (v) => count(v ?? 0)),
            metric("connPct", "Connected appt %", (c) => rates(c).connectedPct, (v) => percent(v, 0)),
            metric("cpc", "Cost per connected appt", (c) => rates(c).costPerConnected, (v) => money(v, true), true),
            metric("apps", "Applications", (c) => c.applicants, (v) => count(v ?? 0)),
            metric("cycle", "Cycle time to application", (c) => rates(c).cycleDays, days, true),
            metric("conv", "Sales conversion", (c) => rates(c).salesConversion, (v) => percent(v, 1)),
          ]}
        />
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div className="card-head" style={{ padding: "20px 20px 0" }}>
          <div>
            <h2>Results by {noun}</h2>
            <p className="muted small">
              Click a {noun} to see every source there. A source needs enough volume in a {noun} (e.g. 3+ connected appts or 10+ leads) to be
              named best. Rows add up to the Dashboard totals.
            </p>
          </div>
          <label className="field" style={{ minWidth: 240 }}>
            Best source means
            <select value={bestBy} onChange={(e) => setBestBy(e.target.value as BestKey)}>
              {(Object.keys(BEST_BY) as BestKey[]).map((k) => (
                <option key={k} value={k}>{BEST_BY[k].label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="compact geo-table">
            <thead>
              <tr>
                <th>{level === "state" ? "State" : "City"}</th>
                <th>Best source</th>
                <th className="num">Spend</th>
                <th className="num">Leads</th>
                <th className="num">Cost / lead</th>
                <th className="num">Convos</th>
                <th className="num">Contact rate</th>
                <th className="num">Appts set</th>
                <th className="num">Conn. appts</th>
                <th className="num">Conn. rate</th>
                <th className="num">Conn. appt %</th>
                <th className="num">Cost / conn. appt</th>
                <th className="num">Apps</th>
                <th className="num">Days to app</th>
                <th className="num">Sales conv.</th>
              </tr>
            </thead>
            <tbody>
              {places.map((p) => {
                const best = pickBest(p.bySource, bestBy);
                const isOpen = open === p.key;
                return (
                  <Fragment key={p.key}>
                    <tr className="geo-row" onClick={() => setOpen(isOpen ? null : p.key)} aria-expanded={isOpen}>
                      <td>
                        <button className="linkish" aria-label={`${isOpen ? "Hide" : "Show"} sources for ${p.label}`}>
                          <span aria-hidden="true" className="caret">{isOpen ? "▾" : "▸"}</span> {p.label}
                        </button>
                      </td>
                      <td>
                        {best ? (
                          <span className="badge" title={BEST_BY[bestBy].label}>
                            <span aria-hidden="true" style={{ color: "var(--good)" }}>★</span>
                            {best.x.source} · {BEST_BY[bestBy].fmt(best.v)}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      {cellsRow(p)}
                    </tr>
                    {isOpen &&
                      p.bySource.map((s) => (
                        <tr key={s.source} className="geo-sub">
                          <td style={{ paddingLeft: 28 }}>{s.source}</td>
                          <td>{best && best.x.source === s.source ? <span className="muted small">★ best</span> : null}</td>
                          {cellsRow(s)}
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              <tr style={{ fontWeight: 650, background: "var(--surface-2)" }}>
                <td>Total</td>
                <td />
                {cellsRow(total)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
