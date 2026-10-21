/**
 * Route test for GET /saves/mine storage-ref refresh (routes/social).
 *
 * THE DEFECT: /saves/mine returned saved tracks/videos/profiles with
 * their stored media values RAW. Stored values are predominantly
 * storage refs (r2://… / supabase://…) that are NOT playable URLs —
 * sibling read endpoints refresh via refreshSupabaseStorageUrlsDeep,
 * and the post branch of this very handler refreshes via enrichPosts.
 * Only avatar_url / artwork_url / thumbnail_url are exposed for the
 * profile / track / video kinds, so those are the fields pinned here.
 *
 * The objectStorage mock below simulates the real helper's contract
 * (a ref string becomes a fresh signed https URL; everything else,
 * including Dates, passes through) rather than mocking it as identity —
 * an identity mock could never catch a missing refresh call.
 *
 * Fake-db style mirrors routes/__tests__/social-feed-dto.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";
const CREATED = new Date("2026-10-14T15:04:05.000Z");

const h = vi.hoisted(() => ({
  state: {
    saves: [] as Array<Record<string, unknown>>,
    profiles: [] as Array<Record<string, unknown>>,
    tracks: [] as Array<Record<string, unknown>>,
    videos: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = VIEWER_ID;
    next();
  },
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => {
    throw new Error("no AI in route tests");
  },
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: async () => undefined,
  refundCredits: async () => undefined,
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
  addCreditsToProfile: async () => undefined,
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
}));

vi.mock("../../lib/social-crypto", () => ({
  encryptToken: (s: string) => s,
  decryptToken: (s: string) => s,
  isSocialTokenKeyConfigured: () => false,
}));

vi.mock("../../lib/social-meta", () => ({
  buildAuthUrl: () => "",
  buildFacebookAuthUrl: () => "",
  exchangeCodeForLongLivedToken: async () => {
    throw new Error("no Meta in route tests");
  },
  exchangeFacebookCodeForLongLivedToken: async () => {
    throw new Error("no Meta in route tests");
  },
  fetchInstagramProfile: async () => {
    throw new Error("no Meta in route tests");
  },
  listPages: async () => [],
  publishReelToInstagram: async () => {
    throw new Error("no Meta in route tests");
  },
  publishVideoToPage: async () => {
    throw new Error("no Meta in route tests");
  },
  MetaApiError: class MetaApiError extends Error {},
}));

vi.mock("../../lib/social-idempotency", () => ({
  claimPublishAttempt: async () => ({ claimed: true }),
  createDrizzleAttemptStore: () => ({}),
}));

vi.mock("../../lib/social-tiktok", () => ({
  buildTikTokAuthUrl: () => "",
  exchangeCodeForTikTokTokens: async () => {
    throw new Error("no TikTok in route tests");
  },
  refreshTikTokTokens: async () => {
    throw new Error("no TikTok in route tests");
  },
  fetchTikTokUserInfo: async () => {
    throw new Error("no TikTok in route tests");
  },
  uploadDraftToTikTok: async () => {
    throw new Error("no TikTok in route tests");
  },
  downloadVideoBytes: async () => new Uint8Array(),
  TikTokApiError: class TikTokApiError extends Error {},
}));

/* Simulated refresh: refs (r2:// / supabase://) become signed https
   URLs; plain objects/arrays are walked; Dates and other values pass
   through untouched — mirroring refreshSupabaseStorageUrlsDeep. */
function signedFor(ref: string): string {
  return `https://signed.example.com/${ref.replace(/^(r2|supabase):\/\//, "")}?sig=test`;
}
async function deepRefresh(v: unknown): Promise<unknown> {
  if (typeof v === "string") {
    return v.startsWith("r2://") || v.startsWith("supabase://") ? signedFor(v) : v;
  }
  if (Array.isArray(v)) return Promise.all(v.map((x) => deepRefresh(x)));
  if (v !== null && typeof v === "object" && !(v instanceof Date)) {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      const entries = await Promise.all(
        Object.entries(v as Record<string, unknown>).map(
          async ([k, val]) => [k, await deepRefresh(val)] as const,
        ),
      );
      return Object.fromEntries(entries);
    }
  }
  return v;
}

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://"))
      ? signedFor(v)
      : v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => deepRefresh(v),
  isStorageRef: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable,
    profileTracksTable,
    profileVideosTable,
    savesTable,
  } = actual;

  function rowsFor(table: unknown): unknown[] {
    if (table === savesTable) return state.saves;
    if (table === creatorProfilesTable) return state.profiles;
    if (table === profileTracksTable) return state.tracks;
    if (table === profileVideosTable) return state.videos;
    return [];
  }

  function chain(table: unknown): any {
    const c: any = {
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table)).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => chain(table),
    }),
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => Promise.resolve(),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../social";

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

beforeEach(() => {
  h.state.saves = [
    { userId: VIEWER_ID, kind: "track", targetId: TRACK_ID, createdAt: CREATED },
    { userId: VIEWER_ID, kind: "video", targetId: VIDEO_ID, createdAt: CREATED },
    { userId: VIEWER_ID, kind: "profile", targetId: PROFILE_ID, createdAt: CREATED },
  ];
  h.state.tracks = [
    {
      id: TRACK_ID,
      profileId: PROFILE_ID,
      title: "Saved Song",
      artworkUrl: "r2://media/artwork.jpg",
    },
  ];
  h.state.videos = [
    {
      id: VIDEO_ID,
      profileId: PROFILE_ID,
      title: "Saved Video",
      thumbnailUrl: "supabase://media/thumb.jpg",
    },
  ];
  h.state.profiles = [
    {
      id: PROFILE_ID,
      userId: VIEWER_ID,
      slug: "some-creator",
      displayName: "Some Creator",
      avatarUrl: "r2://media/avatar.png",
      isVerified: true,
    },
  ];
});

describe("GET /api/saves/mine — storage refs are refreshed at the response boundary", () => {
  it("returns refreshed (non-ref) URLs for saved track artwork, video thumbnail and profile avatar", async () => {
    const r = await realFetch(`${baseUrl}/saves/mine`);
    const json: any = await r.json().catch(() => null);

    expect(r.status).toBe(200);
    expect(json.saves).toHaveLength(3);

    const trackSave = json.saves.find((s: any) => s.kind === "track");
    expect(trackSave.target_id).toBe(TRACK_ID);
    expect(trackSave.track.title).toBe("Saved Song");
    expect(trackSave.track.artwork_url).toBe("https://signed.example.com/media/artwork.jpg?sig=test");
    expect(trackSave.track.artwork_url).not.toMatch(/^(r2|supabase):\/\//);

    const videoSave = json.saves.find((s: any) => s.kind === "video");
    expect(videoSave.target_id).toBe(VIDEO_ID);
    expect(videoSave.video.title).toBe("Saved Video");
    expect(videoSave.video.thumbnail_url).toBe("https://signed.example.com/media/thumb.jpg?sig=test");
    expect(videoSave.video.thumbnail_url).not.toMatch(/^(r2|supabase):\/\//);

    const profileSave = json.saves.find((s: any) => s.kind === "profile");
    expect(profileSave.target_id).toBe(PROFILE_ID);
    expect(profileSave.profile.slug).toBe("some-creator");
    expect(profileSave.profile.avatar_url).toBe("https://signed.example.com/media/avatar.png?sig=test");
    expect(profileSave.profile.avatar_url).not.toMatch(/^(r2|supabase):\/\//);

    // Shape otherwise unchanged: saved_at still serializes as ISO.
    expect(trackSave.saved_at).toBe("2026-10-14T15:04:05.000Z");
  });
});
