import Link from "next/link";

/** Section tabs for one client. `base` is the dashboard URL (/dashboard or /admin/clients/<id>). */
export function ClientTabs({ base, active, admin }: { base: string; active: "dashboard" | "leads" | "settings"; admin?: boolean }) {
  const tabs = [
    { key: "dashboard", label: "Dashboard", href: base },
    { key: "leads", label: "Leads", href: `${base}/leads` },
    ...(admin ? [{ key: "settings", label: "Settings", href: `${base}/settings` }] : []),
  ];
  return (
    <nav className="tabs" aria-label="Client sections">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
