import { getSupabaseAdmin } from "./supabase-admin";
import { logger } from "./logger";

/**
 * Atomically increment an NFC profile's tap_count via the
 * increment_nfc_tap RPC (supabase/migrations/0064): a single
 * UPDATE ... SET tap_count = tap_count + 1 inside Postgres, so
 * concurrent taps of the same card serialize on the row lock and no
 * tap is lost. The route used to read tap_count and write old + 1 —
 * two taps racing read the same value and one increment vanished.
 *
 * `currentTapCount` is the value the caller already read for this
 * profile; it is used ONLY by the pre-0064 fallback below and never
 * touches the atomic path.
 *
 * Falls back to the legacy read-value write if the RPC is missing
 * (migration 0064 not yet run in Supabase) — logged as a warning so
 * the gap is visible, exactly like addCreditsAtomic (0062) and
 * addBonusCredits (0063). That fallback is the old racy shape: it
 * exists only so taps keep counting during the deploy-before-run
 * window, and it disappears as soon as 0064 is run. Any other RPC
 * failure throws — it is NOT masked by the fallback.
 *
 * Returns the new tap_count, or null when no profile row matched the
 * slug (the tap never creates a row). Throws on failure; callers for
 * whom the count is best-effort analytics catch and swallow.
 */
export async function incrementNfcTapCount(
  slug: string,
  currentTapCount: number,
): Promise<number | null> {
  const admin = getSupabaseAdmin();
  try {
    const { data, error } = await admin.rpc("increment_nfc_tap", {
      p_slug: slug,
    });
    if (error) throw error;
    // RETURNS INTEGER: data is the new count as a bare number, or null
    // when the UPDATE matched no row.
    if (data === null || data === undefined) return null;
    if (typeof data !== "number") {
      throw new Error(`increment_nfc_tap returned unexpected shape: ${JSON.stringify(data)}`);
    }
    return data;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const haystack = `${e?.code ?? ""} ${e?.message ?? ""}`;
    // Function missing (migration not run yet) — fall back with a loud warning.
    if (
      !/function.*increment_nfc_tap.*does not exist/i.test(haystack) &&
      !/PGRST202/i.test(haystack)
    ) {
      throw err instanceof Error
        ? err
        : new Error(`Failed to increment tap count: ${e?.message ?? "unknown error"}`);
    }
    logger.warn(
      { slug },
      "incrementNfcTapCount: increment_nfc_tap RPC missing (run supabase/migrations/0064) — falling back to read-then-write",
    );
  }

  // Legacy fallback (pre-0064 only): write the value the caller read + 1.
  const { error } = await admin
    .from("nfc_profiles")
    .update({ tap_count: currentTapCount + 1, updated_at: new Date().toISOString() })
    .eq("slug", slug);
  if (error) throw new Error(`Failed to increment tap count: ${error.message}`);
  return currentTapCount + 1;
}
