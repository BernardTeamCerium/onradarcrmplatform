"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { removeLead, sendTestLead, updateLeadStatus } from "@/app/actions/leads";
import { LEAD_STATUSES, type Lead, type LeadStatus } from "@/lib/types";

const POLL_MS = 4000;

const STATUS_TONE: Record<LeadStatus, string> = {
  New: "var(--series-1)",
  Contacted: "var(--ink-muted)",
  "Appointment set": "var(--accent)",
  "Appointment held": "var(--accent)",
  "No show": "var(--bad)",
  "Application submitted": "var(--good)",
  Sold: "var(--good)",
  "Not interested": "var(--ink-muted)",
  "Bad contact info": "var(--bad)",
};

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function formatPhone(p?: string) {
  const d = (p ?? "").replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : p ?? "";
}

function StatusPill({ status }: { status: LeadStatus }) {
  return (
    <span className="badge" style={{ whiteSpace: "nowrap" }}>
      <span className="dot" style={{ background: STATUS_TONE[status] }} />
      {status}
    </span>
  );
}

export function LeadsBoard({
  clientId,
  initialLeads,
  isAdmin,
}: {
  clientId: string;
  initialLeads: Lead[];
  isAdmin: boolean;
}) {
  const [leads, setLeads] = useState(initialLeads);
  const [selectedId, setSelectedId] = useState<string | null>(initialLeads[0]?.id ?? null);
  const [filter, setFilter] = useState<LeadStatus | "All">("All");
  const [query, setQuery] = useState("");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Lead | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const [pending, startTransition] = useTransition();
  const known = useRef(new Set(initialLeads.map((l) => l.id)));
  const detailRef = useRef<HTMLDivElement>(null);

  const announce = useCallback((incoming: Lead[]) => {
    const added = incoming.filter((l) => !known.current.has(l.id));
    if (added.length === 0) return;
    added.forEach((l) => known.current.add(l.id));
    setFresh((prev) => new Set([...prev, ...added.map((l) => l.id)]));
    setToast(added[0]);
    const ids = added.map((l) => l.id);
    setTimeout(() => setFresh((prev) => new Set([...prev].filter((id) => !ids.includes(id)))), 8000);
  }, []);

  // Poll for new leads and status changes made elsewhere.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/leads`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const { leads: next } = (await res.json()) as { leads: Lead[] };
        if (!alive) return;
        setOnline(true);
        announce(next);
        setLeads(next);
      } catch {
        if (alive) setOnline(false);
      }
    };
    const t = setInterval(tick, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(clock);
    };
  }, [clientId, announce]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const counts = useMemo(() => {
    const m = new Map<LeadStatus, number>();
    for (const l of leads) m.set(l.status, (m.get(l.status) ?? 0) + 1);
    return m;
  }, [leads]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter(
      (l) =>
        (filter === "All" || l.status === filter) &&
        (!q || [l.name, l.email, l.phone, ...l.answers.map((a) => a.answer)].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [leads, filter, query]);

  const selected = leads.find((l) => l.id === selectedId) ?? null;

  function select(id: string) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 960px)").matches) {
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }

  function changeStatus(lead: Lead, status: LeadStatus) {
    setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, status, statusUpdatedAt: new Date().toISOString() } : l)));
    startTransition(async () => {
      await updateLeadStatus(clientId, lead.id, status);
    });
  }

  function simulate() {
    startTransition(async () => {
      const lead = await sendTestLead(clientId);
      setLeads((ls) => (ls.some((l) => l.id === lead.id) ? ls : [lead, ...ls]));
      announce([lead]);
      setSelectedId(lead.id);
    });
  }

  function remove(lead: Lead) {
    if (!confirm(`Delete ${lead.name}? This can't be undone.`)) return;
    setLeads((ls) => ls.filter((l) => l.id !== lead.id));
    if (selectedId === lead.id) setSelectedId(null);
    startTransition(async () => {
      await removeLead(clientId, lead.id);
    });
  }

  return (
    <div className="stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div className="row" style={{ gap: 10 }}>
          <h2 style={{ fontSize: 18 }}>Leads</h2>
          <span className="badge" title={online ? "Checking for new leads every few seconds" : "Reconnecting…"}>
            <span className={`dot${online ? " live-dot" : ""}`} style={{ background: online ? "var(--good)" : "var(--bad)" }} />
            {online ? "Live" : "Reconnecting"}
          </span>
          <span className="muted small">{leads.length} total</span>
        </div>
        <div className="row">
          <input
            type="search"
            placeholder="Search name, email, phone, answers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search leads"
            style={{ width: 260, maxWidth: "100%" }}
          />
          {isAdmin && (
            <button className="btn accent" onClick={simulate} disabled={pending}>
              {pending ? "Sending…" : "Send test lead"}
            </button>
          )}
        </div>
      </div>

      <nav className="chips" aria-label="Filter by status">
        <button className={filter === "All" ? "chip on" : "chip"} onClick={() => setFilter("All")}>
          All <b>{leads.length}</b>
        </button>
        {LEAD_STATUSES.filter((s) => counts.get(s)).map((s) => (
          <button key={s} className={filter === s ? "chip on" : "chip"} onClick={() => setFilter(s)}>
            <span className="dot" style={{ background: STATUS_TONE[s] }} />
            {s} <b>{counts.get(s)}</b>
          </button>
        ))}
      </nav>

      <div className="leads-grid">
        <section className="card" style={{ padding: 0 }} aria-label="Lead list">
          {visible.length === 0 ? (
            <p className="muted" style={{ padding: 24, textAlign: "center" }}>
              {leads.length === 0 ? "No leads yet. They'll appear here the moment someone completes the quiz." : "No leads match."}
            </p>
          ) : (
            <ul className="lead-list">
              {visible.map((l) => (
                <li key={l.id}>
                  <button
                    className={`lead-row${l.id === selectedId ? " selected" : ""}${fresh.has(l.id) ? " fresh" : ""}`}
                    onClick={() => select(l.id)}
                  >
                    <span className="lead-main">
                      <span className="lead-name">
                        {l.name}
                        {fresh.has(l.id) && <span className="new-tag">NEW</span>}
                        {l.test && <span className="muted small"> · test</span>}
                      </span>
                      <span className="muted small">
                        {l.source} · {ago(l.receivedAt, now)}
                      </span>
                    </span>
                    <StatusPill status={l.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card lead-detail" ref={detailRef} aria-label="Lead details">
          {selected ? (
            <div className="stack" style={{ gap: 16 }}>
              <div className="card-head" style={{ marginBottom: 0 }}>
                <div>
                  <h2 style={{ fontSize: 20 }}>{selected.name}</h2>
                  <p className="muted small">
                    {selected.source} · received{" "}
                    {new Date(selected.receivedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </p>
                </div>
                <label className="field" style={{ minWidth: 200 }}>
                  Status
                  <select value={selected.status} onChange={(e) => changeStatus(selected, e.target.value as LeadStatus)}>
                    {LEAD_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="contact-grid">
                <div>
                  <div className="muted small">Phone</div>
                  {selected.phone ? <a href={`tel:${selected.phone}`}>{formatPhone(selected.phone)}</a> : <span className="muted">—</span>}
                </div>
                <div>
                  <div className="muted small">Email</div>
                  {selected.email ? <a href={`mailto:${selected.email}`}>{selected.email}</a> : <span className="muted">—</span>}
                </div>
                <div>
                  <div className="muted small">Status updated</div>
                  <span>{ago(selected.statusUpdatedAt, now)}</span>
                </div>
              </div>
              <div>
                <h3 style={{ marginBottom: 8 }}>Quiz responses</h3>
                <dl className="qa">
                  {selected.answers.map((a, i) => (
                    <div key={i}>
                      <dt>{a.question}</dt>
                      <dd>{a.answer || <span className="muted">No answer</span>}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              {isAdmin && (
                <div>
                  <button className="btn sm danger" onClick={() => remove(selected)}>Delete lead</button>
                </div>
              )}
            </div>
          ) : (
            <p className="muted">Select a lead to see their details and quiz responses.</p>
          )}
        </section>
      </div>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span className="dot live-dot" style={{ background: "var(--green)" }} />
          <div>
            <b>New lead: {toast.name}</b>
            <div className="small" style={{ opacity: 0.8 }}>Just completed the {toast.source}</div>
          </div>
          <button
            className="btn sm"
            onClick={() => {
              setSelectedId(toast.id);
              setFilter("All");
              setToast(null);
            }}
          >
            View
          </button>
        </div>
      )}
    </div>
  );
}
