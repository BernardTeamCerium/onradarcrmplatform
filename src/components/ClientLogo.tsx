import type { Client } from "@/lib/types";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function logoSrc(client: Client) {
  if (!client.logo) return null;
  if (/^(https?:\/\/|\/)/.test(client.logo)) return client.logo;
  return `/api/logo/${client.id}?v=${encodeURIComponent(client.logo)}`;
}

export function ClientLogo({ client, size }: { client: Client; size?: "sm" }) {
  const src = logoSrc(client);
  const cls = `logo-tile${size ? ` ${size}` : ""}`;
  if (src) {
    return (
      <div className={cls}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${client.name} logo`} />
      </div>
    );
  }
  return (
    <div className={`${cls} monogram`} style={{ background: client.brandColor }} aria-label={`${client.name} logo`}>
      {initials(client.name)}
    </div>
  );
}
