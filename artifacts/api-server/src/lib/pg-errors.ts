/* Postgres error-shape helpers.
 *
 * @workspace/db runs on drizzle-orm/node-postgres, which wraps EVERY
 * driver error in a DrizzleQueryError: the pg error (with its .code,
 * e.g. "23505") rides on .cause, the wrapper itself has NO .code, and
 * its message is just "Failed query: …". Any check that reads a
 * top-level err.code — or regexes the top-level message — therefore
 * NEVER fires on a drizzle path in production (the D6 lesson). These
 * helpers walk the cause chain (≤5 levels) to the real pg error.
 *
 * Supabase PostgREST errors are NOT wrapped: their .code is top-level
 * and checks against them are correct without this helper.
 *
 * RECONCILED at Stack-21 integration: this module is the single
 * implementation — lib/payment-record.ts (which grew its own walker in
 * the D6 fix) and lib/payment-reversals.ts (which had a one-level
 * checker) both delegate here now. */

export function pgErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur != null; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Postgres unique-violation (23505), wherever it hides in the chain. */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}

/** Postgres undefined-table (42P01), wherever it hides in the chain. */
export function isUndefinedTable(err: unknown): boolean {
  return pgErrorCode(err) === "42P01";
}

/** Postgres undefined-column (42703), wherever it hides in the chain —
 *  the signal a held migration has not landed yet (graceful-degradation
 *  paths key off this, never off message text). */
export function isUndefinedColumn(err: unknown): boolean {
  return pgErrorCode(err) === "42703";
}

/** Missing schema (undefined table OR undefined column), wherever it
 *  hides. pg-code first; the message fallback covers drivers that
 *  report the same condition without a SQLSTATE (pg-mem, the house
 *  test engine, phrases it as: relation "x" does not exist / column
 *  "x" does not exist). Used by read endpoints that must answer an
 *  honest not-ready state instead of a 500 when a held/baseline
 *  migration has not landed on this database. */
export function isMissingSchemaError(err: unknown): boolean {
  if (isUndefinedTable(err) || isUndefinedColumn(err)) return true;
  return /(relation|column) "[^"]+" does not exist/i.test(pgErrorText(err));
}

/* Every message along the cause chain, outermost first. For checks
 * written against the raw pg message ("duplicate key value violates
 * unique constraint …", "relation \"x\" does not exist") — on a
 * drizzle path that text survives only on the wrapped error's cause. */
export function pgErrorText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur != null; depth++) {
    const msg = (cur as { message?: unknown }).message;
    if (typeof msg === "string" && msg !== "") parts.push(msg);
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.join(" ");
}
