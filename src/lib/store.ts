import "server-only";
import { promises as fs } from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import type { Client, Database, User } from "./types";

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
export const LOGO_DIR = path.join(DATA_DIR, "logos");

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
    averageDealValue: 3000,
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
  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    return JSON.parse(raw) as Database;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const db = await seed();
    await writeDb(db);
    return db;
  }
}

async function writeDb(db: Database) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  await fs.rename(tmp, DB_FILE);
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
