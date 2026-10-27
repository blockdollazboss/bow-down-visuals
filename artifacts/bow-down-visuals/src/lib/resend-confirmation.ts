/* resend-confirmation — /login "Resend confirmation email" (payfix Fix 3).
 *
 * Defect (Pass 0 re-run, Oct 26): sign-in for an unconfirmed account
 * fails with Supabase's "Email not confirmed", but /login had NO resend
 * control — the user's only path was re-submitting /signup. This lib
 * carries the pure pieces of the fix so they are unit-testable:
 * unconfirmed-error detection, the Supabase resend call itself
 * (auth.resend, type "signup" — the branded confirmation template
 * installed Oct 26 is what gets sent), and the cooldown math that
 * keeps the control rate-limit friendly.
 *
 * The redirect matches signup's emailRedirectTo (/choose-artist), so a
 * resent link lands exactly where an original link lands.
 */

/** Minimum pause between resends — Supabase throttles auth emails;
 *  the control disables itself for this long after every attempt
 *  that reaches (or is throttled by) the server. */
export const RESEND_COOLDOWN_MS = 60_000;

/** True when a sign-in error means "this account's email is not
 *  confirmed yet" — the only failure the resend control answers. */
export function isUnconfirmedSignInError(
  error: string | null | undefined,
): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return (
    e.includes("email not confirmed") ||
    e.includes("email_not_confirmed") ||
    e.includes("not confirmed") ||
    e.includes("confirm your email")
  );
}

/** True when Supabase refused because of its own auth-email throttle
 *  ("For security purposes, you can only request this after …") —
 *  the control starts its cooldown on these too, instead of letting
 *  the user hammer a throttled endpoint. */
export function isResendThrottleError(
  error: string | null | undefined,
): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return (
    e.includes("security purposes") ||
    e.includes("rate limit") ||
    e.includes("too many requests") ||
    /after \d+ seconds/.test(e)
  );
}

/** Whole seconds left in a cooldown window (0 when expired/absent). */
export function cooldownSecondsLeft(
  cooldownUntil: number,
  now: number,
): number {
  if (!cooldownUntil || cooldownUntil <= now) return 0;
  return Math.ceil((cooldownUntil - now) / 1000);
}

/** Minimal structural shape of the Supabase client's resend method —
 *  lets tests drive the real helper with a fake client. */
export interface ResendCapableClient {
  auth: {
    resend: (args: {
      type: "signup";
      email: string;
      options: { emailRedirectTo: string };
    }) => Promise<{ error: { message: string } | null }>;
  };
}

/**
 * Fire ONE confirmation-email resend for `email`. Exactly one
 * client.auth.resend call per invocation — callers gate repeat clicks
 * with the sending flag + cooldown. Returns the server's error
 * message verbatim (honest copy: never fake a success).
 */
export async function resendConfirmationEmail(
  client: ResendCapableClient,
  email: string,
  origin: string,
): Promise<{ error: string | null }> {
  const { error } = await client.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${origin}/choose-artist` },
  });
  return { error: error?.message ?? null };
}
