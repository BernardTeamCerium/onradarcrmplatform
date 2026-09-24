"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findUserByEmail } from "@/lib/store";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";

export interface LoginState {
  error?: string;
  email?: string;
}

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "");

  const user = await findUserByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "That email and password don't match an account.", email };
  }

  const token = await signSession({ sub: user.id, role: user.role, clientId: user.clientId, name: user.name });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);

  const home = user.role === "admin" ? "/admin" : "/dashboard";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "";
  redirect(user.role === "admin" ? safeNext || home : safeNext.startsWith("/dashboard") ? safeNext : home);
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
