import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { getAuthSecret } from "./store";
import type { Role } from "./types";

export const SESSION_COOKIE = "onradar_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

export interface SessionPayload {
  sub: string;
  role: Role;
  clientId?: string;
  name: string;
}

async function secretKey() {
  return new TextEncoder().encode(await getAuthSecret());
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(await secretKey());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await secretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};
