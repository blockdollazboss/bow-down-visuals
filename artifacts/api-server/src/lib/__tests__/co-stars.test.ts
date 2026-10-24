/**
 * Co-star context pins (lib/co-stars.ts buildCoStarContext).
 *
 * The board defect these pin: vault deletion is SOFT (deleted_at), links
 * are never cleaned, and buildCoStarContext used to fetch the linked
 * vault by id alone — so a character the creator deleted kept being
 * described to the AI director and cast in every generation. A deleted
 * co-star must never be pulled in; live co-stars must keep working
 * exactly as before.
 *
 * DB + drizzle operators are mocked with the same tagged-condition fake
 * the artist-vaults route tests use, so the where clauses the lib builds
 * are what decide the result.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({
  vaultRows: [] as any[],
  linkRows: [] as any[],
}));

function matchRow(row: any, where: any): boolean {
  if (!where) return true;
  if (where.__eq) return row[where.col] === where.val;
  if (where.__isNull) return row[where.col] === null || row[where.col] === undefined;
  if (where.__and) return (where.conds as any[]).every((c) => matchRow(row, c));
  if (where.__or) return (where.conds as any[]).some((c) => matchRow(row, c));
  return true;
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __eq: true, col: col.__col, val }),
  and: (...conds: any[]) => ({ __and: true, conds }),
  or: (...conds: any[]) => ({ __or: true, conds }),
  isNull: (col: any) => ({ __isNull: true, col: col.__col }),
}));

vi.mock("@workspace/db", () => {
  const mkTable = (rowsKey: "vaultRows" | "linkRows", cols: string[]) => {
    const t: any = { __rowsKey: rowsKey };
    for (const c of cols) t[c] = { __col: c };
    return t;
  };
  const rowsOf = (t: any): any[] => (dbState as any)[t.__rowsKey];
  return {
    db: {
      select: (_fields?: any) => ({
        from: (table: any) => ({
          where: (w: any) =>
            Promise.resolve(rowsOf(table).filter((r) => matchRow(r, w))),
        }),
      }),
    },
    artistVaultsTable: mkTable("vaultRows", ["id", "deleted_at", "artist_name"]),
    artistCharacterLinksTable: mkTable("linkRows", [
      "id", "user_id", "character_id", "linked_character_id", "role",
    ]),
  };
});

import { buildCoStarContext } from "../co-stars";

const DELETED_AT = new Date("2026-10-01T00:00:00.000Z");

beforeEach(() => {
  dbState.vaultRows = [
    { id: "lead", user_id: "user-1", deleted_at: null, artist_name: "Lead" },
    {
      id: "live-star", user_id: "user-1", deleted_at: null,
      artist_name: "Nova Live", artist_type: "singer",
      consistency_prompt: "gold chain, braids",
    },
    {
      id: "gone-star", user_id: "user-1", deleted_at: DELETED_AT,
      artist_name: "Ghost Gone", artist_type: "rapper",
    },
  ];
  dbState.linkRows = [];
});

describe("buildCoStarContext", () => {
  it("describes a live linked co-star with their role", async () => {
    dbState.linkRows = [
      { id: "l1", user_id: "user-1", character_id: "lead", linked_character_id: "live-star", role: "rival" },
    ];
    const ctx = await buildCoStarContext("lead", "user-1");
    expect(ctx).toContain("CO-STAR: Nova Live (role: rival)");
    expect(ctx).toContain("Identity: gold chain, braids");
  });

  it("never pulls in a soft-deleted co-star", async () => {
    dbState.linkRows = [
      { id: "l2", user_id: "user-1", character_id: "lead", linked_character_id: "gone-star", role: "cameo" },
    ];
    const ctx = await buildCoStarContext("lead", "user-1");
    expect(ctx).toBe("");
    expect(ctx).not.toContain("Ghost Gone");
  });

  it("with a live and a deleted co-star, only the live one is described", async () => {
    dbState.linkRows = [
      { id: "l1", user_id: "user-1", character_id: "lead", linked_character_id: "live-star", role: "collaborator" },
      { id: "l2", user_id: "user-1", character_id: "lead", linked_character_id: "gone-star", role: "cameo" },
    ];
    const ctx = await buildCoStarContext("lead", "user-1");
    expect(ctx).toContain("Nova Live");
    expect(ctx).not.toContain("Ghost Gone");
  });

  it("returns empty when the character has no links", async () => {
    expect(await buildCoStarContext("lead", "user-1")).toBe("");
  });

  it("skips a link whose vault row is gone entirely", async () => {
    dbState.linkRows = [
      { id: "l3", user_id: "user-1", character_id: "lead", linked_character_id: "missing", role: "crew" },
    ];
    expect(await buildCoStarContext("lead", "user-1")).toBe("");
  });

  it("does not leak another user's links", async () => {
    dbState.linkRows = [
      { id: "l4", user_id: "user-2", character_id: "lead", linked_character_id: "live-star", role: "crew" },
    ];
    expect(await buildCoStarContext("lead", "user-1")).toBe("");
  });
});
