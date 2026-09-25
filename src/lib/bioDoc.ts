import "server-only";
import { promises as fs } from "fs";
import path from "path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { readLogo } from "./store";
import type { CalendarAppt, Client } from "./types";

const NAVY = "0B1628";
const MUTED = "5B6778";
const LINE = "D9E0EA";
const TINT = "EEF3F8";
const ACCENT = "16C486";
const CONTENT_W = 9360; // US Letter with 1" margins, in DXA
const FONT = "Calibri";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const text = (t: string, o: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) =>
  new TextRun({ text: t, font: FONT, bold: o.bold, color: o.color, size: o.size ?? 21, italics: o.italics });

const heading = (t: string) =>
  new Paragraph({
    spacing: { before: 280, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 3 } },
    children: [text(t, { bold: true, color: NAVY, size: 26 })],
  });

const para = (t: string, o: { color?: string; italics?: boolean; after?: number } = {}) =>
  new Paragraph({ spacing: { after: o.after ?? 80 }, children: [text(t, { color: o.color, italics: o.italics })] });

const bullets = (items: string[]) =>
  items.map((t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 60 }, children: [text(t)] }));

const cellBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

function cell(content: string, width: number, o: { bold?: boolean; shade?: string; color?: string } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBorders,
    shading: o.shade ? { type: ShadingType.CLEAR, color: "auto", fill: o.shade } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [text(content, { bold: o.bold, color: o.color })] })],
  });
}

/** Two-column label/value table. */
function facts(rows: [string, string][]) {
  const w = [2800, CONTENT_W - 2800];
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: w,
    rows: rows.map(
      ([k, v]) => new TableRow({ children: [cell(k, w[0], { shade: TINT, color: MUTED }), cell(v || "Not recorded", w[1], { bold: true })] }),
    ),
  });
}

function grid(header: string[], rows: string[][], widths: number[]) {
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, widths[i], { bold: true, shade: NAVY, color: "FFFFFF" })) }),
      ...rows.map((r) => new TableRow({ children: r.map((v, i) => cell(v, widths[i])) })),
    ],
  });
}

async function logoImage(client: Client) {
  if (!client.logo || /^https?:/.test(client.logo)) return null;
  const ext = path.extname(client.logo).toLowerCase();
  const type = ext === ".png" ? "png" : ext === ".jpg" || ext === ".jpeg" ? "jpg" : null;
  if (!type) return null;
  const data = client.logo.startsWith("/")
    ? await fs.readFile(path.join(process.cwd(), "public", client.logo)).catch(() => null)
    : await readLogo(client.logo);
  return data ? new ImageRun({ type, data, transformation: { width: 64, height: 64 } }) : null;
}

