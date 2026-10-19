/**
 * Route tests for Storyboards (routes/storyboards — STACK-20 R2 #19,
 * UPGRADE-PROGRAM 2.3 planner half):
 *   GET    /api/storyboards                              my boards
 *   POST   /api/storyboards                              start a board
 *   GET    /api/storyboards/:id                          one board, full panels
 *   PATCH  /api/storyboards/:id                          rename
 *   DELETE /api/storyboards/:id                          delete (panels go with it)
 *   POST   /api/storyboards/:id/panels                   append a panel
 *   PATCH  /api/storyboards/:id/panels/:panelId          edit a panel
 *   DELETE /api/storyboards/:id/panels/:panelId          remove a panel
 *   POST   /api/storyboards/:id/panels/:panelId/move     swap with a neighbor
 *
 * Contract pinned here:
 * - EVERY verb is owner-scoped: a foreign board is a 404 on read,
 *   rename, delete and every panel verb — its existence never leaks,
 *   and a foreign panel verb changes nothing.
 * - A panel is { id, title, notes, imageUrl, imagePrompt }; position
 *   IS the array order. A move swaps with one neighbor; at either end
 *   it is an honest no-op (moved: false, board unchanged) — panels
 *   never wrap around or vanish.
 * - imageUrl null is a notes-only panel — a legitimate state that
 *   round-trips as null. A non-http(s) imageUrl is refused (400) and
 *   nothing is written.
 * - The board cap (STORYBOARD_MAX_PANELS) refuses the append that
 *   would pass it; the panels already on the board are untouched.
 *
 * Driven against the REAL Express router on an ephemeral server with
 * the house _reach-fake-db (real table objects, rows in a store) and
 * auth mocked the house way (x-test-user header).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-00000000b0b5";

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    req.log = { info: () => {}, error: () => {}, warn: () => {} };
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  /* The rail's own public URLs pass through untouched; a value in our
     supabase storage shape normalizes to its permanent ref at write
     time and re-signs at read time (the fake keeps both visible so
     the round-trip is assertable). */
  normalizeToStorageRef: (v: string | null | undefined) => {
    if (v == null) return null;
    const m = /^https:\/\/supabase\.example\/storage\/(.+)$/.exec(v);
    return m ? `supabase://bucket/${m[1]}` : v;
  },
  refreshSupabaseStorageUrl: async (v: string) => {
    const m = /^supabase:\/\/bucket\/(.+)$/.exec(v);
    return m ? `https://signed.example/${m[1]}` : v;
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({ storyboards: actual.storyboardsTable }, {});
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import storyboardsRouter from "../storyboards";
import { STORYBOARD_MAX_PANELS } from "../storyboards";

let server: ReturnType<typeof express.application.listen>;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storyboardsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.fake.clear();
});

