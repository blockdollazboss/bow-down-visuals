// Shared Postgres SSL config for node-postgres pools.
//
// Render's *external* Postgres URLs (used when running a service off Render,
// e.g. local dev on a Mac) sit behind a TLS proxy that requires SNI (Server
// Name Indication) in the TLS handshake. node-postgres does not reliably send
// the TLS servername when SSL is only enabled via `?sslmode=require` in the
// connection string, so the proxy rejects the connection ("No SNI information
// found"). Configuring `ssl.servername` explicitly fixes it.
//
// On Render itself DATABASE_URL is the internal hostname with no sslmode,
// so this returns undefined and pool behavior is unchanged.
import type { PoolConfig } from "pg";

export function pgSslConfig(connectionString: string): PoolConfig["ssl"] {
  let hostname = "";
  let sslmode = "";
  try {
    const url = new URL(connectionString);
    hostname = url.hostname;
    sslmode = url.searchParams.get("sslmode") ?? "";
  } catch {
    return undefined;
  }
  if (!hostname || !sslmode || sslmode === "disable" || sslmode === "allow") {
    return undefined;
  }
  return {
    // Send SNI so the proxy can route to the right database.
    servername: hostname,
    // The proxy terminates TLS; encrypt in transit without pinning its cert.
    rejectUnauthorized: false,
  };
}
