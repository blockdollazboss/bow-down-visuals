/**
 * Route-level tests for the Artist Vault wardrobe:
 *   GET    /api/artist-vaults/:vaultId/outfits
 *   POST   /api/artist-vaults/:vaultId/outfits
 *   PATCH  /api/artist-vaults/:vaultId/outfits/:outfitId
 *   DELETE /api/artist-vaults/:vaultId/outfits/:outfitId
 *
 * Covers: vault-owner scoping (no cross-vault access), first-outfit-becomes-
 * default, default uniqueness, URL validation, and non-destructive delete
 * (row removal only — storage is never touched).
 *
 * Heavy modules (DB, auth) are mocked; the real Express router runs against
 * a local ephemeral server.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const dbState = vi.hoisted(() => ({
  vaultRows: [] as any[],
  outfitRows: [] as any[],
}));

function matchRow(row: any, where: any): boolean {
  if (!where) return true;
  if (where.__eq) return row[where.col] === where.val;
  if (where.__and) return (where.conds as any[]).every((c) => matchRow(row, c));
  return true;
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __eq: true, col: col.__col, val }),
  and: (...conds: any[]) => ({ __and: true, conds }),
  asc: (col: any) => ({ __asc: true, col: col.__col }),
  desc: (col: any) => ({ __desc: true, col: col.__col }),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const auth = req.headers["authorization"];
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = "user-1";
    req.log = { info: () => {}, error: () => {} };
    next();
  },
}));

vi.mock("@workspace/db", () => {
  const mkTable = (name: string, rowsKey: "vaultRows" | "outfitRows") => {
    const cols: any = { __table: name, __rowsKey: rowsKey };
    for (const c of ["id", "vault_id", "user_id", "label", "image_url", "image_path", "is_default", "sort_order", "created_at"])
      cols[c] = { __col: c };
    return cols;
  };
  const rowsOf = (t: any): any[] => (dbState as any)[t.__rowsKey];
  const setRows = (t: any, rows: any[]) => { (dbState as any)[t.__rowsKey] = rows; };
  return {
    db: {
      select: (_fields?: any) => ({
        from: (table: any) => ({
          where: (w: any) => {
            const rows = rowsOf(table).filter((r) => matchRow(r, w));
            return {
              limit: (n: number) => Promise.resolve(rows.slice(0, n)),
              orderBy: (..._o: any[]) => Promise.resolve(rows),
            };
          },
        }),
      }),
      insert: (table: any) => ({
        values: (vals: any) => ({
          returning: () => {
            const row = {
              id: `outfit-${rowsOf(table).length + 1}`,
              created_at: new Date().toISOString(),
              sort_order: 0,
              ...vals,
            };
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
      delete: (table: any) => ({
        where: (w: any) => {
          setRows(table, rowsOf(table).filter((r) => !matchRow(r, w)));
          return Promise.resolve([]);
        },
      }),
    },
    artistVaultsTable: mkTable("artist_vaults", "vaultRows"),
    artistOutfitsTable: mkTable("artist_outfits", "outfitRows"),
  };
});

import router from "../artist-outfits";

let server: any;
let baseUrl: string;
const AUTH = { Authorization: "Bearer test-token" };

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
    { id: "vault-1", user_id: "user-1" },
    { id: "vault-2", user_id: "user-2" },
  ];
  dbState.outfitRows = [];
});

const get = (p: string, headers: any = AUTH) => fetch(`${baseUrl}${p}`, { headers });
const post = (p: string, body: any, headers: any = AUTH) =>
  fetch(`${baseUrl}${p}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (p: string, body: any, headers: any = AUTH) =>
  fetch(`${baseUrl}${p}`, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const del = (p: string, headers: any = AUTH) => fetch(`${baseUrl}${p}`, { method: "DELETE", headers });

describe("wardrobe outfits API", () => {
  it("requires auth", async () => {
    const res = await get("/artist-vaults/vault-1/outfits", {});
    expect(res.status).toBe(401);
  });

  it("404s for another user's vault", async () => {
    const res = await get("/artist-vaults/vault-2/outfits");
    expect(res.status).toBe(404);
    const res2 = await post("/artist-vaults/vault-2/outfits", { label: "X", image_url: "https://example.com/x.png" });
    expect(res2.status).toBe(404);
  });

  it("lists an empty wardrobe", async () => {
    const res = await get("/artist-vaults/vault-1/outfits");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outfits: [] });
  });

  it("creates an outfit; the first becomes the default", async () => {
    const res = await post("/artist-vaults/vault-1/outfits", {
      label: "Gold Ceremonial Robe",
      image_url: "https://example.com/robe.png",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.outfit.label).toBe("Gold Ceremonial Robe");
    expect(body.outfit.is_default).toBe(true);

    const res2 = await post("/artist-vaults/vault-1/outfits", {
      label: "Battle Armor",
      image_url: "https://example.com/armor.png",
    });
    expect((await res2.json()).outfit.is_default).toBe(false);
  });

  it("rejects non-http(s) image URLs", async () => {
    const res = await post("/artist-vaults/vault-1/outfits", {
      label: "Sneaky",
      image_url: "ftp://example.com/x.png",
    });
    expect(res.status).toBe(400);
    const res2 = await post("/artist-vaults/vault-1/outfits", { label: "Empty" });
    expect(res2.status).toBe(400);
  });

  it("sets the default outfit exactly once", async () => {
    const a = (await (await post("/artist-vaults/vault-1/outfits", { label: "A", image_url: "https://example.com/a.png" })).json()).outfit;
    const b = (await (await post("/artist-vaults/vault-1/outfits", { label: "B", image_url: "https://example.com/b.png" })).json()).outfit;
    expect(a.is_default).toBe(true);

    const res = await patch(`/artist-vaults/vault-1/outfits/${b.id}`, { is_default: true });
    expect(res.status).toBe(200);

    const list = (await (await get("/artist-vaults/vault-1/outfits")).json()).outfits;
    const defaults = list.filter((o: any) => o.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(b.id);
  });

  it("renames an outfit", async () => {
    const a = (await (await post("/artist-vaults/vault-1/outfits", { label: "Old", image_url: "https://example.com/a.png" })).json()).outfit;
    const res = await patch(`/artist-vaults/vault-1/outfits/${a.id}`, { label: "New" });
    expect(res.status).toBe(200);
    const list = (await (await get("/artist-vaults/vault-1/outfits")).json()).outfits;
    expect(list[0].label).toBe("New");
  });

  it("404s when patching another vault's outfit", async () => {
    dbState.outfitRows = [{ id: "outfit-9", vault_id: "vault-2", label: "Theirs", image_url: "https://example.com/t.png", is_default: false }];
    const res = await patch("/artist-vaults/vault-1/outfits/outfit-9", { is_default: true });
    expect(res.status).toBe(404);
    expect(dbState.outfitRows[0].is_default).toBe(false);
  });

  it("deletes an outfit row without touching anything else", async () => {
    const a = (await (await post("/artist-vaults/vault-1/outfits", { label: "A", image_url: "https://example.com/a.png" })).json()).outfit;
    const b = (await (await post("/artist-vaults/vault-1/outfits", { label: "B", image_url: "https://example.com/b.png" })).json()).outfit;
    const res = await del(`/artist-vaults/vault-1/outfits/${a.id}`);
    expect(res.status).toBe(200);
    const list = (await (await get("/artist-vaults/vault-1/outfits")).json()).outfits;
    expect(list.map((o: any) => o.id)).toEqual([b.id]);
  });

  it("404s when deleting another vault's outfit", async () => {
    dbState.outfitRows = [{ id: "outfit-9", vault_id: "vault-2", label: "Theirs", image_url: "https://example.com/t.png", is_default: true }];
    const res = await del("/artist-vaults/vault-1/outfits/outfit-9");
    expect(res.status).toBe(404);
    expect(dbState.outfitRows).toHaveLength(1);
  });
});
