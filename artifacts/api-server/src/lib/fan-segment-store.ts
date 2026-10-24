/**
 * Saved fan segments — persistence (Stack-100 #3, fan-graph phase 2).
 *
 * Rows live in `fan_segments` (see lib/db/src/schema/fan-segments
 * and .lane/MIGRATION-NEEDED.md). The table's migration is HELD for
 * the join, so every function here is probe-first / fail-honest:
 * a missing table (Postgres 42P01, read through lib/pg-errors —
 * drizzle wraps driver errors) raises FanSegmentsUnavailableError,
 * which the routes map to an honest 503 "not ready yet" — presets,
 * live previews, and ad-hoc-rule sends keep working because none
 * of them need this table.
 *
 * Scoping: every query filters by the owning creator's user id.
 * There is no read or write path that touches another creator's
 * segments.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, fanSegmentsTable, type FanSegment } from "@workspace/db";
import { isUndefinedTable } from "./pg-errors";
import {
  normalizeFanSegmentRules,
  parseStoredFanRules,
  type FanSegmentRules,
} from "./fan-segments";

export class FanSegmentsUnavailableError extends Error {
  code = "fan_segments_unavailable" as const;
  constructor() {
    super("Saved fan segments aren't ready yet — the fan_segments table is still being set up.");
    this.name = "FanSegmentsUnavailableError";
  }
}

export interface SavedFanSegment {
  id: string;
  name: string;
  rules: FanSegmentRules;
  createdAt: string;
  updatedAt: string;
}

function toDto(row: FanSegment): SavedFanSegment {
  return {
    id: row.id,
    name: row.name,
    rules: parseStoredFanRules(row.rules),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function guard<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    if (isUndefinedTable(err)) throw new FanSegmentsUnavailableError();
    throw err;
  });
}

export async function listFanSegments(userId: string): Promise<SavedFanSegment[]> {
  const rows = await guard(
    db
      .select()
      .from(fanSegmentsTable)
      .where(eq(fanSegmentsTable.userId, userId))
      .orderBy(desc(fanSegmentsTable.createdAt)),
  );
  return rows.map(toDto);
}

export async function getFanSegment(userId: string, id: string): Promise<SavedFanSegment | null> {
  const [row] = await guard(
    db
      .select()
      .from(fanSegmentsTable)
      .where(and(eq(fanSegmentsTable.id, id), eq(fanSegmentsTable.userId, userId)))
      .limit(1),
  );
  return row ? toDto(row) : null;
}

export async function createFanSegment(
  userId: string,
  name: string,
  rules: FanSegmentRules,
): Promise<SavedFanSegment> {
  const normalized = normalizeFanSegmentRules(rules);
  if (!normalized) throw new Error("invalid fan segment rules");
  const [row] = await guard(
    db
      .insert(fanSegmentsTable)
      .values({ userId, name, rules: JSON.stringify(normalized) })
      .returning(),
  );
  return toDto(row!);
}

export async function updateFanSegment(
  userId: string,
  id: string,
  patch: { name?: string; rules?: FanSegmentRules },
): Promise<SavedFanSegment | null> {
  const set: { name?: string; rules?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.rules !== undefined) {
    const normalized = normalizeFanSegmentRules(patch.rules);
    if (!normalized) throw new Error("invalid fan segment rules");
    set.rules = JSON.stringify(normalized);
  }
  const [row] = await guard(
    db
      .update(fanSegmentsTable)
      .set(set)
      .where(and(eq(fanSegmentsTable.id, id), eq(fanSegmentsTable.userId, userId)))
      .returning(),
  );
  return row ? toDto(row) : null;
}

export async function deleteFanSegment(userId: string, id: string): Promise<boolean> {
  const [row] = await guard(
    db
      .delete(fanSegmentsTable)
      .where(and(eq(fanSegmentsTable.id, id), eq(fanSegmentsTable.userId, userId)))
      .returning({ id: fanSegmentsTable.id }),
  );
  return !!row;
}
