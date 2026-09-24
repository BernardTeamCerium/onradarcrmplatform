import Link from "next/link";
import { logout } from "@/app/actions/auth";
import type { Client, User } from "@/lib/types";
import { Brandmark } from "./Brandmark";
import { ClientLogo } from "./ClientLogo";

export function AppShell({
  user,
  client,
  active,
  children,
}: {
  user: User;
  client?: Client | null;
  active?: "overview" | "clients" | "users" | "dashboard";
  children: React.ReactNode;
}) {
  const isAdmin = user.role === "admin";
  return (
    <>
      <header className="topbar">
        <Link href={isAdmin ? "/admin" : "/dashboard"} className="brandmark">
          <Brandmark />
        </Link>
        {isAdmin && (
          <nav className="topnav" aria-label="Admin">
            <Link href="/admin" aria-current={active === "overview" ? "page" : undefined}>Clients</Link>
            <Link href="/admin/users" aria-current={active === "users" ? "page" : undefined}>Users</Link>
          </nav>
        )}
        <div className="spacer" />
        <div className="userchip">
          {!isAdmin && client && <ClientLogo client={client} size="sm" />}
          <span className="name">{user.name}</span>
          <form action={logout}>
            <button className="btn sm" type="submit">Sign out</button>
          </form>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
