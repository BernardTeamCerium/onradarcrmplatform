"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getLocation } from "@/lib/ghl";
import { clearMetricsCache } from "@/lib/metrics";
import { deleteLogo, getClient, newId, slugify, updateDb, writeLogo } from "@/lib/store";
import type { Client, Role } from "@/lib/types";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const settingsPath = (id: string, msg: string) => `/admin/clients/${id}/settings?msg=${encodeURIComponent(msg)}`;

async function mutateClient(id: string, fn: (c: Client) => void) {
  await updateDb((db) => {
    const client = db.clients.find((c) => c.id === id);
    if (!client) throw new Error("Client not found");
    fn(client);
  });
  clearMetricsCache(id);
  revalidatePath("/", "layout");
}

const LOGO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

async function saveLogo(clientId: string, file: File) {
  const ext = LOGO_EXT[file.type];
  if (!ext) throw new Error("Logo must be a PNG, JPG, WEBP, or SVG file.");
  if (file.size > 2 * 1024 * 1024) throw new Error("Logo must be under 2 MB.");
  const name = `${clientId}-${Date.now()}${ext}`;
  await writeLogo(name, Buffer.from(await file.arrayBuffer()));
  return name;
}

export async function createClient(form: FormData) {
  await requireAdmin();
  const name = str(form, "name");
  if (!name) redirect("/admin/clients/new?msg=Name+is+required");
  const id = newId("cl");
  await updateDb((db) => {
    db.clients.push({
      id,
      name,
      slug: slugify(name),
      industry: str(form, "industry") || undefined,
      brandColor: str(form, "brandColor") || "#1f3a5f",
      ghl: { locationId: str(form, "locationId"), apiToken: str(form, "apiToken"), applicationStageKeywords: ["application", "submitted"] },
      spend: [],
      averagePremium: Number(str(form, "averagePremium")) || 0,
      figures: [],
      demoMode: !str(form, "apiToken"),
      createdAt: new Date().toISOString(),
    });
  });
  const logo = form.get("logo");
  if (logo instanceof File && logo.size > 0) {
    try {
      const file = await saveLogo(id, logo);
      await mutateClient(id, (c) => (c.logo = file));
    } catch (err) {
      redirect(settingsPath(id, `Client created, but the logo was not saved: ${(err as Error).message}`));
    }
  }
  revalidatePath("/admin");
  redirect(settingsPath(id, "Client created. Add ad spend and a login for them below."));
}

export async function updateProfile(form: FormData) {
  await requireAdmin();
  const id = str(form, "clientId");
  const logo = form.get("logo");
  let logoFile: string | undefined;
  if (logo instanceof File && logo.size > 0) {
    try {
      logoFile = await saveLogo(id, logo);
    } catch (err) {
      redirect(settingsPath(id, (err as Error).message));
    }
  }
  const previous = (await getClient(id))?.logo;
  await mutateClient(id, (c) => {
    c.name = str(form, "name") || c.name;
    c.slug = slugify(c.name);
    c.industry = str(form, "industry") || undefined;
    c.brandColor = str(form, "brandColor") || c.brandColor;
    c.averagePremium = Math.max(0, Number(str(form, "averagePremium")) || 0);
    c.primaryAgent = str(form, "primaryAgent") || undefined;
    if (logoFile) c.logo = logoFile;
  });
  if (logoFile && previous && !/^(https?:|\/)/.test(previous)) {
    await deleteLogo(previous);
  }
  redirect(settingsPath(id, "Profile saved."));
}

export async function removeLogo(form: FormData) {
  await requireAdmin();
  const id = str(form, "clientId");
  const previous = (await getClient(id))?.logo;
  await mutateClient(id, (c) => (c.logo = undefined));
  if (previous && !/^(https?:|\/)/.test(previous)) await deleteLogo(previous);
  redirect(settingsPath(id, "Logo removed."));
}

export async function updateGhl(form: FormData) {
  await requireAdmin();
  const id = str(form, "clientId");
  const token = str(form, "apiToken");
  await mutateClient(id, (c) => {
    c.ghl.locationId = str(form, "locationId");
    if (token) c.ghl.apiToken = token;
    if (form.get("clearToken") === "on") c.ghl.apiToken = "";
    c.ghl.applicationStageKeywords = str(form, "applicationStageKeywords")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    c.demoMode = form.get("demoMode") === "on";
  });
  redirect(settingsPath(id, "CRM connection saved."));
}

export async function testConnection(form: FormData) {
  await requireAdmin();
  const id = str(form, "clientId");
  const client = await getClient(id);
  if (!client?.ghl.apiToken || !client.ghl.locationId) {
    redirect(settingsPath(id, "Add a Location ID and Private Integration token first."));
  }
  let msg: string;
  try {
    const loc = await getLocation({ locationId: client.ghl.locationId, apiToken: client.ghl.apiToken });
    msg = `Connected to CRM sub-account "${loc.name}".`;
  } catch (err) {
    msg = `Connection failed: ${(err as Error).message}`;
  }
  redirect(settingsPath(id, msg));
}

