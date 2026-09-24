import "server-only";
import { promises as fs } from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import type { Client, Database, User } from "./types";

/**
 * Storage backend. On Netlify (detected at build time, see next.config.ts) everything lives in
 * Netlify Blobs, because Netlify functions can't keep files between requests. Everywhere else it
 * lives on disk under DATA_DIR.
 */
const USE_BLOBS = process.env.STORAGE_DRIVER === "netlify-blobs";
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

async function blobStore() {
  const { getStore } = await import("@netlify/blobs");
  return getStore({ name: "onradar", consistency: "strong" });
}

async function readBytes(key: string): Promise<Buffer | null> {
  if (USE_BLOBS) {
    const data = await (await blobStore()).get(key, { type: "arrayBuffer" });
    return data ? Buffer.from(data) : null;
  }
  try {
    return await fs.readFile(path.join(DATA_DIR, key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeBytes(key: string, data: Buffer | string) {
  if (USE_BLOBS) {
    const buf = typeof data === "string" ? Buffer.from(data) : data;
    await (await blobStore()).set(key, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    return;
  }
  const file = path.join(DATA_DIR, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
}

async function deleteBytes(key: string) {
  if (USE_BLOBS) await (await blobStore()).delete(key);
  else await fs.rm(path.join(DATA_DIR, key), { force: true });
}

const DB_KEY = "db.json";
const logoKey = (name: string) => `logos/${path.basename(name)}`;

export const readLogo = (name: string) => readBytes(logoKey(name));
export const writeLogo = (name: string, data: Buffer) => writeBytes(logoKey(name), data);
export const deleteLogo = (name: string) => deleteBytes(logoKey(name));

/** Session-signing secret: AUTH_SECRET if set, otherwise a random one generated and stored on first use. */
let cachedSecret: string | null = null;
export async function getAuthSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (cachedSecret) return cachedSecret;
  const existing = await readBytes("auth-secret");
  if (existing) return (cachedSecret = existing.toString("utf8"));
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64url");
  await writeBytes("auth-secret", secret);
  return (cachedSecret = secret);
}

let writeQueue: Promise<unknown> = Promise.resolve();

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const SIBLEY_SEPTEMBER = { id: "fig_sibley_2026_09", month: "2026-09", appointments: 36, premium: 5_600_000 };

/** Upgrades data saved by older versions of the app (e.g. an already-deployed Netlify site). */
function migrate(db: Database) {
  for (const c of db.clients as (Client & { averageDealValue?: number })[]) {
    if (c.figures === undefined) {
      c.figures = c.id === "cl_sibley" ? [SIBLEY_SEPTEMBER] : [];
      if (c.id === "cl_sibley") {
        c.primaryAgent ??= "Troy Sibley";
        c.averagePremium ??= 250000;
      }
    }
    if (c.averagePremium === undefined) c.averagePremium = c.averageDealValue ?? 0;
    delete c.averageDealValue;
  }
  return db;
}

async function seed(): Promise<Database> {
  const now = new Date().toISOString();
  const sibley: Client = {
    id: "cl_sibley",
    name: "Sibley Financial Group",
    slug: "sibley-financial-group",
    industry: "Financial planning & retirement",
    brandColor: "#0a2044",
    logo: "/brand/sibley-crest.png",
    ghl: {
      locationId: "",
      apiToken: "",
      applicationStageKeywords: ["application", "submitted"],
    },
    spend: [],
    averagePremium: 250000,
    primaryAgent: "Troy Sibley",
    figures: [SIBLEY_SEPTEMBER],
    demoMode: true,
    createdAt: now,
  };
  const users: User[] = [
    {
      id: newId("usr"),
      email: (process.env.SEED_ADMIN_EMAIL || "admin@onradarcrm.com").toLowerCase(),
      name: "OnRadar Admin",
      passwordHash: await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || "OnRadarAdmin!2026", 10),
      role: "admin",
      createdAt: now,
    },
    {
      id: newId("usr"),
      email: (process.env.SEED_CLIENT_EMAIL || "demo@sibleyfinancialgroup.com").toLowerCase(),
      name: "Troy Sibley",
      passwordHash: await bcrypt.hash(process.env.SEED_CLIENT_PASSWORD || "SibleyDemo!2026", 10),
      role: "client",
      clientId: sibley.id,
      createdAt: now,
    },
  ];
  return { users, clients: [sibley] };
}

export async function readDb(): Promise<Database> {
  const raw = await readBytes(DB_KEY);
  if (raw) return migrate(JSON.parse(raw.toString("utf8")) as Database);
  const db = await seed();
  await writeDb(db);
  return db;
}

async function writeDb(db: Database) {
  await writeBytes(DB_KEY, JSON.stringify(db, null, 2));
}

/** Serialises read-modify-write cycles so concurrent requests don't clobber each other. */
export function updateDb<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const run = writeQueue.then(async () => {
    const db = await readDb();
    const result = await fn(db);
    await writeDb(db);
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

export async function getClient(id: string) {
  const db = await readDb();
  return db.clients.find((c) => c.id === id) ?? null;
}

export async function findUserByEmail(email: string) {
  const db = await readDb();
  return db.users.find((u) => u.email === email.trim().toLowerCase()) ?? null;
}
