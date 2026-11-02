import "server-only";
import { inflateRawSync } from "zlib";

/**
 * Minimal .xlsx reader: returns every worksheet's cell values as text (formulas give their saved result).
 * An .xlsx file is a zip of XML parts; this reads just the parts needed, with no extra dependencies.
 */

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  // End of central directory record: last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That file isn't a valid .xlsx workbook.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/^(xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml))$/.test(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, inflateRawSync(data));
  }
  return files;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

const textOf = (xml: string) => decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

function colIndex(ref: string) {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  return [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
}

export function readXlsx(buf: Buffer): { name: string; rows: string[][] }[] {
  const files = unzip(buf);
  const wb = files.get("xl/workbook.xml")?.toString("utf8");
  if (!wb) throw new Error("That file isn't a valid .xlsx workbook.");
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/Id="([^"]+)"/)?.[1], m[0].match(/Target="([^"]+)"/)?.[1]]));
  const shared = [...(files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const sheets: { name: string; rows: string[][] }[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = decode(m[0].match(/name="([^"]*)"/)?.[1] ?? "Sheet");
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1];
    const t = rid ? target.get(rid) : undefined;
    if (!t) continue;
    const path = t.startsWith("/") ? t.slice(1) : `xl/${t.replace(/^\.\//, "")}`;
    const xml = files.get(path)?.toString("utf8");
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNum = Number(r[1].match(/r="(\d+)"/)?.[1] ?? rows.length + 1);
      const row: string[] = [];
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
        const type = attrs.match(/t="([^"]+)"/)?.[1];
        const body = c[2] ?? "";
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = "";
        if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = textOf(body);
        else if (v !== undefined) value = decode(v);
        row[ref ? colIndex(ref) : row.length] = value;
      }
      rows[rowNum - 1] = Array.from(row, (x) => x ?? "");
    }
    sheets.push({ name, rows: Array.from(rows, (x) => x ?? []) });
  }
  return sheets;
}
