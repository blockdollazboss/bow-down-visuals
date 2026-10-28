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
 *    message.
 *  - Only transport failures (fetch rejects, or the body is not
 *    JSON) are retried, up to `attempts` total tries with backoff.
 *  - If every attempt fails at transport level, a
 *    CheckoutTransportError is thrown so the caller can say honestly
 *    "couldn't reach the server — nothing was charged". */

export class CheckoutTransportError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "CheckoutTransportError";
    this.status = status;
  }
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
      /* Transport failure (DNS, reset, proxy kill) — retryable. */
      lastStatus = null;
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
    "Checkout request never reached the server",
    lastStatus,
  );
}
