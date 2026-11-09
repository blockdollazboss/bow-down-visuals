/**
 * CA-R concurrent-twin tests (Stack 400 charge-audit follow-on CA-R).
 *
 * The audit's EXPOSED-RACE class: two identical requests arriving at the
 * same moment both passed the read-check and both charged, because the
 * charge landed before the state flip and nothing atomically claimed
 * the transition. The fix at every site below is the same shape in the
 * site's own clothes — the state transition itself becomes the claim
 * (guarded UPDATE ... WHERE pre-state, or an INSERT under the table's
 * UNIQUE with ON CONFLICT DO NOTHING) and it lands BEFORE the charge;
 * the loser stops at the site's existing 409/duplicate answer with zero
 * charges, the winner charges exactly once.
 *
 * Each twin test fires both requests with NO await between them and
 * then asserts: exactly one success, exactly one loser answer, exactly
 * one charge, no refunds. The harness evaluates WHERE predicates when
 * the write APPLIES (not when it is constructed) — the reach fake
 * defers update application to a microtask, and the pg-mem suite for
 * the distribution submit lives in distribution.test.ts — so both
 * twins genuinely pass the pre-check before either claim lands.
 * (Site 2, distribution submit, is raw-SQL and covered there; site 6,
 * bio publish, is covered in bio-pages-publish.test.ts.)
 *
 * Sites covered here:
 *   1. POST /producer-tag/approve        (guarded flip, 100 VB)
 *   3. POST /catalog-vault/vault         (insert claim, 200 VB)
 *   4. POST /press-kit/generate          (insert claim, bio runs twice
 *                                         at most — never charged twice)
 *   5. POST /album-publish/:id           (guarded flip, 300 VB)
 *   7. PATCH /scheduler/posts/:id        (draft→scheduled claim, 100 VB)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { createFakeDb } from "./_reach-fake-db";

const dialect = new PgDialect();
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RELEASE_ID = "123e4567-e89b-42d3-a456-426614174000";

const h = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof createFakeDb>,
  balance: 100000,
  charges: [] as number[],
  refunds: [] as number[],
  aiCalls: 0,
  /* Charge barrier (site 7 only — see that test): when armed,
     chargeCredits callers wait until `parties` of them have arrived,
     then all proceed. Other sites leave it disarmed. */
  chargeBarrier: null as null | {
    parties: number;
    arrived: number;
    promise: Promise<void>;
    release: () => void;
  },
}));

function armChargeBarrier(parties: number) {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  /* Safety: never hang the suite if a twin never reaches the charge —
     release late and let the assertions report the real failure. */
  setTimeout(release, 5000).unref?.();
  h.chargeBarrier = { parties, arrived: 0, promise, release };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = OWNER;
    req.userCredits = h.balance;
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {}
  class LedgerWriteError extends Error {}
  return {
    OutOfCreditsError,
    LedgerWriteError,
    getUserCreditBalance: async () => h.balance,
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
      const ck = typeof clientKey === "string" && clientKey.trim().length >= 8 ? clientKey.trim() : null;
      return ck ? `${scope}:${userId}:client:${ck}` : `${scope}:${userId}:${JSON.stringify(intent ?? {})}`;
    },
    voidChargeIdempotencyKey: async () => {},
    chargeCredits: async (_userId: string, amount: number) => {
      const barrier = h.chargeBarrier;
      if (barrier) {
        barrier.arrived += 1;
        if (barrier.arrived >= barrier.parties) barrier.release();
        await barrier.promise;
      }
      if (h.balance < amount) throw new OutOfCreditsError("insufficient");
      h.balance -= amount;
      h.charges.push(amount);
      return h.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      h.balance += amount;
      h.refunds.push(amount);
    },
  };
});

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/objectStorage", () => ({
  objectStorageClient: {},
  uploadMediaToSupabaseStorage: async () => null,
  refreshSupabaseStorageUrl: async (v: any) => v,
  refreshSupabaseStorageUrlsDeep: async (v: any) => v,
  isStorageRef: () => false,
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
  }),
}));

vi.mock("../../lib/view-counting", () => ({
  shouldCountView: () => false,
  viewKey: () => "k",
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: any) => v ?? null,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

/* AI doubles: the press-kit bio writer and the tag draft renderer both
   ride getOpenAI; the bio text must clear the 40-char minimum. */
vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.aiCalls += 1;
          return {
            choices: [
              {
                message: {
                  content:
                    "A boundary-pushing producer from Detroit whose records pair dusty soul samples with stadium-sized drums, currently rolling out a run of singles toward a debut full-length.",
                },
              },
            ],
          };
        },
      },
    },
  }),
  getTextModel: () => "gpt-6-sol",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

