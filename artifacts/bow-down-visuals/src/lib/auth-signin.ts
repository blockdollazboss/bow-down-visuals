/* auth-signin.ts — bounded email/password sign-in (stack800 lane 4).
 *
 * Why this exists: AuthContext.signIn used to await Supabase's
 * signInWithPassword (and then the profile fetch) with NO time bound
 * anywhere on the path. Supabase's auth client accepts no abort
 * signal, so a connection that opened and then stalled left the
 * promise pending forever — the Gate #4 run (Oct 28–29) watched the
 * login button sit on "Signing in…" for 45–60 s at least three times
 * before the browser gave up and the raw "Failed to fetch" TypeError
 * text was shown as if it were an account problem. Credential errors
 * and "the site is unreachable" were indistinguishable.
 *
 * Contract:
 *  - Every attempt is bounded by a settle timeout (default 15 s —
 *    the same bound AuthContext's bootstrap race already uses). A
 *    timed-out attempt is a TRANSPORT failure, never a verdict on
 *    the credentials.
 *  - Transport failures and auth-server 5xx answers are retried
 *    exactly once (2 attempts total, short backoff): sign-in with
 *    the same credentials is idempotent, so the retry can never
 *    create a second account state.
 *  - A server decision (4xx — invalid credentials, unconfirmed
 *    email, …) is NEVER retried and its message passes through
 *    verbatim: the login page's unconfirmed-email resend flow keys
 *    off that exact text.
 *  - Terminal copy is honest about which world failed, in the
 *    checkoutFailureCopy shape: "couldn't reach" only when nothing
 *    answered; a server that answered with an error is named as
 *    such, with its status.
 *
 * Abandoned-attempt note (honest): a timed-out attempt is not
 * cancelled — the auth client offers no cancellation. If it lands
 * late and succeeds, Supabase persists the session and fires
 * onAuthStateChange, which AuthContext already treats as the
 * sign-in it is. The bound exists so the PERSON is never held
 * hostage by a stalled socket, not to pretend the request died. */

import type { SupabaseClient } from "@supabase/supabase-js";

export const SIGN_IN_ATTEMPT_TIMEOUT_MS = 15_000;
export const SIGN_IN_MAX_ATTEMPTS = 2;
export const SIGN_IN_RETRY_BACKOFF_MS = 800;

/** Raised when an attempt does not settle inside its bound. */
export class SignInTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Sign-in attempt did not settle within ${timeoutMs}ms`);
    this.name = "SignInTimeoutError";
  }
}

export type SignInFailureKind = "credentials" | "transport" | "server";

export type SignInOutcome<TUser extends { id: string } = { id: string }> =
  | { ok: true; user: TUser | null }
  | { ok: false; error: string; failure: SignInFailureKind };

/** The slice of an auth error this module reads. Supabase's AuthError
 *  carries `name` + `status`; a plain thrown Error carries neither. */
export interface AuthErrorLike {
  message: string;
  name?: string;
  status?: number;
}

export interface PasswordSignInResult<TUser extends { id: string } = { id: string }> {
  data: { user: TUser | null };
  error: AuthErrorLike | null;
}

export type PasswordSignInFn<TUser extends { id: string } = { id: string }> = (
  email: string,
  password: string,
) => Promise<PasswordSignInResult<TUser>>;

export interface SignInDeps<TUser extends { id: string } = { id: string }> {
  signIn: PasswordSignInFn<TUser>;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Race a promise against a settle bound. The underlying work is NOT
 *  cancelled (see the header note) — the race only decides how long
 *  the caller waits. Also used by AuthContext to keep the post-sign-in
 *  profile fetch from holding the login button hostage. */
export async function settleWithin<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SignInTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* Classify one attempt's error. Transport = nothing usable answered
 * (the auth client's retryable-fetch error, a thrown network error,
 * our own settle timeout). Server = the auth server answered 5xx.
 * Everything else is a server DECISION about the credentials and
 * passes through untouched. */
export function classifySignInError(err: unknown): SignInFailureKind {
  if (err instanceof SignInTimeoutError) return "transport";
  const e = err as AuthErrorLike | null | undefined;
  if (e && e.name === "AuthRetryableFetchError") return "transport";
  if (e && typeof e.status === "number") {
    return e.status >= 500 ? "server" : "credentials";
  }
  /* A thrown value with no HTTP status: the fetch layer died before
   * any answer existed (TypeError "Failed to fetch" and friends). */
  if (err instanceof Error) return "transport";
  return "credentials";
}

/** Terminal buyer-facing copy per failure kind, checkout-fetch shape:
 *  "couldn't reach" is reserved for the case where truly nothing
 *  answered; a server that answered is named as a server error. */
export function signInFailureCopy(kind: SignInFailureKind, err: unknown): string {
  if (kind === "transport") {
    return "Couldn't reach the sign-in server. Check your connection and try again.";
  }
  if (kind === "server") {
    const status = (err as AuthErrorLike | null | undefined)?.status;
    return typeof status === "number"
      ? `The sign-in server hit an error (HTTP ${status}). Give it a moment and try again.`
      : "The sign-in server hit an error. Give it a moment and try again.";
  }
  const message = (err as AuthErrorLike | null | undefined)?.message;
  return message && message.trim() ? message : "Login failed";
}

/**
 * Bounded, once-retried password sign-in. Resolves an outcome for
 * every path — it never throws for an auth/transport failure, so the
 * caller's loading state always settles.
 */
export async function signInWithPasswordBounded<TUser extends { id: string } = { id: string }>(
  deps: SignInDeps<TUser>,
  email: string,
  password: string,
): Promise<SignInOutcome<TUser>> {
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutMs = deps.timeoutMs ?? SIGN_IN_ATTEMPT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, deps.maxAttempts ?? SIGN_IN_MAX_ATTEMPTS);
  const backoffMs = deps.backoffMs ?? SIGN_IN_RETRY_BACKOFF_MS;

  let lastError: unknown = null;
  let lastKind: SignInFailureKind = "transport";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(backoffMs);
    try {
      const { data, error } = await settleWithin(deps.signIn(email, password), timeoutMs);
      if (!error) {
        return { ok: true, user: data.user };
      }
      lastError = error;
      lastKind = classifySignInError(error);
    } catch (err) {
      lastError = err;
      lastKind = classifySignInError(err);
    }
    /* A decision about the credentials is final — retrying the same
     * email/password can only produce the same answer, slower. */
    if (lastKind === "credentials") break;
  }
  return { ok: false, error: signInFailureCopy(lastKind, lastError), failure: lastKind };
}

/** Adapter: wire the bounded core to a real Supabase client. The
 *  client's User object passes through untouched so AuthContext can
 *  set it exactly as the unbounded call used to. */
export function signInWithSupabase(
  client: SupabaseClient,
  email: string,
  password: string,
  opts: Omit<SignInDeps, "signIn"> = {},
) {
  return signInWithPasswordBounded(
    {
      ...opts,
      signIn: async (e: string, p: string) => {
        const { data, error } = await client.auth.signInWithPassword({
          email: e,
          password: p,
        });
        return {
          data: { user: data.user },
          error: error ? { message: error.message, name: error.name, status: error.status } : null,
        };
      },
    },
    email,
    password,
  );
}
