/* checkout-fetch.ts — transport-resilient JSON POST for checkout
   intent creation (stack400 lane 1).
 *
 * Why this exists: the plan-checkout intent POST is idempotency-keyed
 * on the server (same member + same durable subscription state ->
 * same Stripe key -> the same subscription is replayed, never a
 * second one), so retrying it is SAFE by construction. The pricing
 * page used to fire it exactly once with a bare `res.json()`: any
 * transport failure — a fetch rejection, or a proxy answering with a
 * non-JSON error page while the origin was unreachable (the Oct 26
 * gate run documented Cloudflare 502s in the same windows) — threw
 * into a catch that could only say "Network hiccup — try again."
 * and the purchase died even though a retry a second later would
 * have sailed through.
 *
 * Contract:
 *  - A server JSON answer (any status) is returned as-is and NEVER
 *    retried — the server made a decision; the caller shows its
 *    message (e.g. the intent route's own 502 text). This is the
 *    only path by which a server error message reaches the buyer.
 *  - Only transport failures (fetch rejects, or the body is not
 *    JSON) are retried, up to `attempts` total tries with backoff.
 *  - If every attempt fails at transport level, a
 *    CheckoutTransportError is thrown carrying the last HTTP status
 *    ANY attempt was answered with (null when no response ever
 *    arrived). checkoutFailureCopy() turns that into honest copy:
 *    a server that answered with an error status is named as such —
 *    the Oct 28 live failure answered 502 six times server-side
 *    while the buyer was told the server "couldn't be reached" —
 *    and "couldn't reach" is reserved for the case where truly
 *    nothing answered. */

export class CheckoutTransportError extends Error {
  /** Last HTTP status any attempt was answered with; null when no
   *  response ever arrived (pure transport failure). */
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "CheckoutTransportError";
    this.status = status;
  }
}

/* Buyer-facing copy for a checkout POST that exhausted its retries.
 * The distinction that matters: if the server ANSWERED (an HTTP
 * status was received, even when the body never arrived readable),
 * say the server hit an error and name the status; only when no
 * response ever arrived is "couldn't reach the server" the truth. */
export function checkoutFailureCopy(err: unknown): string {
  if (err instanceof CheckoutTransportError && err.status != null) {
    return `The checkout server answered with an error (HTTP ${err.status}) — nothing was charged. Give it a moment and try again.`;
  }
  return "Couldn't reach the checkout server — nothing was charged. Give it a moment and try again.";
}

export interface JsonPostResult {
  ok: boolean;
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;
type SleepImpl = (ms: number) => Promise<void>;

const defaultSleep: SleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function postJsonWithTransportRetry(
  url: string,
  init: { token?: string | null; body: unknown },
  opts: { attempts?: number; backoffMs?: number[]; fetchImpl?: FetchImpl; sleepImpl?: SleepImpl } = {},
): Promise<JsonPostResult> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const backoff = opts.backoffMs ?? [600, 1500];
  const doFetch = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const sleep = opts.sleepImpl ?? defaultSleep;

  /* The last HTTP status ANY attempt was answered with. A received
     response is proof the server was reached, so a later attempt's
     fetch rejection must NOT erase it — the caller's failure copy
     (checkoutFailureCopy) depends on the distinction. */
  let lastStatus: number | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0);
    }
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        },
        body: JSON.stringify(init.body),
      });
    } catch {
      /* Transport failure (DNS, reset, proxy kill) — retryable. No
         response arrived on THIS attempt; any earlier attempt's
         received status still stands. */
      continue;
    }
    lastStatus = res.status;
    const text = await res.text().catch(() => "");
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      return { ok: res.ok, status: res.status, data };
    } catch {
      /* Non-JSON body: a proxy/gateway error page, not our server's
         answer — retryable, and on the final attempt it becomes a
         transport error rather than a parse explosion. */
      continue;
    }
  }
  throw new CheckoutTransportError(
    "Checkout request exhausted retries without a usable server answer",
    lastStatus,
  );
}
