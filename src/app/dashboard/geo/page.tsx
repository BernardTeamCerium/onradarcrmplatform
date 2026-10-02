import { redirect } from "next/navigation";

/** Geo is admin-only; client logins are sent back to their dashboard. */
export default function ClientGeoPage() {
  redirect("/dashboard");
}
