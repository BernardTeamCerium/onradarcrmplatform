import { AppShell } from "@/components/AppShell";
import { createUser, deleteUser } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { readDb } from "@/lib/store";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const user = await requireAdmin();
  const { msg } = await searchParams;
  const db = await readDb();
  const clientName = (id?: string) => db.clients.find((c) => c.id === id)?.name ?? "—";

  return (
    <AppShell user={user} active="users">
      <div className="stack">
        <div>
          <h1>Users</h1>
          <p className="muted small">Admins see every client. Client users see only their own company.</p>
        </div>
        {msg && <p className="flash" role="status">{msg}</p>}
        <section className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Client</th><th /></tr></thead>
              <tbody>
                {db.users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td><span className="badge">{u.role === "admin" ? "Admin" : "Client"}</span></td>
                    <td>{u.role === "admin" ? <span className="muted">All clients</span> : clientName(u.clientId)}</td>
                    <td style={{ textAlign: "right" }}>
                      {u.id !== user.id && (
                        <form action={deleteUser}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button className="btn sm danger" type="submit">Remove</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Add a user</h2></div>
          <form action={createUser} className="form-grid" style={{ alignItems: "end" }}>
            <label className="field">Name<input name="name" /></label>
            <label className="field">Email<input name="email" type="email" required /></label>
            <label className="field">Password<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label>
            <label className="field">
              Role
              <select name="role" defaultValue="client">
                <option value="client">Client user</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className="field">
              Client (for client users)
              <select name="clientId" defaultValue="">
                <option value="">—</option>
                {db.clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <div><button className="btn primary" type="submit">Add user</button></div>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