/** A prospect brief the agent can open in Word before the meeting. */
export async function buildBioDocx(client: Client, a: CalendarAppt, agentName: string) {
  const p = a.profile;
  const h = Number(a.time.slice(0, 2));
  const when = `${new Date(`${a.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} at ${((h + 11) % 12) + 1}:${a.time.slice(3)} ${h < 12 ? "AM" : "PM"}`;
  const phone = (() => {
    const d = (a.phone ?? "").replace(/\D/g, "");
    const n = d.length === 11 ? d.slice(1) : d;
    return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : a.phone ?? "";
  })();
  const type = a.apptType ?? p?.apptType ?? "Appointment";
  const logo = await logoImage(client);

  const children: (Paragraph | Table)[] = [];
  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [...(logo ? [logo, text("   ")] : []), text(`${client.name} · Prospect brief`, { color: MUTED, size: 20 })],
    }),
    new Paragraph({ spacing: { before: 120, after: 40 }, children: [text(a.name, { bold: true, color: NAVY, size: 44 })] }),
    new Paragraph({
      spacing: { after: 200 },
      children: [text(`${type}`, { bold: true, color: ACCENT, size: 24 }), text(`  ·  ${when}  ·  with ${agentName}`, { color: MUTED, size: 22 })],
    }),
  );

  // At a glance
  const glance: string[] = [];
  if (p?.newMoney) glance.push(`New money: ${money(p.newMoney.amount)} from ${p.newMoney.source.toLowerCase()} (${p.newMoney.timing.toLowerCase()}).`);
  if (p?.existingPolicies.length) glance.push(`${p.existingPolicies.length} existing ${p.existingPolicies.length === 1 ? "policy" : "policies"} to review.`);
  if (a.assetsLabel) glance.push(`Retirement savings: ${a.assetsLabel}${a.assets ? ` (est. ${money(a.assets)})` : ""}.`);
  if (p) glance.push(`${p.existingClient ? "Existing client" : "New prospect"} · ${p.riskTolerance.toLowerCase()} risk tolerance.`);
  if (glance.length) {
    children.push(
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: [CONTENT_W],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: CONTENT_W, type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, color: "auto", fill: TINT },
                borders: {
                  left: { style: BorderStyle.SINGLE, size: 24, color: ACCENT },
                  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                },
                margins: { top: 120, bottom: 120, left: 200, right: 200 },
                children: [
                  new Paragraph({ spacing: { after: 60 }, children: [text("At a glance", { bold: true, color: NAVY })] }),
                  ...glance.map((g) => new Paragraph({ spacing: { after: 40 }, children: [text(g)] })),
                ],
              }),
            ],
          }),
        ],
      }),
    );
  }

  children.push(
    heading("Appointment"),
    facts([
      ["Type", type],
      ["Date and time", `${when} (${client.timeZone.replace("_", " ")})`],
      ["Agent", agentName],
      ["Format", p?.meetingFormat ?? ""],
      ["Status", a.status],
      ["Lead source", a.source],
    ]),
    heading("Contact"),
    facts([
      ["Phone", phone],
      ["Email", a.email ?? ""],
      ["Location", a.city === "Unknown" ? "" : `${a.city}, ${a.state}`],
    ]),
  );

  if (p) {
    children.push(
      heading("Household and finances"),
      facts([
        ["Age", a.age ?? ""],
        ["Marital status", p.maritalStatus],
        ["Spouse", p.spouse ?? "None"],
        ["Employment", p.employment],
        ["Household income", p.householdIncome],
        ["Retirement savings", a.assetsLabel ? `${a.assetsLabel}${a.assets ? ` (est. ${money(a.assets)})` : ""}` : ""],
        ["Risk tolerance", p.riskTolerance],
        ["Relationship", p.existingClient ? "Existing client" : "New prospect"],
      ]),
    );
    if (p.newMoney) {
      children.push(
        heading("New money opportunity"),
        facts([
          ["Amount", money(p.newMoney.amount)],
          ["Where it's coming from", p.newMoney.source],
          ["Timing", p.newMoney.timing],
        ]),
      );
    }
    children.push(heading(p.existingPolicies.length ? "Policies to review" : "Existing policies"));
    if (p.existingPolicies.length) {
      children.push(
        grid(
          ["Product", "Issued", "Value", "Notes"],
          p.existingPolicies.map((x) => [x.product, x.issued, x.value, x.note ?? ""]),
          [3000, 1100, 2000, CONTENT_W - 6100],
        ),
      );
    } else {
      children.push(para("No existing policies on file.", { color: MUTED, italics: true }));
    }
    children.push(heading("Goals"), ...bullets(p.goals), heading("Notes for the agent"), ...bullets(p.notes));
  }

  children.push(heading(`Quiz responses${a.quiz ? ` · ${a.quiz.title}` : ""}`));
  if (a.quiz) {
    children.push(grid(["Question", "Answer"], a.quiz.answers.map((q) => [q.question, q.answer || "No answer"]), [5200, CONTENT_W - 5200]));
  } else {
    children.push(para("This prospect hasn't taken the quiz.", { color: MUTED, italics: true }));
  }

  if (p) children.push(heading("Prep checklist"), ...p.prep.map((t) => new Paragraph({ numbering: { reference: "checks", level: 0 }, spacing: { after: 60 }, children: [text(t)] })));

  const doc = new Document({
    creator: "OnRadar CRM",
    title: `Prospect brief · ${a.name}`,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    numbering: {
      config: [
        { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] },
        { reference: "checks", levels: [{ level: 0, format: LevelFormat.BULLET, text: "☐", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 300 } } } }] },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        headers: {
          default: new Header({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [text("Confidential · client personal information", { color: MUTED, size: 16 })] })],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  text(`Prepared by OnRadar CRM for ${client.name} · Page `, { color: MUTED, size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
