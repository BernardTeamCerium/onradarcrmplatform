import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { createClient } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const user = await requireAdmin();
  const { msg } = await searchParams;
  return (
    <AppShell user={user} active="overview">
      <div className="stack" style={{ maxWidth: 760 }}>
        <p className="small"><Link href="/admin" className="muted">← All clients</Link></p>
        <h1>New client</h1>
        {msg && <p className="flash">{msg}</p>}
        <form action={createClient} className="card stack">
          <div className="form-grid">
            <label className="field">Company name<input name="name" required placeholder="Acme Insurance Group" /></label>
            <label className="field">Industry<input name="industry" placeholder="Financial services" /></label>
            <label className="field">Brand color<input name="brandColor" type="color" defaultValue="#1f3a5f" /></label>
            <label className="field">Logo<input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" /><span className="hint">PNG, JPG, WEBP or SVG, up to 2 MB</span></label>
          </div>
          <h3>GoHighLevel sub-account (optional, can be added later)</h3>
          <div className="form-grid">
            <label className="field">Location ID<input name="locationId" placeholder="e.g. ve9EPM428h8vShlRW1KT" /></label>
            <label className="field">Private Integration token<input name="apiToken" type="password" autoComplete="off" placeholder="pit-…" /></label>
            <label className="field">Average revenue per sale ($)<input name="averageDealValue" type="number" min="0" step="1" defaultValue="0" /><span className="hint">Used when a won deal has no value in GoHighLevel</span></label>
          </div>
          <div className="form-actions"><button className="btn primary" type="submit">Create client</button></div>
        </form>
      </div>
    </AppShell>
  );
}
