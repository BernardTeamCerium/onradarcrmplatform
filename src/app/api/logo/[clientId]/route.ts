import path from "path";
import { currentUser } from "@/lib/auth";
import { getClient, readLogo } from "@/lib/store";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.clientId !== clientId)) {
    return new Response("Not found", { status: 404 });
  }
  const client = await getClient(clientId);
  if (!client?.logo || /^(https?:|\/)/.test(client.logo)) return new Response("Not found", { status: 404 });

  const body = await readLogo(client.logo);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": TYPES[path.extname(client.logo).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
      // Uploaded SVGs must never run script.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
