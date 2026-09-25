import type { Client } from "@/lib/types";
import { ClientLogo } from "./ClientLogo";

export function ClientHeader({ client, subtitle, children }: { client: Client; subtitle: string; children?: React.ReactNode }) {
  return (
    <>
      <div className="accent-bar" style={{ background: client.brandColor, marginBottom: 0 }} />
      <div className="client-header">
        <ClientLogo client={client} />
        <div className="titles">
          <h1>{client.name}</h1>
          <p className="muted small">{subtitle}</p>
        </div>
        {children && <div className="row">{children}</div>}
      </div>
    </>
  );
}
