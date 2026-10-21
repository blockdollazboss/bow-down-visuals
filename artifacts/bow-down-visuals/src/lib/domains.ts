/* ─── Custom domains — Worker 10: creator "own website" flagship ─────────────
   Shared types + API helpers + site-mode host detection.

   MAIN_SITE_URL: the Bow Down Visuals home base. Override with
   VITE_MAIN_SITE_URL at build time (staging/preview). Everywhere else links
   are RELATIVE so the full link graph (profile → store → content → social)
   works untouched on any domain that serves the app. The ONLY absolute link
   to the main site lives in the SiteMode "Powered by" badge — and it goes
   through this constant, never a hardcoded string scattered in components.
*/

export const MAIN_SITE_URL: string =
  (import.meta.env["VITE_MAIN_SITE_URL"] as string | undefined) ?? "https://bowdownvisuals.com";

function mainSiteHost(): string {
  try {
    return new URL(MAIN_SITE_URL).hostname.toLowerCase();
  } catch {
    return "bowdownvisuals.com";
  }
}

/** True for hosts that serve the normal app (never site mode). */
export function isMainAppHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().split(":")[0] ?? "";
  const main = mainSiteHost();
  return (
    h === "" ||
    h === main ||
    h === `www.${main}` ||
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".onrender.com") // Render preview deploys stay on the normal app
  );
}

/* ── Types (mirror GET /api/domains/*) ─────────────────────────────────────── */

export type DomainStatus = "pending" | "verifying" | "active" | "failed";

export interface CustomDomain {
  id: string;
  hostname: string;
  status: DomainStatus;
  is_primary: boolean;
  verified_at: string | null;
  created_at: string;
  /** Owner-only: the TXT value they must publish. Never shown to others. */
  verification_token?: string;
}

export interface DnsRecordInstruction {
  type: string;
  host: string;
  target?: string;
  value?: string;
  note: string;
}

export interface DnsInstructions {
  cname: DnsRecordInstruction;
  txt: DnsRecordInstruction;
  ssl_note: string;
  placeholder_warning: string | null;
}

export interface ClaimResult {
  domain: CustomDomain;
  dns: DnsInstructions;
  message: string;
}

export interface DnsEvidence {
  cname: string[] | null;
  txt: string[];
  errors: Record<string, string>;
}

export interface VerifyResult {
  ok: boolean;
  status?: DomainStatus;
  already_active?: boolean;
  domain?: CustomDomain;
  checks?: { cname: boolean; txt: boolean };
  site_url?: string;
  expected?: { cname_target: string; txt_host: string; txt_contains: string };
  found?: DnsEvidence;
  message: string;
}

export interface ResolveResult {
  slug: string | null;
  source: "custom" | "subdomain" | "main" | null;
}

/* ── DNS instructions (client mirror of the server's) ─────────────────────────
   GET /api/domains/mine returns the owner's verification_token, so the setup
   UI can rebuild the exact instructions without another round-trip. The CNAME
   target override (VITE_DOMAINS_CNAME_TARGET) matches the server's
   DOMAINS_CNAME_TARGET env var. */

export const CNAME_TARGET: string =
  (import.meta.env["VITE_DOMAINS_CNAME_TARGET"] as string | undefined) ?? "cname.bowdownvisuals.com";

export function dnsInstructionsFor(hostname: string, token: string): DnsInstructions {
  return {
    cname: {
      type: "CNAME",
      host: hostname,
      target: CNAME_TARGET,
      note: "Point this CNAME at your DNS provider.",
    },
    txt: {
      type: "TXT",
      host: `_bdv-verify.${hostname}`,
      value: `bdv-verify=${token}`,
      note: "Proves you own the domain. It can stay forever.",
    },
    ssl_note: "We handle SSL automatically — your site gets HTTPS the moment the domain goes live. No certificates to buy or install. 🦈",
    placeholder_warning:
      CNAME_TARGET === "cname.bowdownvisuals.com"
        ? "Heads up: the platform CNAME target is still the placeholder — our crew is wiring up the real target. Your TXT record already proves ownership."
        : null,
  };
}

/* ── API helpers ───────────────────────────────────────────────────────────── */

async function json<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went sideways. Try again. 🦈");
  return data as T;
}

function authHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

/** Public — no auth. Maps a hostname to a creator profile slug for site mode. */
export async function resolveSite(hostname: string): Promise<ResolveResult | null> {
  try {
    const res = await fetch(`/api/domains/resolve?host=${encodeURIComponent(hostname)}`);
    if (!res.ok) return null;
    return (await res.json()) as ResolveResult;
  } catch {
    return null;
  }
}

export async function fetchMyDomains(
  token: string | null,
): Promise<{ domains: CustomDomain[]; free_subdomain: string | null }> {
  const res = await fetch("/api/domains/mine", { headers: authHeaders(token) });
  return json(res);
}

export async function claimDomain(token: string | null, hostname: string): Promise<ClaimResult> {
  const res = await fetch("/api/domains", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ hostname }),
  });
  return json(res);
}

export async function verifyDomain(token: string | null, id: string): Promise<VerifyResult> {
  const res = await fetch(`/api/domains/${encodeURIComponent(id)}/verify`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return json(res);
}

export async function deleteDomain(token: string | null, id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/domains/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  return json(res);
}
