import type { Request } from "express";
import { getSupabaseAdmin } from "./supabase-admin";

/* ── Admin identity — THE one definition ──────────────────────────────────
   Admin identity is the ADMIN_EMAILS allowlist (comma-separated,
   case-insensitive), fail-closed: an unset/empty allowlist means NOBODY
   is an admin. This module is the single home of that predicate — the
   rule routes/admin.ts requireAdmin has always enforced (the admin
   credits rail's guard). Every other surface (credits lockdown,
   operator executor, tier gates, rate-limiter skips, upload caps…)
   delegates here instead of re-parsing the env var, so the definition
   can never drift.

   Owner directive (Oct 29, 2026): "My account shouldn't have
   restrictions like customers." POLICY restrictions (rate pacing,
   daily caps, tier gates, policy duration/size caps, cooldowns) exempt
   admins through these helpers. TECHNICAL limits (provider hard caps,
   in-memory upload buffers on a 512 MB instance, shared-room capacity)
   stay for everyone and are catalogued in
   ~/workspace/stack900-admin-unrestricted-report.md.               */

/** The parsed ADMIN_EMAILS allowlist: trimmed, lower-cased, non-empty. */
export function adminEmails(): string[] {
  return (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** The requireAdmin rule, pure: is this email on the allowlist? */
export function isAdminEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return !!e && adminEmails().includes(e);
}

/** Is the signed-in caller on this request an admin? Reads the email
    requireAuth resolved onto the request — call only after auth. */
export function isAdminRequest(req: Pick<Request, "userEmail">): boolean {
  return isAdminEmail(req.userEmail);
}

/** express-rate-limit `skip` predicate: admin requests never burn a
    rate-limit bucket and are never refused by one. Only meaningful on
    limiters mounted AFTER requireAuth (identity resolved); on a
    pre-auth limiter it simply never matches. */
export function skipIfAdmin(req: Pick<Request, "userEmail">): boolean {
  return isAdminRequest(req);
}

/**
 * Async form for userId-keyed paths (the credits-lockdown rule):
 * resolve the account's email from its Supabase profile and check the
 * allowlist. Fail-closed at every step: empty allowlist → false,
 * missing profile → false, lookup error → false.
 */
export async function isAdminUserId(userId: string): Promise<boolean> {
  const list = adminEmails();
  if (list.length === 0 || !userId) return false;
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .single();
    if (error || !data) return false;
    const email = (data as { email?: string }).email?.toLowerCase() ?? "";
    return list.includes(email);
  } catch {
    return false;
  }
}
