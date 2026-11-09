import { createHash } from "crypto";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";

/**
 * CA-6 replay guard — the shared replay-protection core for the
 * generate t–w rails (charge-audit batch B6). It is the composed
 * contracts / Post Assist / CA-KEY pattern (bg-generate,
 * thumbnail-generator, bio-generator) factored once for this lane's
 * rails instead of being re-typed per file:
 *
 *  - the caller derives the charge's idempotency key itself
 *    (buildChargeIdempotencyKey — server-derived from the request
 *    intent, never null) and passes it here;
 *  - a stored-result PRE-CHECK runs before any funding: the durable
 *    table (migration 0333, via lib/generation-stored-results —
 *    fail-open) first, then this process's own store. A hit is
 *    served back — the stored body verbatim, flagged replayed by the
 *    caller — with no charge and no provider call, even after a
 *    server restart (durable row) or within the process (local row);
 *  - a concurrent twin WAITS on the in-flight run and is served the
 *    same body as a replay; if the twin's run failed (its charge was
 *    refunded and its key voided inside the run), the waiter falls
 *    through and runs fresh;
 *  - a success is stored (in-process + durable) BEFORE the caller
 *    answers, so a retry that arrives after the response is served
 *    from the store. Storage failures are fail-open: they never fail
 *    a paid, successful request.
 *
 * The `run` callback owns everything the rail does today — its
 * balance gate, the charge (with the same key), the work, and its
 * refund paths (a refund that lands VOIDS the key inside the run, so
 * a genuine retry can re-charge). It returns the exact response body
 * a fresh success sends today; throwing means "failed — nothing is
 * stored", and the caller maps the error to the rail's existing
 * error response.
 */

/**
 * Control-flow carrier for a response the rail sends directly today
 * (its balance-gate 402, its charge-failure 402, a pre-charge 404):
 * thrown inside `run`, caught by the handler, and sent verbatim —
 * so a fresh request's wire response stays byte-identical.
 */
export class ReplayShortCircuit extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(`replay short-circuit (${status})`);
    this.status = status;
    this.body = body;
  }
}

interface StoredEntry {
  body: Record<string, unknown>;
  at: number;
}

const storedResults = new Map<string, StoredEntry>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/* CA-6 Pattern B: create bodies of COMPLETED jobs, kept in-process
   (the durable half lives in generation_stored_results via the lib).
   A separate map from storedResults on purpose: job create bodies
   must only become replayable once the job has actually landed —
   never at create time (see storeCompletedJobResult). */
const jobResults = new Map<string, Record<string, unknown>>();

function jobKey(rail: string, idempotencyKey: string, userId: string): string {
  return `${rail}${idempotencyKey}${userId}`;
}

/**
 * CA-6 Pattern B helper — deterministic job id from a charge key
 * (avatar-presenter CA-KEY precedent). A duplicate create for the
 * same charge derives the SAME job id, so the handler can find the
 * existing job in its map instead of minting a second one.
 */
export function deterministicJobId(idempotencyKey: string): string {
  const hex = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * CA-6 Pattern B create-replay check, shared by the job rails.
 * Returns the stored create body (verbatim) when this charge already
 * produced a job: the live job in the rail's map first (any status
 * but "failed" — a failed job refunded and voided its key, so the
 * caller falls through and re-charges), then the durable stored
 * result (written when the job succeeded, covers restarts). The
 * caller answers `{ ...body, replayed: true }` with its create
 * status code. Returns null on a genuine first create.
 */
/**
 * Remove a key's stored create body from THIS process's job-body
 * store — a Pattern B runner's failure path calls this (inside
 * storeCompletedJobResult's failure branch) after a landed refund
 * voids the ledger key: the failed attempt must leave nothing
 * behind, or a later retry could be answered with the dead job's
 * create body. The durable table needs no delete: rows are written
 * ONLY at job success, so a failed job never has one.
 */
function discardLocalJobResult(rail: string, idempotencyKey: string, userId: string): void {
  jobResults.delete(jobKey(rail, idempotencyKey, userId));
}

/**
 * CA-6 Pattern B completion hook, called by every job rail's runner
 * exactly once when the job settles:
 *
 *  - SUCCESS: the create body is stored in-process (jobResults) and
 *    durably (lib/generation-stored-results, fail-open), so a
 *    replayed create — in this process or after a restart — is
 *    answered with the same job instead of a second charge + job.
 *  - FAILURE (the job's charge was refunded and its key voided by
 *    the runner BEFORE calling this): any local trace is discarded,
 *    so the retry creates fresh.
 */
