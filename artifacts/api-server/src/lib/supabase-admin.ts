import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";

let _adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url) {
    throw new Error("SUPABASE_URL is not configured. Add it to Replit Secrets.");
  }
  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Add it to Replit Secrets so Stripe payments can update credits securely."
    );
  }

  if (!_adminClient) {
    _adminClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    logger.info("Supabase admin client initialised (service role)");
  }
  return _adminClient;
}

/**
 * Add credits to a user's profile. Uses the service role client so RLS
 * is bypassed. Creates the profile row if it does not already exist.
 *
 * Returns { oldCredits, newCredits } on success.
 * Throws on any error so callers can handle/log appropriately.
 */
export async function addCreditsToProfile(
  userId: string,
  creditsToAdd: number
): Promise<{ oldCredits: number; newCredits: number; created: boolean }> {
  const admin = getSupabaseAdmin();

  // Fetch existing profile
  logger.info({ userId }, "addCreditsToProfile: fetching profile");
  const { data: profile, error: fetchError } = await admin
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();

  if (fetchError && fetchError.code !== "PGRST116") {
    // PGRST116 = "row not found" — any other error is a real problem
    logger.error({ err: fetchError, userId }, "addCreditsToProfile: fetch error");
    throw new Error(`Failed to fetch profile: ${fetchError.message}`);
  }

  const profileExists = !fetchError && profile != null;
  const oldCredits = profileExists ? ((profile.credits as number) ?? 0) : 0;
  const newCredits = oldCredits + creditsToAdd;

  if (!profileExists) {
    // Fallback: create the profile row with the purchased credits
    logger.warn({ userId, creditsToAdd }, "addCreditsToProfile: profile not found — creating row");
    const { error: insertError } = await admin
      .from("profiles")
      .insert({ id: userId, credits: creditsToAdd });

    if (insertError) {
      logger.error({ err: insertError, userId }, "addCreditsToProfile: insert failed");
      throw new Error(`Failed to create profile: ${insertError.message}`);
    }

    logger.info({ userId, creditsToAdd, newCredits }, "addCreditsToProfile: profile created with credits");
    return { oldCredits: 0, newCredits: creditsToAdd, created: true };
  }

  logger.info({ userId, oldCredits, creditsToAdd, newCredits }, "addCreditsToProfile: updating credits");

  const { error: updateError } = await admin
    .from("profiles")
    .update({ credits: newCredits })
    .eq("id", userId);

  if (updateError) {
    logger.error({ err: updateError, userId }, "addCreditsToProfile: update failed");
    throw new Error(`Failed to update credits: ${updateError.message}`);
  }

  logger.info({ userId, oldCredits, newCredits }, "addCreditsToProfile: credits updated successfully");
  return { oldCredits, newCredits, created: false };
}

/**
 * Atomically add credits to a user's profile via the increment_credits RPC
 * (UPDATE ... SET credits = credits + n inside Postgres). Eliminates the
 * lost-update race in addCreditsToProfile()'s read-modify-write when two
 * grants land concurrently (e.g. Stripe webhook racing dashboard verify).
 *
 * Falls back to addCreditsToProfile() if the RPC is missing (migration
 * 0062 not yet run in Supabase) — logged as a warning so the gap is visible.
 *
 * Returns { oldCredits, newCredits, created }. Throws on failure.
 */
export async function addCreditsAtomic(
  userId: string,
  creditsToAdd: number,
): Promise<{ oldCredits: number; newCredits: number; created: boolean }> {
  const admin = getSupabaseAdmin();
  try {
    const { data, error } = await admin.rpc("increment_credits", {
      p_user_id: userId,
      p_amount: creditsToAdd,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.new_credits !== "number") {
      throw new Error(`increment_credits returned unexpected shape: ${JSON.stringify(data)}`);
    }
    logger.info(
      { userId, creditsToAdd, oldCredits: row.old_credits, newCredits: row.new_credits },
      "addCreditsAtomic: credits incremented atomically via RPC",
    );
    return { oldCredits: row.old_credits ?? 0, newCredits: row.new_credits, created: false };
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? "";
    // Function missing (migration not run yet) — fall back with a loud warning.
    if (/function.*increment_credits.*does not exist/i.test(msg) || /PGRST202/i.test(msg)) {
      logger.warn(
        { userId, creditsToAdd },
        "addCreditsAtomic: increment_credits RPC missing (run supabase/migrations/0062) — falling back to read-modify-write",
      );
      return addCreditsToProfile(userId, creditsToAdd);
    }
    throw err;
  }
}