vi.mock("../../lib/job-poller", () => ({ requestPollerTick: vi.fn() }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fake = createFakeDb(
    {
      producerTags: actual.producerTagsTable,
      catalogVaults: actual.catalogVaultsTable,
      pressKits: actual.pressKitsTable,
      albums: actual.albumsTable,
      albumTracks: actual.albumTracksTable,
      songs: actual.songsTable,
      scheduledPosts: actual.scheduledPostsTable,
    },
    {
      catalogVaults: [["userId", "releaseId"]],
      pressKits: [["handle"]],
    },
  );
  const db: any = {
    ...fake.db,
    /* Raw-SQL reads (catalog vault's owned-release lookup) ride
       db.execute in production; answer from the harness marker the
       test sets before each vault call. */
    execute: async (query: any) => {
      const rendered = dialect.sqlToQuery(query);
      if (rendered.sql.includes("distribution_releases")) {
        const found = rendered.params.some((p: unknown) => p === RELEASE_ID);
        return { rows: found ? [{ id: RELEASE_ID, title: "Vaulted Single" }] : [] };
      }
      return { rows: [] };
    },
    /* albumDetail joins album_tracks to songs for the response. The
       reach fake has no join support; approximate the join by merging
       the seeded song's display fields onto the track rows (the twin
       test asserts status + charge, not the track payload). */
    select: (fields?: any) => {
      const chain = fake.db.select(fields);
      const from = chain.from.bind(chain);
      chain.from = (table: unknown) => {
        const inner = from(table);
        if (fields && typeof fields === "object" && "song_id" in fields) {
          inner.innerJoin = () => inner;
          const runThen = inner.then.bind(inner);
          inner.then = (res: any, rej: any) =>
            runThen((rows: any[]) => {
              const songs = h.fake!.store("songs").rows;
              return res(
                rows.map((r: any) => {
                  const song = songs.find((s: any) => s.id === r.song_id);
                  return song
                    ? { ...r, title: song.title, audio_url: song.audio_url, source: song.source }
                    : r;
                }),
              );
            }, rej);
        }
        return inner;
      };
      return chain;
    },
  };
  h.fake = fake;
  return { ...actual, db };
});

