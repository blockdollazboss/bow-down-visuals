/* fetch-with-retry.ts — ONE shared transport-resilient fetch for
   dashboard loads (Stack 400, census C-16).
 *
 * Why this exists: the Command Center panels and the FomoFeed first
 * load fired single-shot fetches with no timeout and no automatic
 * retry. On a cold origin (the staging wake takes 45–90 s; a launch
 * traffic spike or provider latency is the same shape) a slow-but-
 * alive first request either hung past the reader's patience or
 * failed once and parked the panel on its failure state until a
 * human tapped Retry — a transient read as permanent breakage.
 *
 * Contract (the census-named semantics):
 *  - 20 s per-attempt timeout via AbortController. A timeout is a
 *    network-class failure: it is retried like one.
 *  - 2 backoff retries (3 attempts total) on NETWORK errors and on
 *    5xx responses only — the two failure shapes a cold wake
 *    produces. A 5xx body is never consumed; the last 5xx response
 *    is returned when retries run out, so the caller's own !res.ok
 *    handling still sees the real status.
 *  - 4xx (and any other non-5xx) responses are decisions, returned
 *    immediately and NEVER retried — the server answered; retrying
 *    a refusal just makes it slower.
 *  - After retries are exhausted on network errors, the LAST network
 *    error is thrown — the caller's existing honest failure state is
 *    the last resort, exactly as before.
 *
 * This is a plain GET-style fetch wrapper for idempotent reads. It
 * is NOT a general retry for mutations: POSTs belong on their own
 * proven seams (e.g. checkout-fetch's idempotency-keyed transport
 * retry), never on a blind retry. */

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;
type SleepImpl = (ms: number) => Promise<void>;

export interface FetchWithRetryOptions {
  /** Per-attempt timeout in ms. Default 20_000 (the census number). */
  timeoutMs?: number;
  /** Retries AFTER the first attempt. Default 2 (3 attempts total). */
  retries?: number;
  /** Backoff waits between attempts; the last value repeats when the
   *  retry count exceeds the list. Default [1_000, 3_000]. */
  backoffMs?: number[];
  fetchImpl?: FetchImpl;
  sleepImpl?: SleepImpl;
}

const defaultSleep: SleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchWithRetryOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const retries = Math.max(0, opts.retries ?? 2);
  const backoff = opts.backoffMs ?? [1_000, 3_000];
  const doFetch = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const sleep = opts.sleepImpl ?? defaultSleep;

  let lastNetworkError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      /* Network failure or our own timeout abort — the retryable
         class. Remember it: if every attempt fails this way, the
         last one is what the caller catches. */
      lastNetworkError = err;
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 500 && attempt < retries) {
      /* A cold-wake 5xx: retry. The body is deliberately not read —
         the caller only ever sees the final response. */
      continue;
    }
    return res;
  }
  throw lastNetworkError ?? new Error("fetchWithRetry: request failed without a response");
}
