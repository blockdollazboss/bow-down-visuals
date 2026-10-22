/**
 * pg-errors.test.ts — the drizzle error-shape pins (lane-12 audit).
 *
 * Production fact (drizzle-orm 0.45.3, node-postgres): every driver
 * error is wrapped in a DrizzleQueryError whose message is
 * "Failed query: …", which has NO .code, and which carries the real
 * pg error on .cause. Checks written against the plain shape
 * ({ code: "23505" }) pass their tests and never fire in production —
 * the D6 lesson. These tests therefore build the PRODUCTION wrapped
 * shape with the real DrizzleQueryError class and assert the helpers
 * see through it, while the plain shape (raw pg / Supabase-style
 * callers that hand errors through unwrapped) keeps working.
 */
import { describe, it, expect } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { pgErrorCode, isUniqueViolation, isUndefinedTable, pgErrorText } from "../pg-errors";

function pgError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** The exact shape a unique-violation takes on a production drizzle path. */
function wrappedUniqueViolation(): DrizzleQueryError {
  return new DrizzleQueryError(
    "insert into \"creator_payouts\" (\"profile_id\", \"amount_cents\", \"status\") values ($1, $2, $3) returning \"id\", \"created_at\"",
    "[\"profile-1\", 500, \"processing\"]",
    pgError("23505", 'duplicate key value violates unique constraint "creator_payouts_profile_processing_ux"'),
  );
}

describe("pg-errors — production (drizzle-wrapped) shape", () => {
  it("the wrapper really has no top-level code and a query-only message", () => {
    const err = wrappedUniqueViolation();
    expect((err as { code?: string }).code).toBeUndefined();
    expect(err.message).toMatch(/^Failed query: /);
    expect(err.message).not.toMatch(/duplicate key/i);
  });

  it("isUniqueViolation sees through the wrapper", () => {
    expect(isUniqueViolation(wrappedUniqueViolation())).toBe(true);
    expect(pgErrorCode(wrappedUniqueViolation())).toBe("23505");
  });

  it("pgErrorText recovers the pg message from the cause", () => {
    expect(pgErrorText(wrappedUniqueViolation())).toMatch(/duplicate key value violates unique constraint/);
  });

  it("isUndefinedTable sees a wrapped 42P01", () => {
    const err = new DrizzleQueryError(
      "select * from \"profile_tracks\"",
      "[]",
      pgError("42P01", 'relation "profile_tracks" does not exist'),
    );
    expect(isUndefinedTable(err)).toBe(true);
    expect(isUniqueViolation(err)).toBe(false);
    expect(pgErrorText(err)).toMatch(/relation "profile_tracks" does not exist/);
  });

  it("walks deeper chains (wrapper → relay error → pg error)", () => {
    const relay = Object.assign(new Error("relay"), {
      cause: pgError("23505", "duplicate key value violates unique constraint"),
    });
    const err = new DrizzleQueryError("insert into t values ($1)", "[1]", relay);
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("a wrapped non-unique pg error is not a unique violation", () => {
    const err = new DrizzleQueryError(
      "insert into t values ($1)",
      "[1]",
      pgError("23503", 'insert or update on table "t" violates foreign key constraint'),
    );
    expect(isUniqueViolation(err)).toBe(false);
    expect(pgErrorCode(err)).toBe("23503");
  });
});

describe("pg-errors — plain (unwrapped) shape still works", () => {
  it("top-level code is read directly (raw pg / PostgREST-style errors)", () => {
    const err = pgError("23505", "duplicate key value violates unique constraint");
    expect(isUniqueViolation(err)).toBe(true);
    expect(pgErrorCode(err)).toBe("23505");
    expect(pgErrorText(err)).toMatch(/duplicate key/);
  });

  it("one-level cause (the payment-reversals shape) resolves", () => {
    const err = Object.assign(new Error("outer"), {
      cause: pgError("23505", "duplicate key value violates unique constraint"),
    });
    expect(isUniqueViolation(err)).toBe(true);
  });
});

describe("pg-errors — non-pg inputs are inert", () => {
  it("null / undefined / strings / plain errors yield no code", () => {
    expect(pgErrorCode(null)).toBeUndefined();
    expect(pgErrorCode(undefined)).toBeUndefined();
    expect(pgErrorCode("23505")).toBeUndefined();
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUndefinedTable(new Error("boom"))).toBe(false);
    expect(pgErrorText(null)).toBe("");
  });

  it("a cyclic cause chain terminates", () => {
    const a: Record<string, unknown> = { message: "a" };
    const b: Record<string, unknown> = { message: "b", cause: a };
    a.cause = b;
    expect(pgErrorCode(a)).toBeUndefined();
    expect(pgErrorText(a)).toContain("a");
  });
});
