"use client";

import { useActionState } from "react";
import { login, type LoginState } from "../actions/auth";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="stack" style={{ gap: 14 }}>
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="field">
        Email
        <input name="email" type="email" autoComplete="email" required autoFocus defaultValue={state.email} />
      </label>
      <label className="field">
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button className="btn accent" type="submit" disabled={pending} style={{ height: 42 }}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
