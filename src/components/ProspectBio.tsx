import Link from "next/link";
import { getAppointment } from "@/lib/calendar";
import { money } from "@/lib/format";
import type { Client } from "@/lib/types";
import { ClientLogo } from "./ClientLogo";
import { PrintButton } from "./PrintButton";

function formatPhone(p?: string) {
  const d = (p ?? "").replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : p ?? "—";
}

/** A one-page prospect brief for the agent: appointment, contact details and every quiz answer. */
export async function ProspectBio({ client, apptId, backHref }: { client: Client; apptId: string; backHref: string }) {
  const found = await getAppointment(client, apptId);
  if (!found) {
    return (
      <div className="card">
        <h2>Appointment not found</h2>
        <p className="muted" style={{ marginTop: 6 }}>It may have been moved or cancelled.</p>
        <p style={{ marginTop: 12 }}><Link className="btn sm" href={backHref}>Back to calendar</Link></p>
      </div>
    );
  }
  const { appt: a, agents } = found;
  const agent = agents.find((x) => x.id === a.agentId)?.name ?? "Unassigned";
  const h = Number(a.time.slice(0, 2));
  const when = `${new Date(`${a.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} at ${((h + 11) % 12) + 1}:${a.time.slice(3)} ${h < 12 ? "AM" : "PM"}`;
  const p = a.profile;
  const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const facts = [
    ["Meeting type", a.apptType ?? "—"],
    ["Appointment", when],
    ["Agent", agent],
    ["Status", a.status],
    ["Phone", formatPhone(a.phone)],
    ["Email", a.email ?? "—"],
    ["Location", a.city === "Unknown" ? "—" : `${a.city}, ${a.state}`],
    ["Age", a.age ?? "—"],
    ["Retirement savings", a.assetsLabel ? `${a.assetsLabel}${a.assets ? ` (est. ${money(a.assets)})` : ""}` : "—"],
    ["Lead source", a.source],
    ...(p
      ? [
          ["Relationship", p.existingClient ? "Existing client" : "New prospect"],
          ["Format", p.meetingFormat],
          ["Marital status", p.spouse ? `${p.maritalStatus} · spouse ${p.spouse}` : p.maritalStatus],
          ["Employment", p.employment],
          ["Household income", p.householdIncome],
          ["Risk tolerance", p.riskTolerance],
        ]
      : []),
  ];
  return (
    <div className="stack bio">
      <div className="row no-print" style={{ justifyContent: "space-between" }}>
        <Link className="btn sm" href={backHref}>← Back to calendar</Link>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn" href={`/api/clients/${client.id}/appointments/${encodeURIComponent(a.id)}/docx`} download>
            Download Word doc
          </a>
          <PrintButton />
        </div>
      </div>
      <article className="card stack" style={{ gap: 18 }}>
        <div className="client-header">
          <ClientLogo client={client} />
          <div className="titles">
            <p className="muted small">Prospect brief · {client.name}</p>
            <h1>{a.name}</h1>
            <p className="muted small">{a.quiz?.title ?? "Quiz"} responses</p>
          </div>
        </div>
        <dl className="bio-facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {p?.newMoney && (
          <div className="bio-callout">
            <b>New money: {money0(p.newMoney.amount)}</b> from {p.newMoney.source.toLowerCase()} · {p.newMoney.timing.toLowerCase()}
          </div>
        )}
        {p && (
          <div>
            <h2 style={{ marginBottom: 8 }}>{p.existingPolicies.length ? "Policies to review" : "Existing policies"}</h2>
            {p.existingPolicies.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Product</th><th>Issued</th><th>Value</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {p.existingPolicies.map((x, i) => (
                      <tr key={i}><td>{x.product}</td><td>{x.issued}</td><td>{x.value}</td><td className="muted">{x.note}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No existing policies on file.</p>
            )}
          </div>
        )}
        {p && (
          <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <h2 style={{ marginBottom: 8 }}>Goals</h2>
              <ul className="plan">{p.goals.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
            <div>
              <h2 style={{ marginBottom: 8 }}>Notes for the agent</h2>
              <ul className="plan">{p.notes.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
          </div>
        )}
        <div>
          <h2 style={{ marginBottom: 8 }}>Quiz responses</h2>
          {a.quiz ? (
            <dl className="qa">
              {a.quiz.answers.map((q, i) => (
                <div key={i}>
                  <dt>{q.question}</dt>
                  <dd>{q.answer || <span className="muted">No answer</span>}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">This prospect hasn&apos;t taken the quiz.</p>
          )}
        </div>
        <p className="muted small">Prepared by OnRadar CRM. Contains personal information, so handle and share it carefully.</p>
      </article>
    </div>
  );
}
