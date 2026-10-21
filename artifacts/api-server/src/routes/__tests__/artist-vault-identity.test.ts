/**
 * Route-level tests for the Identity Set rails:
 *   GET    /api/artist-vaults/:vaultId/identity-photos
 *   POST   /api/artist-vaults/:vaultId/identity-photos
 *   PATCH  /api/artist-vaults/:vaultId/identity-photos/:photoId
 *   DELETE /api/artist-vaults/:vaultId/identity-photos/:photoId
 *   POST   /api/artist-vaults/:vaultId/identity-photos/select
 *
 * Pins: set CRUD is owner-scoped (another member's set is invisible —
 * 404, never a leak), selection returns a chosen photo + a reason and
 * respects a manual override, coverage reflects the set's actual
 * labels, a single-photo character selects its main photo exactly as
 * before, and deletes are soft (the row survives with deleted_at set).
 *
 * Heavy modules (DB, auth) are mocked; the real Express router runs
 * against a local ephemeral server (same harness as
 * artist-vaults-manage.test.ts).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const dbState = vi.hoisted(() => ({
  vaultRows: [] as any[],
  photoRows: [] as any[],
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

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (v: any) => v),
  isStorageRef: vi.fn(() => false),
}));

vi.mock("../../lib/teams", () => ({
  getUserActiveTeam: vi.fn(async () => null),
}));

vi.mock("@workspace/db", () => {
  const mkTable = (name: string, rowsKey: "vaultRows" | "photoRows", cols: string[]) => {
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
            const row = { id: `photo-${rowsOf(table).length + 1}`, ...vals };
            setRows(table, [...rowsOf(table), row]);
            return Promise.resolve([row]);
          },
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
      execute: () => Promise.resolve({ rows: [] }),
    },
    artistVaultsTable: mkTable("artist_vaults", "vaultRows", [
      "id", "user_id", "team_id", "deleted_at", "created_at", "updated_at",
      "artist_name", "reference_image_url", "reference_image_path",
    ]),
    artistVaultIdentityPhotosTable: mkTable("artist_vault_identity_photos", "photoRows", [
      "id", "vault_id", "user_id", "image_url", "image_path", "angle",
      "expression", "wardrobe", "source", "sort_order", "created_at",
      "updated_at", "deleted_at",
    ]),
  };
});

import router from "../artist-vault-identity";

let server: any;
let baseUrl: string;
const AUTH = { Authorization: "Bearer <redacted>" };
const asUser2 = { Authorization: "Bearer <redacted>", "x-test-user": "user-2" };

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

beforeEach(() => {
  dbState.vaultRows = [
    {
      id: "vault-own", user_id: "user-1", team_id: null, deleted_at: null,
      artist_name: "Owner Char", reference_image_url: "https://cdn.example/main.jpg",
    },
    {
      id: "vault-other", user_id: "user-2", team_id: null, deleted_at: null,
      artist_name: "Other Char", reference_image_url: "https://cdn.example/other.jpg",
    },
    {
      id: "vault-bare", user_id: "user-1", team_id: null, deleted_at: null,
      artist_name: "No Photo Char", reference_image_url: null,
    },
  ];
  dbState.photoRows = [];
});

const get = (p: string, headers: any = AUTH) => fetch(`${baseUrl}${p}`, { headers });
const post = (p: string, body: any, headers: any = AUTH) =>
  fetch(`${baseUrl}${p}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const patch = (p: string, body: any, headers: any = AUTH) =>
  fetch(`${baseUrl}${p}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const del = (p: string, headers: any = AUTH) => fetch(`${baseUrl}${p}`, { method: "DELETE", headers });

const seedPhoto = (over: any = {}) => {
  const row = {
    id: `seed-${dbState.photoRows.length + 1}`,
    vault_id: "vault-own",
    user_id: "user-1",
    image_url: "https://cdn.example/set.jpg",
    image_path: null,
    angle: "front",
    expression: "neutral",
    wardrobe: null,
    source: "upload",
    sort_order: dbState.photoRows.length,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...over,
  };
  dbState.photoRows.push(row);
  return row;
};

describe("POST /identity-photos — add", () => {
  it("owner adds a photo; labels persist and source defaults to upload", async () => {
    const res = await post("/artist-vaults/vault-own/identity-photos", {
      image_url: "https://cdn.example/profile.jpg",
      angle: "left_profile",
      expression: "smile",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.photo.angle).toBe("left_profile");
    expect(body.photo.expression).toBe("smile");
    expect(body.photo.source).toBe("upload");
    expect(dbState.photoRows).toHaveLength(1);
    expect(dbState.photoRows[0].user_id).toBe("user-1");
  });

  it("an AI-generated portrait is stored with its label on", async () => {
    const res = await post("/artist-vaults/vault-own/identity-photos", {
      image_url: "https://cdn.example/gen.jpg",
      angle: "close_up",
      source: "generated",
    });
    expect(res.status).toBe(201);
    expect((await res.json()).photo.source).toBe("generated");
    expect(dbState.photoRows[0].source).toBe("generated");
  });

  it("rejects an unknown angle with 400 and stores nothing", async () => {
    const res = await post("/artist-vaults/vault-own/identity-photos", {
      image_url: "https://cdn.example/x.jpg",
      angle: "dutch_tilt",
    });
    expect(res.status).toBe(400);
    expect(dbState.photoRows).toHaveLength(0);
  });

  it("another member cannot add to a vault they do not own (404, nothing stored)", async () => {
    const res = await post("/artist-vaults/vault-own/identity-photos", {
      image_url: "https://cdn.example/x.jpg",
      angle: "front",
    }, asUser2);
    expect(res.status).toBe(404);
    expect(dbState.photoRows).toHaveLength(0);
  });

  it("enforces the set cap", async () => {
    for (let i = 0; i < 12; i++) seedPhoto();
    const res = await post("/artist-vaults/vault-own/identity-photos", {
      image_url: "https://cdn.example/x.jpg",
      angle: "front",
    });
    expect(res.status).toBe(400);
    expect(dbState.photoRows).toHaveLength(12);
  });
});

describe("GET /identity-photos — list + coverage", () => {
  it("owner sees the set, the main photo, and coverage that reflects the labels", async () => {
    seedPhoto({ angle: "left_profile", image_url: "https://cdn.example/prof.jpg" });
    const res = await get("/artist-vaults/vault-own/identity-photos");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photos).toHaveLength(1);
    expect(body.mainPhoto.image_url).toBe("https://cdn.example/main.jpg");
    const profile = body.coverage.items.find((i: any) => i.key === "profile");
    expect(profile.covered).toBe(true);
    const fullBody = body.coverage.items.find((i: any) => i.key === "full_body");
    expect(fullBody.covered).toBe(false);
    expect(body.coverage.missingMessages.some((m: string) => m.includes("No full-body shot yet"))).toBe(true);
  });

  it("another member's set is invisible (404)", async () => {
    seedPhoto();
    const res = await get("/artist-vaults/vault-own/identity-photos", asUser2);
    expect(res.status).toBe(404);
  });

  it("requires auth", async () => {
    const res = await get("/artist-vaults/vault-own/identity-photos", {});
    expect(res.status).toBe(401);
  });
});

describe("PATCH + DELETE /identity-photos/:photoId", () => {
  it("owner relabels a photo", async () => {
    const row = seedPhoto({ angle: "front" });
    const res = await patch(`/artist-vaults/vault-own/identity-photos/${row.id}`, { angle: "full_body" });
    expect(res.status).toBe(200);
    expect(dbState.photoRows[0].angle).toBe("full_body");
  });

  it("non-owner relabel 404s and leaves the row unchanged", async () => {
    const row = seedPhoto({ angle: "front" });
    const res = await patch(`/artist-vaults/vault-own/identity-photos/${row.id}`, { angle: "back" }, asUser2);
    expect(res.status).toBe(404);
    expect(dbState.photoRows[0].angle).toBe("front");
  });

  it("delete is soft: row survives with deleted_at set and leaves the list", async () => {
    const row = seedPhoto();
    const res = await del(`/artist-vaults/vault-own/identity-photos/${row.id}`);
    expect(res.status).toBe(200);
    expect(dbState.photoRows).toHaveLength(1);
    expect(dbState.photoRows[0].deleted_at).toBeTruthy();
    const list = await (await get("/artist-vaults/vault-own/identity-photos")).json();
    expect(list.photos).toHaveLength(0);
  });

  it("deleting an already-removed photo 404s", async () => {
    const row = seedPhoto({ deleted_at: new Date() });
    const res = await del(`/artist-vaults/vault-own/identity-photos/${row.id}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /identity-photos/select — the per-shot pick", () => {
  it("single-photo character selects its main photo, exactly as before", async () => {
    const res = await post("/artist-vaults/vault-own/identity-photos/select", {
      cameraMovement: "slow push in",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chosen.id).toBe("main");
    expect(body.chosen.imageUrl).toBe("https://cdn.example/main.jpg");
    expect(body.setCount).toBe(0);
    expect(body.reason).toContain("one identity photo");
  });

  it("picks the profile photo for an orbit shot and says why", async () => {
    seedPhoto({ id: "prof", angle: "left_profile", image_url: "https://cdn.example/prof.jpg" });
    const res = await post("/artist-vaults/vault-own/identity-photos/select", {
      cameraMovement: "slow orbit around the artist",
    });
    const body = await res.json();
    expect(body.chosen.id).toBe("prof");
    expect(body.reason).toContain("left profile");
    expect(body.poolSize).toBe(2);
    expect(body.pool[0].id).toBe("prof");
  });

  it("picks the wardrobe-matching photo when the shot wears that outfit", async () => {
    seedPhoto({ id: "stage", angle: "front", wardrobe: "stage outfit", image_url: "https://cdn.example/stage.jpg" });
    const res = await post("/artist-vaults/vault-own/identity-photos/select", {
      promptText: "performing under spotlights",
      wardrobeHint: "stage outfit",
    });
    const body = await res.json();
    expect(body.chosen.id).toBe("stage");
  });

  it("a manual override is respected and reported as the creator's pick", async () => {
    seedPhoto({ id: "prof", angle: "left_profile", image_url: "https://cdn.example/prof.jpg" });
    const res = await post("/artist-vaults/vault-own/identity-photos/select", {
      cameraMovement: "orbit",
      overridePhotoId: "main",
    });
    const body = await res.json();
    expect(body.chosen.id).toBe("main");
    expect(body.overridden).toBe(true);
    expect(body.reason).toContain("Your pick");
  });

  it("an override naming no pool photo is a 400, never a silent swap", async () => {
    const res = await post("/artist-vaults/vault-own/identity-photos/select", {
      overridePhotoId: "not-a-photo",
    });
    expect(res.status).toBe(400);
  });

  it("a character with no photo at all gets chosen: null and honest copy", async () => {
    const res = await post("/artist-vaults/vault-bare/identity-photos/select", {});
    const body = await res.json();
    expect(body.chosen).toBeNull();
    expect(body.poolSize).toBe(0);
  });

  it("another member cannot select from a set they cannot see (404)", async () => {
    const res = await post("/artist-vaults/vault-own/identity-photos/select", {}, asUser2);
    expect(res.status).toBe(404);
  });
});