async function call(
  method: string,
  path: string,
  opts: { user?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function makeBoard(user: string, title = "My video plan"): Promise<string> {
  const r = await call("POST", "/api/storyboards", { user, body: { title } });
  expect(r.status).toBe(201);
  return r.json.storyboard.id as string;
}

async function addPanel(boardId: string, user: string, body: unknown = {}): Promise<any> {
  const r = await call("POST", `/api/storyboards/${boardId}/panels`, { user, body });
  expect(r.status).toBe(201);
  return r.json.panel;
}

describe("storyboards — auth + owner scoping", () => {
  it("refuses every verb without a sign-in", async () => {
    const boardId = await makeBoard(ALICE);
    for (const [method, path] of [
      ["GET", "/api/storyboards"],
      ["POST", "/api/storyboards"],
      ["GET", `/api/storyboards/${boardId}`],
      ["PATCH", `/api/storyboards/${boardId}`],
      ["DELETE", `/api/storyboards/${boardId}`],
      ["POST", `/api/storyboards/${boardId}/panels`],
    ] as const) {
      const r = await call(method, path, { body: method === "GET" || method === "DELETE" ? undefined : {} });
      expect(r.status, `${method} ${path}`).toBe(401);
    }
  });

  it("a foreign board is a 404 on every verb, and foreign verbs change nothing", async () => {
    const boardId = await makeBoard(ALICE);
    const panel = await addPanel(boardId, ALICE, { title: "Opening shot", notes: "Gold light." });

    for (const [method, path, body] of [
      ["GET", `/api/storyboards/${boardId}`, undefined],
      ["PATCH", `/api/storyboards/${boardId}`, { title: "Hijacked" }],
      ["DELETE", `/api/storyboards/${boardId}`, undefined],
      ["POST", `/api/storyboards/${boardId}/panels`, { title: "Intruder" }],
      ["PATCH", `/api/storyboards/${boardId}/panels/${panel.id}`, { title: "Hijacked" }],
      ["DELETE", `/api/storyboards/${boardId}/panels/${panel.id}`, undefined],
      ["POST", `/api/storyboards/${boardId}/panels/${panel.id}/move`, { direction: "up" }],
    ] as const) {
      const r = await call(method, path, { user: BOB, body });
      expect(r.status, `${method} ${path}`).toBe(404);
    }

    /* Bob's list never shows Alice's board. */
    const bobList = await call("GET", "/api/storyboards", { user: BOB });
    expect(bobList.json.storyboards).toEqual([]);

    /* And Alice's board is exactly as she left it. */
    const after = await call("GET", `/api/storyboards/${boardId}`, { user: ALICE });
    expect(after.status).toBe(200);
    expect(after.json.storyboard.title).toBe("My video plan");
    expect(after.json.storyboard.panels).toHaveLength(1);
    expect(after.json.storyboard.panels[0].title).toBe("Opening shot");
  });

  it("a missing board is the same 404 as a foreign one", async () => {
    const missing = "00000000-0000-4000-8000-00000000dead";
    const r = await call("GET", `/api/storyboards/${missing}`, { user: ALICE });
    expect(r.status).toBe(404);
  });
});

describe("storyboards — boards", () => {
  it("creates an empty board, lists it as a summary, reads it back whole", async () => {
    const boardId = await makeBoard(ALICE, "Launch teaser");
    const list = await call("GET", "/api/storyboards", { user: ALICE });
    expect(list.status).toBe(200);
    expect(list.json.storyboards).toHaveLength(1);
    expect(list.json.storyboards[0]).toMatchObject({
      id: boardId,
      title: "Launch teaser",
      panels: [],
      panelCount: 0,
    });
    const got = await call("GET", `/api/storyboards/${boardId}`, { user: ALICE });
    expect(got.json.storyboard.panels).toEqual([]);
  });

  it("defaults the title when none is given", async () => {
    const r = await call("POST", "/api/storyboards", { user: ALICE, body: {} });
    expect(r.status).toBe(201);
    expect(r.json.storyboard.title).toBe("Untitled storyboard");
  });

  it("renames, and refuses an empty rename", async () => {
    const boardId = await makeBoard(ALICE);
    const renamed = await call("PATCH", `/api/storyboards/${boardId}`, {
      user: ALICE,
      body: { title: "Episode 1 — the plan" },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.json.storyboard.title).toBe("Episode 1 — the plan");

    const empty = await call("PATCH", `/api/storyboards/${boardId}`, {
      user: ALICE,
      body: { title: "   " },
    });
    expect(empty.status).toBe(400);
    const after = await call("GET", `/api/storyboards/${boardId}`, { user: ALICE });
    expect(after.json.storyboard.title).toBe("Episode 1 — the plan");
  });

  it("deletes the board and its panels with it", async () => {
    const boardId = await makeBoard(ALICE);
    await addPanel(boardId, ALICE, { title: "One" });
    const del = await call("DELETE", `/api/storyboards/${boardId}`, { user: ALICE });
    expect(del.status).toBe(200);
    const got = await call("GET", `/api/storyboards/${boardId}`, { user: ALICE });
    expect(got.status).toBe(404);
    const list = await call("GET", "/api/storyboards", { user: ALICE });
    expect(list.json.storyboards).toEqual([]);
  });
});

describe("storyboards — panels", () => {
  it("appends panels in order; a notes-only panel round-trips with imageUrl null", async () => {
    const boardId = await makeBoard(ALICE);
    const p1 = await addPanel(boardId, ALICE, { title: "Cold open", notes: "Host walks in." });
    const p2 = await addPanel(boardId, ALICE, {
      title: "Product shot",
      notes: "Slow push-in.",
      imageUrl: "https://cdn.example/frame.png",
      imagePrompt: "gold product on marble",
    });
    expect(p1.imageUrl).toBeNull();
    expect(p1.imagePrompt).toBeNull();
    expect(p2.imageUrl).toBe("https://cdn.example/frame.png");

    const got = await call("GET", `/api/storyboards/${boardId}`, { user: ALICE });
    expect(got.json.storyboard.panels.map((p: any) => p.id)).toEqual([p1.id, p2.id]);
    expect(got.json.storyboard.panelCount).toBe(2);
  });

  it("edits title/notes, sets and clears the frame", async () => {
    const boardId = await makeBoard(ALICE);
    const p = await addPanel(boardId, ALICE, { title: "Draft title" });
    const edited = await call("PATCH", `/api/storyboards/${boardId}/panels/${p.id}`, {
      user: ALICE,
      body: { title: "Final title", notes: "Beat lands here.", imageUrl: "https://cdn.example/a.png", imagePrompt: "prompt a" },
    });
    expect(edited.status).toBe(200);
    expect(edited.json.panel).toMatchObject({
      title: "Final title",
      notes: "Beat lands here.",
      imageUrl: "https://cdn.example/a.png",
      imagePrompt: "prompt a",
    });

    const cleared = await call("PATCH", `/api/storyboards/${boardId}/panels/${p.id}`, {
      user: ALICE,
      body: { imageUrl: null },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.json.panel.imageUrl).toBeNull();
    /* Clearing the frame does not touch the words. */
    expect(cleared.json.panel.title).toBe("Final title");
    expect(cleared.json.panel.notes).toBe("Beat lands here.");
  });

  it("removes a panel and keeps the rest in order", async () => {
    const boardId = await makeBoard(ALICE);
    const p1 = await addPanel(boardId, ALICE, { title: "One" });
    const p2 = await addPanel(boardId, ALICE, { title: "Two" });
    const p3 = await addPanel(boardId, ALICE, { title: "Three" });
    const del = await call("DELETE", `/api/storyboards/${boardId}/panels/${p2.id}`, { user: ALICE });
    expect(del.status).toBe(200);
    expect(del.json.storyboard.panels.map((p: any) => p.id)).toEqual([p1.id, p3.id]);

    const gone = await call("DELETE", `/api/storyboards/${boardId}/panels/${p2.id}`, { user: ALICE });
    expect(gone.status).toBe(404);
  });

  it("moves a panel one step; at the ends the move is an honest no-op", async () => {
    const boardId = await makeBoard(ALICE);
    const p1 = await addPanel(boardId, ALICE, { title: "One" });
    const p2 = await addPanel(boardId, ALICE, { title: "Two" });
    const p3 = await addPanel(boardId, ALICE, { title: "Three" });

    const up = await call("POST", `/api/storyboards/${boardId}/panels/${p3.id}/move`, {
      user: ALICE,
      body: { direction: "up" },
    });
    expect(up.status).toBe(200);
    expect(up.json.moved).toBe(true);
    expect(up.json.storyboard.panels.map((p: any) => p.id)).toEqual([p1.id, p3.id, p2.id]);

    const down = await call("POST", `/api/storyboards/${boardId}/panels/${p3.id}/move`, {
      user: ALICE,
      body: { direction: "down" },
    });
    expect(down.json.moved).toBe(true);
    expect(down.json.storyboard.panels.map((p: any) => p.id)).toEqual([p1.id, p2.id, p3.id]);

    const topNoop = await call("POST", `/api/storyboards/${boardId}/panels/${p1.id}/move`, {
      user: ALICE,
      body: { direction: "up" },
    });
    expect(topNoop.status).toBe(200);
    expect(topNoop.json.moved).toBe(false);
    expect(topNoop.json.storyboard.panels.map((p: any) => p.id)).toEqual([p1.id, p2.id, p3.id]);

    const badDir = await call("POST", `/api/storyboards/${boardId}/panels/${p1.id}/move`, {
      user: ALICE,
      body: { direction: "sideways" },
    });
    expect(badDir.status).toBe(400);
  });

  it("refuses a non-http(s) imageUrl and writes nothing", async () => {
    const boardId = await makeBoard(ALICE);
    const bad = await call("POST", `/api/storyboards/${boardId}/panels`, {
      user: ALICE,
      body: { title: "Sneaky", imageUrl: "javascript:alert(1)" },
    });
    expect(bad.status).toBe(400);
    const got = await call("GET", `/api/storyboards/${boardId}`, { user: ALICE });
    expect(got.json.storyboard.panels).toEqual([]);
  });

  it("normalizes our own storage URL to its permanent ref at write and re-signs at read", async () => {
    const boardId = await makeBoard(ALICE);
    const p = await addPanel(boardId, ALICE, {
      title: "Frame",
      imageUrl: "https://supabase.example/storage/frames/opening.png",
    });
    /* The wire answer is the freshly signed read URL… */
    expect(p.imageUrl).toBe("https://signed.example/frames/opening.png");
    /* …but the stored panel holds the permanent ref, never the signed URL. */
    const stored = h.fake.store("storyboards").rows.find((r: any) => r.id === boardId);
    expect(stored.panels[0].imageUrl).toBe("supabase://bucket/frames/opening.png");
  });

  it("caps the board at STORYBOARD_MAX_PANELS and refuses the append past it", async () => {
    const boardId = await makeBoard(ALICE);
    const row = h.fake.store("storyboards").rows.find((r: any) => r.id === boardId);
    row.panels = Array.from({ length: STORYBOARD_MAX_PANELS }, (_, i) => ({
      id: `seed-${i}`,
      title: `Panel ${i}`,
      notes: "",
      imageUrl: null,
      imagePrompt: null,
    }));
    const over = await call("POST", `/api/storyboards/${boardId}/panels`, {
      user: ALICE,
      body: { title: "One too many" },
    });
    expect(over.status).toBe(400);
    const got = await call("GET", `/api/storyboards/${boardId}`, { user: ALICE });
    expect(got.json.storyboard.panels).toHaveLength(STORYBOARD_MAX_PANELS);
  });
});