export async function storeCompletedJobResult(
  rail: string,
  idempotencyKey: string,
  userId: string,
  createBody: Record<string, unknown> | null,
): Promise<void> {
  if (createBody === null) {
    discardLocalJobResult(rail, idempotencyKey, userId);
    return;
  }
  jobResults.set(jobKey(rail, idempotencyKey, userId), createBody);
  await storeGenerationResult(rail, idempotencyKey, userId, createBody);
}

export async function findJobCreateReplay<J extends { userId: string }>(
  rail: string,
  idempotencyKey: string,
  userId: string,
  jobs: Map<string, J>,
  createBodyOf: (job: J) => Record<string, unknown>,
  statusOf: (job: J) => string = (j) => (j as unknown as { status: string }).status,
): Promise<Record<string, unknown> | null> {
  const existing = jobs.get(deterministicJobId(idempotencyKey));
  if (existing && existing.userId === userId && statusOf(existing) !== "failed") {
    return createBodyOf(existing);
  }
  const local = jobResults.get(jobKey(rail, idempotencyKey, userId));
  if (local) return { ...local };
  return findStoredGenerationResult(rail, idempotencyKey, userId);
}

/** Test hook: forget every stored result and in-flight wait. */
export function __resetCa6ReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
  jobResults.clear();
}

/**
 * CA-6: read-only peek at this process's stored results — for rails
 * whose charge sits mid-handler (after free pre-work), so they can
 * short-circuit a replay before funding without restructuring the
 * whole handler around withReplayProtection. Returns a copy.
 */
export function takeLocalStoredResult(
  _rail: string,
  idempotencyKey: string,
  _userId: string,
): Record<string, unknown> | null {
  const stored = storedResults.get(idempotencyKey);
  return stored ? { ...stored.body } : null;
}

/**
 * CA-6: store a success body (in-process + durable, fail-open) —
 * the write side of takeLocalStoredResult for mid-handler rails.
 */
export async function storeLocalResult(
  rail: string,
  idempotencyKey: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    if (storedResults.size >= MAX_STORED_RESULTS) {
      const oldest = storedResults.keys().next().value as string | undefined;
      if (oldest !== undefined) storedResults.delete(oldest);
    }
    storedResults.set(idempotencyKey, { body, at: Date.now() });
  } catch { /* storing is best-effort */ }
  await storeGenerationResult(rail, idempotencyKey, userId, { ...body });
}

export async function withReplayProtection(
  rail: string,
  idempotencyKey: string,
  userId: string,
  run: () => Promise<Record<string, unknown>>,
): Promise<{ body: Record<string, unknown>; replayed: boolean }> {
  /* Durable pre-check (migration 0333) BEFORE any funding: a landed
     key's row is served back with no charge and no provider call,
     even after a server restart. Fail-open inside the helper. */
  const durable = await findStoredGenerationResult(rail, idempotencyKey, userId);
  if (durable) return { body: durable, replayed: true };

  const stored = storedResults.get(idempotencyKey);
  if (stored) return { body: stored.body, replayed: true };

  const pending = inFlight.get(idempotencyKey);
  if (pending) {
    const twin = await pending.catch(() => null);
    if (twin) return { body: twin, replayed: true };
    /* The twin failed (refunded + key voided) — fall through fresh. */
  }

  const runPromise = (async () => {
    const body = await run();
    /* Store BEFORE answering (contracts/post-assist pattern): a
       retry that arrives after this response is served from the
       stored body. Fail-open — store errors never fail the paid ask. */
    try {
      if (storedResults.size >= MAX_STORED_RESULTS) {
        const oldest = storedResults.keys().next().value as string | undefined;
        if (oldest !== undefined) storedResults.delete(oldest);
      }
      storedResults.set(idempotencyKey, { body, at: Date.now() });
    } catch { /* storing is best-effort */ }
    await storeGenerationResult(rail, idempotencyKey, userId, { ...body });
    return body;
  })();
  inFlight.set(idempotencyKey, runPromise);
  try {
    const body = await runPromise;
    const postCharge = storedResults.get(idempotencyKey);
    if (postCharge && postCharge.body !== body) {
      return { body: postCharge.body, replayed: true };
    }
    return { body, replayed: false };
  } finally {
    if (inFlight.get(idempotencyKey) === runPromise) inFlight.delete(idempotencyKey);
  }
}
