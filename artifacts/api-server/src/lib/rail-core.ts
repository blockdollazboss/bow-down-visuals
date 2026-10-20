/* ─── Rail cores — the operator's way into the real rails ────────────
   Phase 2 Lane E (Tier 3) runs the SAME route handlers the pages call
   — not a re-implementation of them. Each charged rail exports a
   `run…Core(deps, …)` wrapper that invokes its own route handler with
   a captured response: the handler body is byte-for-byte the code the
   website runs (same validation, same charge, same refund), only the
   transport differs. The identity it runs under is the CALLER's —
   the executor passes the member's own userId, and a fresh credits
   read stands in for the balance requireAuth stamps on real requests.

   Middleware (requireAuth, rate limiters) stays on the HTTP routes
   where it belongs: the operator path carries its own gates instead
   (session-resolved identity, confirmation, daily charged cap). */

export interface RailLog {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface RailCoreDeps {
  /** The member the action runs AS — resolved from their session. */
  userId: string;
  userEmail?: string;
  /** Fresh personal-balance read — the value requireAuth would have
      stamped as req.userCredits for the real request. */
  userCredits: number;
  log: RailLog;
  /** Session-scoped Supabase client when one exists (real requests).
      The operator has no browser token, so it leaves this unset and
      a rail that reads through it falls back to the admin client for
      that read (the charge itself always goes through lib/credits). */
  userSupabase?: unknown;
}

export interface RailCoreResult {
  status: number;
  body: any;
}

/** Minimal stand-in for an express Response: captures status + JSON
    body. The rails invoked through here answer only via
    res.status(…).json(…) / res.json(…) — that is part of the contract
    each rail's wrapper relies on. */
class RailResponseCapture {
  statusCode = 200;
  body: any = undefined;
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  json(payload: any): this {
    this.body = payload;
    return this;
  }
  send(payload: any): this {
    this.body = payload;
    return this;
  }
}

type RailHandler = (req: any, res: any) => Promise<void> | void;

/** Invoke a rail's own route handler in-process, as the given member. */
export async function invokeRailHandler(
  handler: RailHandler,
  deps: RailCoreDeps,
  opts: { body?: unknown; params?: Record<string, string> } = {},
): Promise<RailCoreResult> {
  const res = new RailResponseCapture();
  const req: Record<string, unknown> = {
    body: opts.body ?? {},
    params: opts.params ?? {},
    query: {},
    headers: {},
    userId: deps.userId,
    userEmail: deps.userEmail,
    userCredits: deps.userCredits,
    userSupabase: deps.userSupabase,
    log: deps.log,
  };
  await handler(req, res);
  return { status: res.statusCode, body: res.body };
}

/** The member-facing error a rail answered with, as an Error the
    executor can audit (its message lands in the audit row's reason)
    and honestly report as a failure — never a success. */
export function railFailure(result: RailCoreResult, fallback: string): Error {
  const b = result.body ?? {};
  const message =
    (typeof b.message === "string" && b.message) ||
    (typeof b.error === "string" && b.error) ||
    fallback;
  return new Error(message);
}