export async function addSpend(form: FormData) {
  await requireAdmin();
  const id = str(form, "clientId");
  const month = str(form, "month");
  const amount = Number(str(form, "amount"));
  if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(amount) || amount < 0) {
    redirect(settingsPath(id, "Enter a month and a spend amount of 0 or more."));
  }
  await mutateClient(id, (c) => {
    c.spend.push({ id: newId("sp"), month, amount, note: str(form, "note") || undefined });
    c.spend.sort((a, b) => b.month.localeCompare(a.month));
  });
  redirect(settingsPath(id, "Ad spend added."));
}

export async function deleteSpend(form: FormData) {
  await requireAdmin();
  const id = str(form, "clientId");
  const spendId = str(form, "spendId");
  await mutateClient(id, (c) => (c.spend = c.spend.filter((s) => s.id !== spendId)));
  redirect(settingsPath(id, "Ad spend entry removed."));
}

export async function saveFigures(form: FormData) {
  await requireAdmin();
  const id = str(form, "clientId");
  const month = str(form, "month");
  const num = (key: string) => {
    const v = str(form, key).replace(/[$,\s]/g, "");
    return v === "" ? undefined : Number(v);
  };
  const appointments = num("appointments");
  const premium = num("premium");
  const bad = (v: number | undefined) => v !== undefined && (!Number.isFinite(v) || v < 0);
  if (!/^\d{4}-\d{2}$/.test(month) || bad(appointments) || bad(premium) || (appointments === undefined && premium === undefined)) {
    redirect(settingsPath(id, "Enter a month and at least one figure (0 or more)."));
  }
  await mutateClient(id, (c) => {
    c.figures = c.figures.filter((f) => f.month !== month);
    c.figures.push({ id: newId("fig"), month, appointments: appointments === undefined ? undefined : Math.round(appointments), premium });
    c.figures.sort((a, b) => b.month.localeCompare(a.month));
  });
  redirect(settingsPath(id, "Monthly figures saved."));
}

export async function deleteFigures(form: FormData) {
  await requireAdmin();
  const id = str(form, "clientId");
  const figId = str(form, "figId");
  await mutateClient(id, (c) => (c.figures = c.figures.filter((f) => f.id !== figId)));
  redirect(settingsPath(id, "Monthly figures removed."));
}

export async function deleteClient(form: FormData) {
  await requireAdmin();
  const id = str(form, "clientId");
  if (str(form, "confirm") !== "DELETE") redirect(settingsPath(id, 'Type DELETE to confirm removing this client.'));
  await updateDb((db) => {
    db.clients = db.clients.filter((c) => c.id !== id);
    db.users = db.users.filter((u) => u.clientId !== id);
  });
  clearMetricsCache(id);
  revalidatePath("/admin");
  redirect("/admin");
}

export async function createUser(form: FormData) {
  await requireAdmin();
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  const role = (str(form, "role") === "admin" ? "admin" : "client") as Role;
  const clientId = str(form, "clientId") || undefined;
  const back = str(form, "returnTo") || "/admin/users";
  const sep = back.includes("?") ? "&" : "?";
  const fail = (m: string) => redirect(`${back}${sep}msg=${encodeURIComponent(m)}`);

  if (!email || !email.includes("@")) fail("Enter a valid email.");
  if (password.length < 8) fail("Password must be at least 8 characters.");
  if (role === "client" && !clientId) fail("Choose which client this user belongs to.");

  const ok = await updateDb(async (db) => {
    if (db.users.some((u) => u.email === email)) return false;
    db.users.push({
      id: newId("usr"),
      email,
      name: str(form, "name") || email,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      clientId: role === "client" ? clientId : undefined,
      createdAt: new Date().toISOString(),
    });
    return true;
  });
  if (!ok) fail("A user with that email already exists.");
  revalidatePath("/admin", "layout");
  redirect(`${back}${sep}msg=${encodeURIComponent(`Login created for ${email}.`)}`);
}

export async function resetPassword(form: FormData) {
  await requireAdmin();
  const userId = str(form, "userId");
  const password = str(form, "password");
  const back = str(form, "returnTo") || "/admin/users";
  const sep = back.includes("?") ? "&" : "?";
  if (password.length < 8) redirect(`${back}${sep}msg=${encodeURIComponent("Password must be at least 8 characters.")}`);
  const hash = await bcrypt.hash(password, 10);
  await updateDb((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (u) u.passwordHash = hash;
  });
  redirect(`${back}${sep}msg=${encodeURIComponent("Password updated.")}`);
}

export async function deleteUser(form: FormData) {
  const admin = await requireAdmin();
  const userId = str(form, "userId");
  const back = str(form, "returnTo") || "/admin/users";
  const sep = back.includes("?") ? "&" : "?";
  if (userId === admin.id) redirect(`${back}${sep}msg=${encodeURIComponent("You can't delete your own account.")}`);
  await updateDb((db) => {
    db.users = db.users.filter((u) => u.id !== userId);
  });
  revalidatePath("/admin", "layout");
  redirect(`${back}${sep}msg=${encodeURIComponent("User removed.")}`);
}