import producerTagRouter from "../generate/producer-tag-lifecycle";
import milestonesRouter from "../generate/milestones";
import pressKitRouter from "../generate/press-kit";
import albumsRouter from "../albums";
import schedulerRouter from "../scheduler";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", producerTagRouter);
  app.use("/api", milestonesRouter);
  app.use("/api", pressKitRouter);
  app.use("/api", albumsRouter);
  app.use("/api", schedulerRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.fake!.clear();
  h.balance = 100000;
  h.charges = [];
  h.refunds = [];
  h.aiCalls = 0;
  h.chargeBarrier = null;
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("CA-R site 1 — POST /producer-tag/approve", () => {
  it("concurrent approvals charge exactly once; the loser gets the 409", async () => {
    /* A prior ACTIVE tag makes this approval the paid kind (the first
       approval is the free gift) and gives the winner an incumbent to
       demote — the full claim path. */
    const priorId = randomUUID();
    const draftId = randomUUID();
    h.fake!.seed("producerTags", [
      {
        id: priorId,
        userId: OWNER,
        status: "active",
        stampEnabled: true,
        approvedAt: new Date(),
        priceCharged: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: draftId,
        userId: OWNER,
        status: "draft",
        stampEnabled: false,
        approvedAt: null,
        priceCharged: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const [a, b] = await Promise.all([
      req("POST", "/producer-tag/approve", { tagId: draftId }),
      req("POST", "/producer-tag/approve", { tagId: draftId }),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.error).toBe("That tag is no longer a draft.");
    expect(h.charges).toEqual([100]);
    expect(h.refunds).toEqual([]);
    const rows = h.fake!.store("producerTags").rows;
    expect(rows.find((r) => r.id === draftId)!.status).toBe("active");
    expect(rows.find((r) => r.id === priorId)!.status).toBe("replaced");
  });
});

describe("CA-R site 3 — POST /catalog-vault/vault", () => {
  it("concurrent vaults charge exactly once; the loser gets alreadyVaulted", async () => {
    const [a, b] = await Promise.all([
      req("POST", "/catalog-vault/vault", { releaseId: RELEASE_ID }),
      req("POST", "/catalog-vault/vault", { releaseId: RELEASE_ID }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const winner = a.json.vaulted === true ? a : b;
    const loser = winner === a ? b : a;
    expect(winner.json.vaulted).toBe(true);
    expect(loser.json.alreadyVaulted).toBe(true);
    expect(h.charges).toEqual([200]);
    expect(h.refunds).toEqual([]);
    expect(h.fake!.store("catalogVaults").rows).toHaveLength(1);
  });
});

describe("CA-R site 4 — POST /press-kit/generate", () => {
  it("concurrent generates charge exactly once; the loser gets handle_taken", async () => {
    const body = { handle: "ca-race-kit", artist_name: "Race Artist" };
    const [a, b] = await Promise.all([
      req("POST", "/press-kit/generate", body),
      req("POST", "/press-kit/generate", body),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.error).toBe("handle_taken");
    expect(h.charges).toEqual([300]);
    expect(h.refunds).toEqual([]);
    expect(h.fake!.store("pressKits").rows).toHaveLength(1);
  });
});

describe("CA-R site 5 — POST /album-publish/:id", () => {
  it("concurrent publishes charge exactly once; the loser gets the 409", async () => {
    const albumId = randomUUID();
    const songId = randomUUID();
    h.fake!.seed("albums", [
      {
        id: albumId,
        user_id: OWNER,
        title: "Race Album",
        slug: null,
        album_type: "album",
        release_notes: "",
        cover_art_url: null,
        status: "draft",
        views: 0,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    h.fake!.seed("albumTracks", [
      { id: randomUUID(), album_id: albumId, song_id: songId, position: 0, created_at: new Date() },
    ]);
    h.fake!.seed("songs", [
      {
        id: songId,
        user_id: OWNER,
        title: "Race Song",
        audio_url: "https://example.com/song.mp3",
        source: "upload",
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    /* Warm the publish pipeline so both twins genuinely overlap. */
    await req("POST", `/album-publish/${randomUUID()}`);
    const [a, b] = await Promise.all([
      req("POST", `/album-publish/${albumId}`),
      req("POST", `/album-publish/${albumId}`),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.error).toBe("Album is already published.");
    expect(h.charges).toEqual([300]);
    expect(h.refunds).toEqual([]);
    expect(h.fake!.store("albums").rows[0]!.status).toBe("published");
  });
});

describe("CA-R site 7 — PATCH /scheduler/posts/:id (draft → scheduled)", () => {
  it("concurrent schedule requests charge exactly once; the loser gets the 409", async () => {
    const postId = randomUUID();
    const accountId = randomUUID();
    h.fake!.seed("scheduledPosts", [
      {
        id: postId,
        user_id: OWNER,
        status: "draft",
        media_url: "https://example.com/clip.mp4",
        media_type: "video",
        caption: "race post",
        hashtags: "",
        platforms: ["instagram"],
        account_ids: { instagram: accountId },
        scheduled_at: null,
        posted_at: null,
        attempts: 0,
        last_error: null,
        credits_charged: 0,
        credits_refunded: false,
        release_id: null,
        provenance: null,
        ai_best_time: null,
        results: [],
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const when = new Date(Date.now() + 3_600_000).toISOString();
    /* Warm the patch pipeline (module loading, first-run costs) with
       a caption edit on the twin's own post — same handler path, no
       charge. The OVERLAP itself is forced by the charge barrier
       below: this handler pre-reads the post BEFORE charging, and
       with an in-memory harness every await resolves at microtask
       level, so without the barrier request 1 runs to completion
       before request 2's handler even starts (it then pre-reads
       'scheduled' and takes the legitimate free reschedule path).
       The barrier holds the first twin inside chargeCredits until
       the second arrives — both pre-reads saw 'draft', both charges
       land, and the twins then race the guarded UPDATE, whose WHERE
       the fake evaluates when each write applies. The same race on
       real Postgres semantics is proven in ca-races-pg.test.ts. */
    await req("PATCH", `/scheduler/posts/${postId}`, { caption: "warm" });
    armChargeBarrier(2);
    const [a, b] = await Promise.all([
      req("PATCH", `/scheduler/posts/${postId}`, { scheduledAt: when }),
      req("PATCH", `/scheduler/posts/${postId}`, { scheduledAt: when }),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.error).toBe("not_editable");
    /* Both twins charge before the guarded flip (the audit's defect
       shape); the loser's charge is refunded in full when its flip
       matches 0 rows, so exactly one charge NETS. */
    expect(h.charges).toEqual([100, 100]);
    expect(h.refunds).toEqual([100]);
    expect(h.balance).toBe(100000 - 100);
    const row = h.fake!.store("scheduledPosts").rows[0]!;
    expect(row.status).toBe("scheduled");
    expect(row.credits_charged).toBe(100);
  });
});
