import { redirect } from "next/navigation";

/** Marketing is admin-only; client logins are sent back to their dashboard. */
export default function ClientMarketingPage() {
  redirect("/dashboard");
}
