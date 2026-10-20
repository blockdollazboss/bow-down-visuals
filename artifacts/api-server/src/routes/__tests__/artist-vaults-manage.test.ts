/**
 * Route-level tests for the Artist Vault MANAGE rails:
 *   PUT    /api/artist-vaults/:id
 *   DELETE /api/artist-vaults/:id
 *   DELETE /api/artist-vaults/:id/links/:linkId
 *   DELETE /api/artist-vaults/:id/reference-video
 *
 * The writes were always scoped to the caller's own rows, but they
 * answered { success: true } unconditionally — a non-owner's write
 * (e.g. a rename attempt on a team-shared row) silently no-opped
 * while claiming success. These tests pin the hardened contract:
 * owner flows work exactly as before; a PUT/DELETE against a vault
 * (or link) the caller doesn't own answers 404 and leaves the row
 * provably unchanged. GET read semantics (own + team-shared rows)
 * are pinned unchanged.
 *
 * Heavy modules (DB, auth) are mocked; the real Express router runs
 * against a local ephemeral server.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

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
  asc: (col: any) => ({ __asc: true, col: col.__col }),
  desc: (col: any) => ({ __desc: true, col: col.__col }),
  sql: (strings: any, ...vals: any[]) => ({ __sql: true, strings, vals }),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const auth = req.headers["authorization"];
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = (req.headers["x-test-user"] as string) || "user-1";
    req.log = { info: () => {}, error: () => {} };
    next();
  },
}));

vi.mock("@runwayml/sdk", () => ({
  default: class {
    imageToVideo = { create: vi.fn() };
    tasks = { retrieve: vi.fn() };
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
}));

vi.mock("../../lib/r2-client", () => ({
  r2Upload: vi.fn(async (path: string) => path),
}));

vi.mock("../../lib/teams", () => ({
  // No active team in these tests: the GET list is own-rows-only,
  // which is all the read-semantics pin needs.
  getUserActiveTeam: vi.fn(async () => null),
}));

vi.mock("./generate/clip-pricing", () => ({
  SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT: 300,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  // Mirror-on-save is a storage concern: keep the caller's URL as-is
  // so these tests stay hermetic (no network fetch).
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: vi.fn(async (v: any) => v),
}));

vi.mock("../../lib/video-loop", () => ({
  loopVideoFromUrl: vi.fn(async () => ({ outPath: "", workDir: "" })),
  VideoLoopError: class VideoLoopError extends Error {},
}));

vi.mock("../../lib/character-voice-profile", () => ({
  sanitizeCharacterVoiceProfile: vi.fn((v: any) => v),
}));

vi.mock("@workspace/db", () => {
  const mkTable = (name: string, rowsKey: "vaultRows" | "linkRows", cols: string[]) => {
    const t: any = { __table: name, __rowsKey: rowsKey };
    for (const c of cols) t[c] = { __col: c };
    return t;
  };
  const rowsOf = (t: any): any[] => (dbState as any)[t.__rowsKey];
  const setRows = (t: any, rows: any[]) => {
    (dbState as any)[t.__rowsKey] = rows;
  };
  const chain = (rows: any[]) => ({
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    orderBy: (..._o: any[]) => Promise.resolve(rows),
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
  });
  return {
    db: {
      select: (_fields?: any) => ({
        from: (table: any) => ({
          where: (w: any) => chain(rowsOf(table).filter((r) => matchRow(r, w))),
        }),
      }),
      insert: (table: any) => ({
        values: (vals: any) => ({
          returning: () => {
            const row = { id: `row-${rowsOf(table).length + 1}`, ...vals };
            setRows(table, [...rowsOf(table), row]);
            return Promise.resolve([row]);
          },
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
      update: (table: any) => ({
        set: (vals: any) => ({
          where: (w: any) => {
            for (const r of rowsOf(table)) if (matchRow(r, w)) Object.assign(r, vals);
            return Promise.resolve([]);
          },
        }),
      }),
      delete: (table: any) => ({
        where: (w: any) => {
          setRows(table, rowsOf(table).filter((r) => !matchRow(r, w)));
          return Promise.resolve([]);
        },
      }),
      execute: () => Promise.resolve({ rows: [] }),
    },
    artistVaultsTable: mkTable("artist_vaults", "vaultRows", [
      "id", "user_id", "team_id", "deleted_at", "created_at", "updated_at",
      "artist_name", "reference_video_url", "reference_video_path",
      "spotlight_order",
    ]),
    artistCharacterLinksTable: mkTable("artist_character_links", "linkRows", [
      "id", "user_id", "character_id", "linked_character_id", "created_at",
    ]),
  };
});

import router from "../artist-vaults";

let server: any;
let baseUrl: string;
const AUTH = { Authorization: "Bearer test-token" };
const asUser2 = { Authorization: "Bearer test-token", "x-test-user": "user-2" };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const DELETED_AT = new Date("2026-10-01T00:00:00.000Z");

beforeEach(() => {
  dbState.vaultRows = [
    {
      id: "vault-own", user_id: "user-1", team_id: null, deleted_at: null,
      artist_name: "Owner Char",
      reference_video_url: "https://cdn.example/own.mp4",
      reference_video_path: "own/path.mp4",
    },
    {
      id: "vault-team", user_id: "user-2", team_id: "team-1", deleted_at: null,
      artist_name: "Teammate Char",
      reference_video_url: "https://cdn.example/team.mp4",
      reference_video_path: "team/path.mp4",
    },
    {
      id: "vault-deleted", user_id: "user-1", team_id: null, deleted_at: DELETED_AT,
      artist_name: "Gone Char",
      reference_video_url: "https://cdn.example/gone.mp4",
      reference_video_path: "gone/path.mp4",
    },
  ];
  dbState.linkRows = [
    { id: "link-1", user_id: "user-1", character_id: "vault-own", linked_character_id: "vault-team" },
    { id: "link-2", user_id: "user-2", character_id: "vault-team", linked_character_id: "vault-own" },
  ];
});

const put = (p: string, body: any, headers: any = AUTH) =>
  fetch(`${baseUrl}${p}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const del = (p: string, headers: any = AUTH) =>
  fetch(`${baseUrl}${p}`, { method: "DELETE", headers });
const get = (p: string, headers: any = AUTH) => fetch(`${baseUrl}${p}`, { headers });

const vaultRow = (id: string) => dbState.vaultRows.find((r) => r.id === id);
const snapshot = (id: string) => JSON.parse(JSON.stringify(vaultRow(id)));

describe("PUT /artist-vaults/:id — rename / full save", () => {
  it("requires auth", async () => {
    const res = await put("/artist-vaults/vault-own", { artistName: "X" }, {});
    expect(res.status).toBe(401);
  });

  it("owner rename works and answers { success: true }", async () => {
    const res = await put("/artist-vaults/vault-own", {
      artistName: "Renamed Char",
      genre: "rap",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(vaultRow("vault-own").artist_name).toBe("Renamed Char");
    expect(vaultRow("vault-own").genre).toBe("rap");
  });

  it("rejects an invalid body with 400", async () => {
    const res = await put("/artist-vaults/vault-own", { genre: "rap" });
    expect(res.status).toBe(400);
    expect(vaultRow("vault-own").artist_name).toBe("Owner Char");
  });

  it("non-owner PUT on a team-shared row 404s and leaves the row unchanged", async () => {
    const before = snapshot("vault-team");
    const res = await put("/artist-vaults/vault-team", {
      artistName: "Hijacked Name",
      genre: "hijack",
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Character not found");
    expect(snapshot("vault-team")).toEqual(before);
  });

  it("the actual owner of the team row can still PUT it", async () => {
    const res = await put(
      "/artist-vaults/vault-team",
      { artistName: "Teammate Renamed" },
      asUser2,
    );
    expect(res.status).toBe(200);
    expect(vaultRow("vault-team").artist_name).toBe("Teammate Renamed");
  });

  it("PUT on a nonexistent id 404s and creates nothing", async () => {
    const res = await put("/artist-vaults/vault-nope", { artistName: "Ghost" });
    expect(res.status).toBe(404);
    expect(dbState.vaultRows.some((r) => r.id === "vault-nope")).toBe(false);
  });

  it("PUT on the owner's own soft-deleted row 404s and leaves it unchanged", async () => {
    const before = snapshot("vault-deleted");
    const res = await put("/artist-vaults/vault-deleted", { artistName: "Back From Gone" });
    expect(res.status).toBe(404);
    expect(snapshot("vault-deleted")).toEqual(before);
  });
});

describe("DELETE /artist-vaults/:id — soft delete", () => {
  it("requires auth", async () => {
    const res = await del("/artist-vaults/vault-own", {});
    expect(res.status).toBe(401);
  });

  it("owner delete soft-deletes and answers { success: true }", async () => {
    const res = await del("/artist-vaults/vault-own");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(vaultRow("vault-own").deleted_at).toBeInstanceOf(Date);
    // Soft delete only — the row itself is preserved.
    expect(vaultRow("vault-own").artist_name).toBe("Owner Char");
  });

  it("non-owner DELETE on a team-shared row 404s and the row stays live", async () => {
    const res = await del("/artist-vaults/vault-team");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Character not found");
    expect(vaultRow("vault-team").deleted_at).toBeNull();
  });

  it("DELETE on a nonexistent id 404s", async () => {
    const res = await del("/artist-vaults/vault-nope");
    expect(res.status).toBe(404);
  });

  it("DELETE on an already-deleted own row 404s and keeps the original deleted_at", async () => {
    const res = await del("/artist-vaults/vault-deleted");
    expect(res.status).toBe(404);
    expect(vaultRow("vault-deleted").deleted_at).toBe(DELETED_AT);
  });
});

describe("DELETE /artist-vaults/:id/links/:linkId", () => {
  it("owner removes their own link", async () => {
    const res = await del("/artist-vaults/vault-own/links/link-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(dbState.linkRows.some((r) => r.id === "link-1")).toBe(false);
  });

  it("non-owner removing someone else's link 404s and the link survives", async () => {
    const res = await del("/artist-vaults/vault-own/links/link-1", asUser2);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Link not found");
    expect(dbState.linkRows.some((r) => r.id === "link-1")).toBe(true);
  });

  it("removing a nonexistent link 404s", async () => {
    const res = await del("/artist-vaults/vault-own/links/link-nope");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /artist-vaults/:id/reference-video", () => {
  it("owner clears their own reference video", async () => {
    const res = await del("/artist-vaults/vault-own/reference-video");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(vaultRow("vault-own").reference_video_url).toBeNull();
    expect(vaultRow("vault-own").reference_video_path).toBeNull();
  });

  it("non-owner DELETE on a team-shared row 404s and the video survives", async () => {
    const res = await del("/artist-vaults/vault-team/reference-video");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Character not found");
    expect(vaultRow("vault-team").reference_video_url).toBe("https://cdn.example/team.mp4");
    expect(vaultRow("vault-team").reference_video_path).toBe("team/path.mp4");
  });

  it("owner can still clear the video on their own soft-deleted row (write scope unchanged)", async () => {
    const res = await del("/artist-vaults/vault-deleted/reference-video");
    expect(res.status).toBe(200);
    expect(vaultRow("vault-deleted").reference_video_url).toBeNull();
  });
});

describe("GET /artist-vaults — read semantics unchanged", () => {
  it("lists the caller's live rows and does not leak deleted rows", async () => {
    const res = await get("/artist-vaults");
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.vaults as any[]).map((v) => v.id);
    expect(ids).toContain("vault-own");
    expect(ids).not.toContain("vault-deleted");
  });
});
