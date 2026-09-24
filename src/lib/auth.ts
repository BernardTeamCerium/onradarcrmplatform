import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readDb } from "./store";
import { SESSION_COOKIE, verifySession } from "./session";

/** Returns the signed-in user, re-read from the store so deleted users lose access immediately. */
export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;
  const db = await readDb();
  return db.users.find((u) => u.id === session.sub) ?? null;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}
