import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logger } from "./logger";

/**
 * Thrown by deductCredits() when the atomic UPDATE matches no rows —
 * i.e. the profile is missing or the balance is below `cost`.
 * Routes translate this into the existing 402 { error: "out_of_credits" }
 * response shape.
 */
export class OutOfCreditsError extends Error {
  readonly status = 402;
  constructor() {
    super("out_of_credits");
    this.name = "OutOfCreditsError";
  }
}

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured — cannot deduct credits.");
    }
    _pool = new Pool({ connectionString, max: 5 });
  }
  return _pool;
}

/**
 * Atomically deducts `cost` credits from a user's profile.
 *
 * Single statement: `UPDATE ... SET credits = credits - cost WHERE id = $1
 * AND credits >= cost RETURNING credits`. Because the read and the write
 * happen in one statement, concurrent requests cannot double-spend the
 * same balance (no read-modify-write race).
 *
 * Returns the new balance. Throws OutOfCreditsError when no row is
 * updated (missing profile or insufficient balance).
 */
export async function deductCredits(userId: string, cost: number): Promise<number> {
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(`deductCredits: invalid cost ${cost}`);
  }
  const db = drizzle(getPool());
  const result = await db.execute(
    sql`UPDATE profiles SET credits = credits - ${cost} WHERE id = ${userId} AND credits >= ${cost} RETURNING credits`,
  );
  const newBalance = (result.rows[0] as { credits: number } | undefined)?.credits;
  if (newBalance === undefined) {
    logger.warn({ userId, cost }, "[credits] atomic deduction found insufficient balance");
    throw new OutOfCreditsError();
  }
  return newBalance;
}
