/**
 * Shared transient-failure tolerance for client-side job pollers
 * (Stack-200 item 187).
 *
 * Background jobs on this platform are DURABLE server-side (export jobs,
 * lip-sync jobs and runs survive in the DB). A single transient poll
 * failure — a network blip, a per-poll abort during a deploy swap, a 5xx
 * from the proxy — must therefore never kill the client's view of a
 * healthy job. Pollers tolerate up to MAX_CONSECUTIVE_POLL_FAILURES
 * consecutive transient failures inside their existing overall deadline;
 * a non-transient HTTP error (4xx other than 429) still surfaces at
 * once, and exhausting the budget surfaces the failure plainly.
 */

/** Consecutive transient poll failures tolerated before a poller
 *  surfaces a failure. At a 2–3s poll cadence this rides out ~10–15s+
 *  of proxy/deploy turbulence without masking a real outage: the budget
 *  is consecutive (any successful poll resets it) and the caller's
 *  overall deadline still applies throughout. */
export const MAX_CONSECUTIVE_POLL_FAILURES = 5;

/** HTTP statuses a poll may treat as transient: server/proxy errors and
 *  rate limiting. Every other non-OK status (401/403/404/…) is a real
 *  answer about the job or the caller and must surface immediately. */
export function isTransientPollHttpStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/** Counts consecutive transient poll failures for one polling loop. */
export class PollFailureBudget {
  private consecutive = 0;

  /** Call after every successful poll — resets the consecutive count. */
  noteSuccess(): void {
    this.consecutive = 0;
  }

  /**
   * Call after a transient poll failure (network throw, abort, or a
   * transient HTTP status). Returns true while the caller should keep
   * polling; false once the budget is exhausted and the failure must be
   * surfaced to the user.
   */
  noteTransientFailure(): boolean {
    this.consecutive += 1;
    return this.consecutive <= MAX_CONSECUTIVE_POLL_FAILURES;
  }

  /** Current consecutive-failure count (diagnostics/tests). */
  get failures(): number {
    return this.consecutive;
  }
}
