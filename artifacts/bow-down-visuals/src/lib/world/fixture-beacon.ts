/**
 * fixture-beacon.ts — sends a fixture failure report to the site's
 * own API (POST /api/world/fixture-failure) with the signed-in
 * session's token, the way every other world lib module calls the
 * API (Bearer from the Supabase session).
 *
 * Fire-and-forget by contract: a beacon ABOUT a failure must never
 * become a failure itself. Every error is swallowed, and a missing
 * session simply means no beacon — the endpoint is authenticated,
 * and a guest's world still heals via the slow ring; it just can't
 * phone the failure home.
 */
import { getSupabase } from "../supabase";
import type { FixtureFailureReport } from "./guard-fixtures";

export async function sendFixtureFailureReport(report: FixtureFailureReport): Promise<void> {
  try {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/api/world/fixture-failure", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(report),
      keepalive: true,
    });
  } catch {
    /* Silent by design — see the header. */
  }
}
