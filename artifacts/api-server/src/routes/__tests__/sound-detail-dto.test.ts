/**
 * Route tests for the sound-page earning-items contract (routes/shorts).
 *
 * THE REGRESSION: GET /sounds/:id builds `videos` with thumbnail_url
 * straight off the profile_videos rows, but the earning_items mapping
 * rebuilt each card as { id, title, price_cents, creator } and dropped
 * thumbnail_url on the floor. The sound page (pages/sound.tsx) declares
 * thumbnail_url on the earning item and gates the <img> on it — so the
 * "Cash in on this sound" cards always rendered the generic music icon
 * and never the video's thumbnail. These tests pin thumbnail_url on the
 * earning item (and that non-selling videos stay out of earning_items).
 *
 * Fake-db style mirrors routes/__tests__/challenges-dto.test.ts: the
 * handler reads through db.execute (raw SQL) — the first execute in the
 * request is the sound meta query, the second is the videos query.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const SOUND_ID = "midnight-bite-sound";
const VID_SALE = "66666666-6666-4666-8666-666666666666";
const VID_FREE = "77777777-7777-4777-8777-777777777777";
const CREATED = new Date("2026-10-14T15:04:05.000Z");

const h = vi.hoisted(() => ({
  state: {
    metaRows: [] as Array<Record<string, unknown>>,
    videoRows: [] as Array<Record<string, unknown>>,
    executeCalls: 0,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "00000000-0000-4000-8000-000000000099";
    next();
  },
}));

vi.mock("../admin", () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (u: string | null) => u ?? null,
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (x: unknown) => x,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => {
        const chain: any = {
          where: (_cond: unknown) => chain,
          orderBy: (..._args: unknown[]) => chain,
          limit: async (_n: number) => [],
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        };
        return chain;
      },
    }),
    /* The sound-detail handler awaits execute() twice, in order:
       meta first, then the videos list. */
    execute: async () => {
      h.state.executeCalls += 1;
      return h.state.executeCalls === 1
        ? { rows: h.state.metaRows }
        : { rows: h.state.videoRows };
    },
  };

  return { ...actual, db: fakeDb };
});

import router from "../shorts";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A profile_videos row exactly as the raw SQL returns it (snake_case). */
function videoRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: VID_SALE,
    title: "Cash Clip",
    video_url: "https://cdn.example.com/clip.mp4",
    thumbnail_url: "https://cdn.example.com/clip-thumb.jpg",
    view_count: 900,
    like_count: 12,
    download_price_cents: 500,
    created_at: CREATED,
    creator_slug: "some-creator",
    creator_name: "Some Creator",
    creator_avatar: "https://cdn.example.com/avatar.png",
    ...overrides,
  };
}

beforeEach(() => {
  h.state.executeCalls = 0;
  h.state.metaRows = [{
    sound_title: "Midnight Bite",
    sound_url: "https://cdn.example.com/sound.mp3",
    use_count: 2,
    earning_count: 1,
  }];
  h.state.videoRows = [
    videoRow(),
    videoRow({
      id: VID_FREE,
      title: "Free Clip",
      thumbnail_url: "https://cdn.example.com/free-thumb.jpg",
      download_price_cents: 0,
    }),
  ];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/sounds/:id — earning_items thumbnail contract", () => {
  it("ships thumbnail_url on the earning item (sound page renders the cover)", async () => {
    const { status, json } = await get(`/sounds/${SOUND_ID}`);

    expect(status).toBe(200);
    expect(json.sound.use_count).toBe(2);
    expect(json.sound.is_earning).toBe(true);
    // The full video list keeps its thumbnails (sibling behavior).
    expect(json.videos).toHaveLength(2);
    expect(json.videos[0].thumbnail_url).toBe("https://cdn.example.com/clip-thumb.jpg");
    // Only the for-sale video earns a card.
    expect(json.earning_items).toHaveLength(1);
    const item = json.earning_items[0];
    expect(item.id).toBe(VID_SALE);
    expect(item.title).toBe("Cash Clip");
    expect(item.price_cents).toBe(500);
    expect(item.creator.display_name).toBe("Some Creator");
    // The regression pin: pages/sound.tsx gates the <img> on this field.
    expect(item.thumbnail_url).toBe("https://cdn.example.com/clip-thumb.jpg");
  });
});
