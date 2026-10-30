/**
 * Thumbnail Duels (#174) — ROUTE flows. The pure rules have their own
 * suite (lib/__tests__/thumbnail-duels.test.ts); this one proves the
 * shipped endpoints end to end against the house fake db:
 *
 *  - create: owner-only, videos only, one running duel per video,
 *    cover A defaults to the video's current thumbnail, target clamped;
 *  - serve: rotation alternates and every serve is a counted view;
 *  - vote (the duel-click): ONE counted click per audience member per
 *    cover, enforced server-side by the clicks table's unique key —
 *    repeat clicks from the same member move nothing;
 *  - settle: at the view target, the click that makes a leader resolves
 *    the duel AND the winner takes over as the video's thumbnail; a
 *    click tie at the target keeps the duel running;
 *  - cancel + the owner's results read + /showcase/mine scoping.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const VIDEO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIDEO_SLUG = "my-video";
const OTHER_VIDEO_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SONG_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COVER_A = "https://cdn.example/cover-a.png";
const COVER_B = "https://cdn.example/cover-b.png";

const h = vi.hoisted(() => ({ fake: null as any, userId: "" }));
h.userId = ME;

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

/* Mirroring is a storage concern; routes fall back to the given URL. */
vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async () => null),
}));

vi.mock("../generate/auto-chapters", () => ({
  transcribeAudioUrl: vi.fn(),
  detectTimedChapters: vi.fn(),
  sanitizeTimedChapters: vi.fn((rows: unknown) => rows),
  generateSummaryFromTranscript: vi.fn(),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: unknown) => x),
  uploadMediaToSupabaseStorage: vi.fn(),
  refreshSupabaseStorageUrl: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb(
    {
      showcaseItems: actual.showcaseItemsTable,
      thumbnailDuels: actual.thumbnailDuelsTable,
      thumbnailDuelClicks: actual.thumbnailDuelClicksTable,
    },
    { thumbnailDuelClicks: [["duel_id", "cover", "voter_key"]] },
  );
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import playerUpgradesRouter from "../player-upgrades";
import showcaseRouter from "../showcase";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    /* Test-voter shim: the audience key is hash(ip|user-agent); let a
       test name its voter via x-test-voter for deterministic dedupe. */
    const voter = req.headers["x-test-voter"];
    if (typeof voter === "string") req.headers["user-agent"] = voter;
    next();
  });
  app.use(playerUpgradesRouter);
  app.use(showcaseRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

function seedItems() {
  h.fake.seed("showcaseItems", [
    {
      id: VIDEO_ID, user_id: ME, slug: VIDEO_SLUG, title: "My Video", description: "",
      media_type: "video", media_url: "https://cdn.example/video.mp4",
      thumbnail_url: COVER_A, creator_name: "Thy Cheat Code", likes: 0, views: 0,
      created_at: new Date("2026-10-01T00:00:00Z"),
    },
    {
      id: OTHER_VIDEO_ID, user_id: OTHER, slug: "their-video", title: "Their Video", description: "",
      media_type: "video", media_url: "https://cdn.example/theirs.mp4",
      thumbnail_url: "https://cdn.example/theirs.png", creator_name: "Someone Else", likes: 0, views: 0,
      created_at: new Date("2026-10-02T00:00:00Z"),
    },
    {
      id: SONG_ID, user_id: ME, slug: "my-song", title: "My Song", description: "",
      media_type: "song", media_url: "https://cdn.example/song.mp3",
      thumbnail_url: "https://cdn.example/song.png", creator_name: "Thy Cheat Code", likes: 0, views: 0,
      created_at: new Date("2026-10-03T00:00:00Z"),
    },
  ]);
}

beforeEach(() => {
  h.fake.clear();
  h.userId = ME;
  seedItems();
});

async function call(method: string, path: string, body?: unknown, voter?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(voter ? { "x-test-voter": voter } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
const post = (path: string, body?: unknown, voter?: string) => call("POST", path, body, voter);
const get = (path: string, voter?: string) => call("GET", path, undefined, voter);

async function serveTimes(n: number) {
  let last: any = null;
  for (let i = 0; i < n; i++) last = (await get(`/showcase/${VIDEO_SLUG}/duel-cover`)).body;
  return last;
}

/* ─── /showcase/mine ─────────────────────────────────────────────────── */

describe("GET /showcase/mine", () => {
  it("returns only the signed-in creator's items", async () => {
    const { status, body } = await get("/showcase/mine");
    expect(status).toBe(200);
    const ids = body.items.map((i: any) => i.id).sort();
    expect(ids).toEqual([VIDEO_ID, SONG_ID].sort());
  });
});

/* ─── create ─────────────────────────────────────────────────────────── */

describe("POST /showcase-items/:itemId/duel — create", () => {
  it("starts a running duel; cover A defaults to the video's current thumbnail", async () => {
    const { status, body } = await post(`/showcase-items/${VIDEO_ID}/duel`, { coverBUrl: COVER_B });
    expect(status).toBe(200);
    expect(body.duel.status).toBe("running");
    expect(body.duel.cover_a_url).toBe(COVER_A);
    expect(body.duel.cover_b_url).toBe(COVER_B);
    expect(body.duel.target_views).toBe(100);
    expect(body.results).toMatchObject({ viewsA: 0, viewsB: 0, clicksA: 0, clicksB: 0, totalViews: 0 });
  });

  it("honours an explicit cover A and clamps the target into the band", async () => {
    const { body } = await post(`/showcase-items/${VIDEO_ID}/duel`, {
      coverAUrl: "https://cdn.example/alt-a.png",
      coverBUrl: COVER_B,
      targetViews: 3,
    });
    expect(body.duel.cover_a_url).toBe("https://cdn.example/alt-a.png");
    expect(body.duel.target_views).toBe(20);
  });

  it("refuses a second running duel for the same video (409)", async () => {
    await post(`/showcase-items/${VIDEO_ID}/duel`, { coverBUrl: COVER_B });
    const { status } = await post(`/showcase-items/${VIDEO_ID}/duel`, { coverBUrl: COVER_B });
    expect(status).toBe(409);
  });

  it("refuses a duel when the video has no thumbnail and no cover A is passed (400)", async () => {
    h.fake.store("showcaseItems").rows.find((r: any) => r.id === VIDEO_ID).thumbnail_url = null;
    const { status } = await post(`/showcase-items/${VIDEO_ID}/duel`, { coverBUrl: COVER_B });
    expect(status).toBe(400);
  });

  it("is for videos only — a song item is refused (400)", async () => {
    const { status } = await post(`/showcase-items/${SONG_ID}/duel`, { coverBUrl: COVER_B });
    expect(status).toBe(400);
  });

  it("is owner-only — another creator's video reads as not found (404)", async () => {
    const { status } = await post(`/showcase-items/${OTHER_VIDEO_ID}/duel`, { coverBUrl: COVER_B });
    expect(status).toBe(404);
  });
});

/* ─── serve / rotation ───────────────────────────────────────────────── */

describe("GET /showcase/:slug/duel-cover — serve", () => {
  it("answers duel:null when no duel is running, 404 for an unknown slug", async () => {
    expect((await get(`/showcase/${VIDEO_SLUG}/duel-cover`)).body).toEqual({ duel: null });
    expect((await get(`/showcase/nope/duel-cover`)).status).toBe(404);
  });

  it("serves both covers in rotation and counts every serve as a view", async () => {
    await post(`/showcase-items/${VIDEO_ID}/duel`, { coverBUrl: COVER_B });
    const covers: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { body } = await get(`/showcase/${VIDEO_SLUG}/duel-cover`);
      covers.push(body.duel.cover);
    }
    expect(covers).toEqual(["a", "b", "a", "b"]);
    const { body } = await get(`/showcase-items/${VIDEO_ID}/duel`);
    expect(body.results).toMatchObject({ viewsA: 2, viewsB: 2, totalViews: 4 });
  });
});

/* ─── vote (duel-click) — one counted click per person per cover ─────── */

describe("POST /showcase/:slug/duel-click — vote dedupe", () => {
  it("counts one click per audience member per cover, enforced server-side", async () => {
    await post(`/showcase-items/${VIDEO_ID}/duel`, { coverBUrl: COVER_B });
    await serveTimes(2);
    /* Same member, same cover, three times → still ONE counted click. */
    await post(`/showcase/${VIDEO_SLUG}/duel-click`, { cover: "a" }, "voter-1");
    await post(`/showcase/${VIDEO_SLUG}/duel-click`, { cover: "a" }, "voter-1");
    const third = await post(`/showcase/${VIDEO_SLUG}/duel-click`, { cover: "a" }, "voter-1");
    expect(third.body.duel.results.clicksA).toBe(1);
    /* The same member may still back the OTHER cover once… */
    const other = await post(`/showcase/${VIDEO_SLUG}/duel-click`, { cover: "b" }, "voter-1");
    expect(other.body.duel.results.clicksB).toBe(1);
    /* …and a different member's click on A counts. */
    const second = await post(`/showcase/${VIDEO_SLUG}/duel-click`, { cover: "a" }, "voter-2");
    expect(second.body.duel.results.clicksA).toBe(2);
    expect(second.body.duel.status).toBe("running");
  });
});

/* ─── settle ─────────────────────────────────────────────────────────── */

describe("duel settle — automatic winner takeover", () => {
  it("resolves at the target when a click makes a leader, and the winner becomes the thumbnail", async () => {
    await post(`/showcase-items/${VIDEO_ID}/duel`, { coverBUrl: COVER_B, targetViews: 20 });
    await serveTimes(20); // 10 views each — target reached, no clicks yet
    const click = await post(`/showcase/${VIDEO_SLUG}/duel-click`, { cover: "b" }, "voter-1");
    expect(click.body.duel.status).toBe("resolved");
    expect(click.body.duel.winner).toBe("b");
    expect(click.body.duel.results).toMatchObject({ viewsA: 10, viewsB: 10, clicksB: 1 });
    /* The takeover: the item's stored thumbnail is now cover B. */
    const row = h.fake.store("showcaseItems").rows.find((r: any) => r.id === VIDEO_ID);
    expect(row.thumbnail_url).toBe(COVER_B);
    /* And the duel no longer serves. */
    expect((await get(`/showcase/${VIDEO_SLUG}/duel-cover`)).body).toEqual({ duel: null });
    /* The owner's read shows the resolved verdict with real counts. */
    const mine = await get(`/showcase-items/${VIDEO_ID}/duel`);
    expect(mine.body.duel.status).toBe("resolved");
    expect(mine.body.duel.winner).toBe("b");
  });

  it("a click tie carried to the target keeps the duel running until a click breaks it", async () => {
    await post(`/showcase-items/${VIDEO_ID}/duel`, { coverBUrl: COVER_B, targetViews: 20 });
    await serveTimes(4); // 2 views each — below the target
    /* The tie forms BELOW the target: 1–1 on clicks while views are short. */
    const tieA = await post(`/showcase/${VIDEO_SLUG}/duel-click`, { cover: "a" }, "voter-1");
    expect(tieA.body.duel.status).toBe("running");
    const tieB = await post(`/showcase/${VIDEO_SLUG}/duel-click`, { cover: "b" }, "voter-2");
    expect(tieB.body.duel.status).toBe("running");
    /* Views carry the duel to the target with the clicks still tied —
       no winner is declared on a tie, so it keeps running… */
    await serveTimes(16); // 20 total views
    const owner = await get(`/showcase-items/${VIDEO_ID}/duel`);
    expect(owner.body.duel.status).toBe("running");
    expect(owner.body.results).toMatchObject({ totalViews: 20, clicksA: 1, clicksB: 1 });
    /* …until one more click breaks it. */
    const broken = await post(`/showcase/${VIDEO_SLUG}/duel-click`, { cover: "a" }, "voter-3");
    expect(broken.body.duel.status).toBe("resolved");
    expect(broken.body.duel.winner).toBe("a");
  });

  it("below the target, a click lead alone never resolves", async () => {
    await post(`/showcase-items/${VIDEO_ID}/duel`, { coverBUrl: COVER_B, targetViews: 100 });
    await serveTimes(4);
    const click = await post(`/showcase/${VIDEO_SLUG}/duel-click`, { cover: "a" }, "voter-1");
    expect(click.body.duel.status).toBe("running");
    expect(click.body.duel.results.totalViews).toBe(4);
  });
});

/* ─── owner read + cancel ────────────────────────────────────────────── */

describe("owner read + cancel", () => {
  it("reads duel:null before any duel exists", async () => {
    expect((await get(`/showcase-items/${VIDEO_ID}/duel`)).body).toEqual({ duel: null });
  });

  it("cancel stops the duel; a second cancel 404s; the video can duel again", async () => {
    await post(`/showcase-items/${VIDEO_ID}/duel`, { coverBUrl: COVER_B });
    const cancelled = await post(`/showcase-items/${VIDEO_ID}/duel/cancel`);
    expect(cancelled.body.duel.status).toBe("cancelled");
    expect((await get(`/showcase/${VIDEO_SLUG}/duel-cover`)).body).toEqual({ duel: null });
    expect((await post(`/showcase-items/${VIDEO_ID}/duel/cancel`)).status).toBe(404);
    const again = await post(`/showcase-items/${VIDEO_ID}/duel`, { coverBUrl: COVER_B });
    expect(again.status).toBe(200);
    expect(again.body.duel.status).toBe("running");
  });
});
