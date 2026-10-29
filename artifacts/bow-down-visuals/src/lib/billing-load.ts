/* billing-load.ts — bounded, classified load for Settings → Billing
 * (stack800 lane 4), following the lib/earnings-data.ts deps pattern.
 *
 * Why this exists: the Billing card used to fire ONE bare fetch, with
 * no timeout on the fetch and no bound on the getAccessToken() call
 * in front of it (whose server-validation step is itself a network
 * call). In the final Gate #4 session the card sat on
 * "Couldn't load your billing" and Retry reproduced the identical
 * failure — every attempt re-ran the same unbounded sequence, and
 * every cause (dead session, dropped gate pass, 5xx, stall) collapsed
 * into the same boolean and the same sentence.
 *
 * Contract:
 *  - The WHOLE attempt is bounded — token fetch included — by a
 *    per-attempt settle timeout (10 s), with a bounded retry budget
 *    (3 attempts, backoff) for failures that can heal.
 *  - Terminal failures are CLASSIFIED, so the card can say what
 *    actually happened instead of looping the same words:
 *      unauthorized — our API answered 401 (session problem; the
 *        session guard's refresh/death path owns the remedy)
 *      gated        — the password gate answered 401
 *        { error: "staging_locked" } (the gate pass fell out; the
 *        remedy is re-entering the gate, not retrying this fetch)
 *      server       — the server answered (5xx / unreadable or
 *        malformed body): reached, but unhappy
 *      unreachable  — nothing answered at all (stall, reset, DNS)
 *    Only server/unreachable consume the retry budget; a 401 of
 *    either flavour is a decision a retry cannot change. */

import type { BillingStateView } from "./billing-display";
import { signalWithTimeout } from "./social-api";
import { settleWithin } from "./auth-signin";

export const BILLING_LOAD_ATTEMPTS = 3;
export const BILLING_LOAD_BACKOFF_MS: readonly number[] = [600, 1500];
export const BILLING_ATTEMPT_TIMEOUT_MS = 10_000;

export type BillingLoadFailureKind = "unauthorized" | "gated" | "server" | "unreachable";

export class BillingLoadError extends Error {
  readonly failure: BillingLoadFailureKind;
  /** Last HTTP status the server answered with, when it answered. */
  readonly status: number | null;
  constructor(failure: BillingLoadFailureKind, status: number | null = null) {
    super(`Billing load failed (${failure}${status != null ? `, HTTP ${status}` : ""})`);
    this.name = "BillingLoadError";
    this.failure = failure;
    this.status = status;
  }
}

export class BillingLoadCancelled extends Error {
  constructor() {
    super("Billing load cancelled");
    this.name = "BillingLoadCancelled";
  }
}

export interface BillingLoadDeps {
  getToken: () => Promise<string | null>;
  fetchFn?: (input: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
}

export interface BillingLoadOptions {
  attempts?: number;
  backoffMs?: readonly number[];
  attemptTimeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function loadBilling(
  deps: BillingLoadDeps,
  options: BillingLoadOptions = {},
): Promise<BillingStateView> {
  const fetchFn = deps.fetchFn ?? ((input: string, init: RequestInit) => fetch(input, init));
  const sleep = deps.sleep ?? defaultSleep;
  const attempts = Math.max(1, options.attempts ?? BILLING_LOAD_ATTEMPTS);
  const backoffMs = options.backoffMs ?? BILLING_LOAD_BACKOFF_MS;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? BILLING_ATTEMPT_TIMEOUT_MS;

  let lastFailure: BillingLoadFailureKind = "unreachable";
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (deps.isCancelled?.()) throw new BillingLoadCancelled();
    if (attempt > 1) {
      await sleep(backoffMs[attempt - 2] ?? backoffMs[backoffMs.length - 1] ?? 0);
      if (deps.isCancelled?.()) throw new BillingLoadCancelled();
    }
    try {
      /* The token call is part of the attempt's bound: its
       * server-validation step is a network call of its own, and a
       * stall there was indistinguishable from a stalled fetch in
       * the old code — both left the card spinning. A token that
       * cannot be produced inside the bound fails the attempt as
       * unreachable (retryable); it never sends the fetch out
       * unauthenticated to be misread as a dead session. */
      let token: string | null;
      try {
        token = await settleWithin(deps.getToken(), attemptTimeoutMs);
      } catch {
        lastFailure = "unreachable";
        continue;
      }
      const { signal, cancel } = signalWithTimeout(undefined, attemptTimeoutMs);
      let res: Response;
      try {
        res = await fetchFn("/api/creator-tiers/billing", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal,
        });
      } finally {
        cancel();
      }
      lastStatus = res.status;
      const text = await res.text().catch(() => "");
      let parsed: { billing?: BillingStateView; error?: unknown } | null = null;
      try {
        parsed = JSON.parse(text) as { billing?: BillingStateView; error?: unknown };
      } catch {
        parsed = null;
      }

      if (res.status === 401) {
        /* Decisions, not transients: never spend the retry budget. */
        throw new BillingLoadError(parsed?.error === "staging_locked" ? "gated" : "unauthorized", 401);
      }
      if (res.ok && parsed?.billing) {
        return parsed.billing;
      }
      /* Answered but unhappy (5xx) or answered nonsense (non-JSON /
       * no billing payload — a proxy error page wears the same
       * shape): server-class, retryable inside the budget. */
      lastFailure = "server";
    } catch (err) {
      if (err instanceof BillingLoadError) throw err;
      if (deps.isCancelled?.()) throw new BillingLoadCancelled();
      /* Fetch rejected, aborted by the attempt timeout, or the body
       * read died: nothing usable answered on THIS attempt.
       * lastStatus deliberately keeps any earlier attempt's received
       * status (the checkout-fetch rule: a response that arrived is
       * proof the server was reached and is never erased). */
      lastFailure = "unreachable";
    }
  }
  throw new BillingLoadError(lastFailure, lastStatus);
}
