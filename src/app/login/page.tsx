import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Brandmark } from "@/components/Brandmark";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await currentUser();
  if (user) redirect(user.role === "admin" ? "/admin" : "/dashboard");
  const { next } = await searchParams;
  const showDemo = process.env.SHOW_DEMO_LOGINS !== "false";

  return (
    <main className="login-wrap">
      <div className="card login-card">
        <div className="brandmark">
          <Brandmark />
        </div>
        <p className="muted small" style={{ textAlign: "center", marginBottom: 22 }}>
          Client performance dashboard. Sign in to see your results.
        </p>
        <LoginForm next={next} />
        {showDemo && (
          <div className="demo-creds">
            <div><b>Demo logins</b> (set in <code>.env</code>)</div>
            <div>Admin: <code>{process.env.SEED_ADMIN_EMAIL || "admin@onradarcrm.com"}</code></div>
            <div>Client: <code>{process.env.SEED_CLIENT_EMAIL || "demo@sibleyfinancialgroup.com"}</code></div>
          </div>
        )}
      </div>
    </main>
  );
}
