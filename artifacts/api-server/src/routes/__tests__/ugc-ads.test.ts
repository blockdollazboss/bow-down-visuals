/**
 * Route tests for UGC Product Ads (routes/ugc-ads — owner order
 * Oct 19, 2026):
 *   GET    /api/ugc-ads/products          my shop products (one-tap source)
 *   POST   /api/ugc-ads/script            Turbo writes the script (free)
 *   POST   /api/ugc-ads/persona           generated creator face (100 VB)
 *   GET    /api/ugc-ads                   my ads
 *   POST   /api/ugc-ads                   start an ad (draft)
 *   GET    /api/ugc-ads/:id               mine — or delivered to my brief
 *   PATCH  /api/ugc-ads/:id               draft edits only
 *   DELETE /api/ugc-ads/:id               row only
 *   POST   /api/ugc-ads/:id/generate      the video (400 VB, gen4.5 rail)
 *
 * Contract pinned here:
 * - A shop product's name/price/image are snapshotted from the
 *   shop_products row itself — client-sent values for a shop product
 *   are ignored. Another member's product is a 404.
 * - Owner-scoping: a foreign ad is a 404 on read, edit, delete, and
 *   generate, and a foreign generate never reaches the charge.
 * - The single read exception: the brand a brief was DELIVERED to can
 *   read that ad (viaBriefId) to review it before approving.
 * - Money: generate charges UGC_VIDEO_CREDIT_COST (400 = the gen4.5
 *   flat rate from clip-pricing) BEFORE the provider call, keyed by
 *   buildChargeIdempotencyKey; a provider failure refunds in full and
 *   the ad lands in `failed` with the reason kept; a retry is a new
 *   attempt with a NEW key; a ready ad replays free (alreadyGenerated).
 * - Persona charges 100 (the artist-image sunburst rate), refunds on
 *   failure, and refuses at 402 before any charge when the balance is
 *   short.
 * - Captions: the caption track is the script's lines, server-built;
 *   captionsBurned is true only when the burn actually landed.
 * - An ad can only be started against a brief the caller has CLAIMED;
 *   the brief pre-fills product + style the caller didn't supply.
 *
 * Driven against the REAL Express router on an ephemeral server with
 * the house _reach-fake-db, mocked auth (x-test-user), mocked credits,
 * a mocked Runway SDK, and a stubbed provider download.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-00000000b0b5";

const h = vi.hoisted(() => ({
  fake: null as any,
  chargeCalls: [] as any[],
  refundCalls: [] as any[],
  chargeMode: "ok" as "ok" | "out_of_credits",
  aiMode: "ok" as "ok" | "garbage" | "fail",
  runwayMode: "ok" as "ok" | "fail",
  runwayCalls: [] as any[],
  brandKit: null as any,
  mirrorCalls: [] as any[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    req.userCredits = Number(req.headers["x-test-credits"] ?? 10000);
    req.log = { info: () => {}, error: () => {}, warn: () => {} };
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  generationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {}
  return {
    OutOfCreditsError,
    LedgerWriteError: class LedgerWriteError extends Error {},
    chargeCredits: vi.fn(async (userId: string, cost: number, record: any, opts: any) => {
      h.chargeCalls.push({ userId, cost, record, opts });
      if (h.chargeMode === "out_of_credits") throw new OutOfCreditsError("nope");
      return 10000 - cost;
    }),
    refundCredits: vi.fn(async (userId: string, cost: number, record: any) => {
      h.refundCalls.push({ userId, cost, record });
    }),
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) =>
      typeof clientKey === "string" && clientKey.trim().length >= 8
        ? `${scope}:${userId}:client:${clientKey.trim()}`
        : `${scope}:${userId}:${typeof intent === "string" ? intent : JSON.stringify(intent)}`,
  };
});

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          if (h.aiMode === "fail") throw new Error("provider down");
          if (h.aiMode === "garbage") {
            return { choices: [{ message: { content: JSON.stringify({ hook: "", lines: [] }) } }] };
          }
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    hook: "Okay, I finally tried it.",
                    lines: ["First thing — the quality is unreal.", "I've used it every day this week."],
                    cta: "Link's in my shop — go look.",
                  }),
                },
              },
            ],
          };
        },
      },
    },
    images: {
      generate: async () => {
        if (h.aiMode === "fail") throw new Error("provider down");
        return { data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }] };
      },
    },
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  SUPABASE_CLIPS_BUCKET: "generated-clips",
  normalizeToStorageRef: (v: string | null | undefined) => {
    if (v == null) return null;
    const m = /^https:\/\/supabase\.example\/storage\/(.+)$/.exec(v);
    return m ? `supabase://generated-clips/${m[1]}` : v;
  },
  refreshSupabaseStorageUrl: async (v: string) => {
    const m = /^supabase:\/\/generated-clips\/(.+)$/.exec(v);
    if (m) return `https://signed.example/${m[1]}`;
    const pub = /^https:\/\/supabase\.example\/storage\/(.+)$/.exec(v);
    if (pub) return `https://signed.example/${pub[1]}`;
    return v;
  },
  uploadPublicMediaToR2: async (_bucket: string, path: string) => `https://r2.test/${path}`,
  uploadFileStreamToSupabaseStorage: async (_bucket: string, path: string) => `supabase://generated-clips/${path}`,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: string) => {
    h.mirrorCalls.push(v);
    return `r2://mirrored/${encodeURIComponent(v)}`;
  },
}));

vi.mock("../../lib/brand-record", () => ({
  readBrandKit: async () => h.brandKit,
}));

vi.mock("@runwayml/sdk", () => {
  class FakeRunway {
    imageToVideo = {
      create: async (args: any) => {
        h.runwayCalls.push({ kind: "imageToVideo", args });
        return { id: "task-img" };
      },
    };
    textToVideo = {
      create: async (args: any) => {
        h.runwayCalls.push({ kind: "textToVideo", args });
        return { id: "task-txt" };
      },
    };
    tasks = {
      retrieve: async () => {
        if (h.runwayMode === "fail") return { status: "FAILED", failure: "moderation said no" };
        return { status: "SUCCEEDED", output: ["https://runway.test/out.mp4"] };
      },
    };
  }
  return { default: FakeRunway };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    ugcAds: actual.ugcAdsTable,
    ugcBriefs: actual.ugcBriefsTable,
    shopProducts: actual.shopProductsTable,
    generatedClips: actual.generatedClipsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import ugcAdsRouter, {
  UGC_VIDEO_CREDIT_COST,
  UGC_PERSONA_CREDIT_COST,
  buildCaptionLines,
  buildUgcVideoPrompt,
  __setUgcCaptionBurnerForTests,
} from "../ugc-ads";
import { db, shopProductsTable, ugcBriefsTable, ugcAdsTable, generatedClipsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

let server: ReturnType<typeof express.application.listen>;
let base = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  process.env["RUNWAYML_API_SECRET"] = "test-key";
  process.env["UGC_POLL_INTERVAL_MS"] = "1";
  /* The route downloads the provider's output URL — stub just that host. */
  globalThis.fetch = (async (url: any, init: any) => {
    if (typeof url === "string" && url.includes("runway.test")) {
      return new Response(new Uint8Array([0, 0, 0, 24, 1, 2, 3]), { status: 200 });
    }
    return realFetch(url, init);
  }) as typeof fetch;
  __setUgcCaptionBurnerForTests(async () => "/tmp/ugc-captioned-fake.mp4");

  const app = express();
  app.use(express.json());
  app.use("/api", ugcAdsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  __setUgcCaptionBurnerForTests(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.fake.clear();
  h.chargeCalls = [];
  h.refundCalls = [];
  h.runwayCalls = [];
  h.mirrorCalls = [];
  h.chargeMode = "ok";
  h.aiMode = "ok";
  h.runwayMode = "ok";
  h.brandKit = null;
});

async function call(
  method: string,
  path: string,
  opts: { user?: string; credits?: number; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await realFetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
      ...(opts.credits !== undefined ? { "x-test-credits": String(opts.credits) } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const SCRIPT = {
  hook: "Okay, I finally tried it.",
  lines: ["First thing — the quality is unreal.", "I've used it every day this week."],
  cta: "Link's in my shop — go look.",
};

async function seedProduct(userId: string, name = "Gold Chain Tee", price = 4900) {
  const [row] = await db
    .insert(shopProductsTable)
    .values({
      shop_id: "00000000-0000-4000-8000-0000000000sh".slice(0, 36),
      user_id: userId,
      name,
      price_cents: price,
      image_url: "https://supabase.example/storage/products/tee.png",
    })
    .returning();
  return row;
}

async function makeDraft(user: string, extra: Record<string, unknown> = {}): Promise<any> {
  const r = await call("POST", "/api/ugc-ads", {
    user,
    body: {
      productSource: "upload",
      productName: "Miracle Hair Oil",
      productBlurb: "One drop, glass hair.",
      style: "honest-review",
      script: SCRIPT,
      ...extra,
    },
  });
  expect(r.status).toBe(201);
  return r.json.ad;
}

describe("pure builders", () => {
  it("caption lines are hook + lines + cta, capped and trimmed", () => {
    expect(buildCaptionLines(SCRIPT)).toEqual([SCRIPT.hook, ...SCRIPT.lines, SCRIPT.cta]);
  });

  it("the video prompt carries product, style direction, script, and brand feel", () => {
    const prompt = buildUgcVideoPrompt({
      productName: "Miracle Hair Oil",
      productBlurb: "One drop.",
      style: "unboxing",
      script: SCRIPT,
      hasFace: true,
      brand: { brandName: "BDV", logoUrl: null, primaryColor: "#C9A84C", vibe: "luxury" },
    });
    expect(prompt).toContain("Miracle Hair Oil");
    expect(prompt).toContain("Unboxing energy");
    expect(prompt).toContain(SCRIPT.hook);
    expect(prompt).toContain("luxury");
    expect(prompt).toContain("9:16");
  });
});

describe("products source", () => {
  it("lists only the caller's shop products", async () => {
    await seedProduct(ALICE);
    await seedProduct(BOB, "Bob's Hat");
    const r = await call("GET", "/api/ugc-ads/products", { user: ALICE });
    expect(r.status).toBe(200);
    expect(r.json.products).toHaveLength(1);
    expect(r.json.products[0].name).toBe("Gold Chain Tee");
    expect(r.json.products[0].priceCents).toBe(4900);
    expect(r.json.products[0].imageUrl).toBe("https://signed.example/products/tee.png");
  });

  it("requires auth", async () => {
    const r = await call("GET", "/api/ugc-ads/products");
    expect(r.status).toBe(401);
  });
});

describe("script (Turbo)", () => {
  it("returns a normalized script", async () => {
    const r = await call("POST", "/api/ugc-ads/script", {
      user: ALICE,
      body: { productName: "Miracle Hair Oil", style: "unboxing" },
    });
    expect(r.status).toBe(200);
    expect(r.json.script).toEqual(SCRIPT);
    expect(h.chargeCalls).toHaveLength(0);
  });

  it("an unusable model answer is an honest 502, never a fake script", async () => {
    h.aiMode = "garbage";
    const r = await call("POST", "/api/ugc-ads/script", {
      user: ALICE,
      body: { productName: "Miracle Hair Oil", style: "unboxing" },
    });
    expect(r.status).toBe(502);
  });
});

describe("persona", () => {
  it("charges 100 with an idempotency key and returns the permanent URL", async () => {
    const r = await call("POST", "/api/ugc-ads/persona", {
      user: ALICE,
      body: { description: "A 28-year-old sneaker reviewer from Atlanta, braids, gold hoops.", idempotencyKey: "persona-try-1" },
    });
    expect(r.status).toBe(200);
    expect(r.json.personaUrl).toContain("https://r2.test/ugc-personas/");
    expect(r.json.creditsUsed).toBe(UGC_PERSONA_CREDIT_COST);
    expect(UGC_PERSONA_CREDIT_COST).toBe(100);
    expect(h.chargeCalls).toHaveLength(1);
    expect(h.chargeCalls[0].cost).toBe(100);
    expect(h.chargeCalls[0].opts.idempotencyKey).toContain("ugc-persona");
    expect(h.chargeCalls[0].opts.idempotencyKey).toContain("persona-try-1");
  });

  it("refuses at 402 before any charge when the balance is short", async () => {
    const r = await call("POST", "/api/ugc-ads/persona", {
      user: ALICE,
      credits: 50,
      body: { description: "A 28-year-old sneaker reviewer from Atlanta." },
    });
    expect(r.status).toBe(402);
    expect(h.chargeCalls).toHaveLength(0);
  });

  it("refunds in full when generation fails", async () => {
    h.aiMode = "fail";
    const r = await call("POST", "/api/ugc-ads/persona", {
      user: ALICE,
      body: { description: "A 28-year-old sneaker reviewer from Atlanta." },
    });
    expect(r.status).toBe(502);
    expect(h.refundCalls).toHaveLength(1);
    expect(h.refundCalls[0].cost).toBe(100);
  });
});

describe("create ad", () => {
  it("snapshots a shop product from the row — client lies are ignored", async () => {
    const product = await seedProduct(ALICE);
    const r = await call("POST", "/api/ugc-ads", {
      user: ALICE,
      body: {
        productSource: "shop",
        shopProductId: product.id,
        productName: "LIAR NAME",
        productPriceCents: 1,
        style: "grwm",
      },
    });
    expect(r.status).toBe(201);
    expect(r.json.ad.productName).toBe("Gold Chain Tee");
    expect(r.json.ad.productPriceCents).toBe(4900);
    expect(r.json.ad.productImageUrl).toBe("https://signed.example/products/tee.png");
    expect(r.json.ad.shopProductId).toBe(product.id);
    expect(r.json.ad.status).toBe("draft");
  });

  it("another member's shop product is a 404", async () => {
    const product = await seedProduct(BOB);
    const r = await call("POST", "/api/ugc-ads", {
      user: ALICE,
      body: { productSource: "shop", shopProductId: product.id, style: "grwm" },
    });
    expect(r.status).toBe(404);
  });

  it("an upload ad requires a product name and mirrors the photo on save", async () => {
    const noName = await call("POST", "/api/ugc-ads", {
      user: ALICE,
      body: { productSource: "upload", style: "unboxing" },
    });
    expect(noName.status).toBe(400);

    const r = await call("POST", "/api/ugc-ads", {
      user: ALICE,
      body: {
        productSource: "upload",
        productName: "Miracle Hair Oil",
        productImageUrl: "https://cdn.example.com/oil.png",
        style: "unboxing",
      },
    });
    expect(r.status).toBe(201);
    expect(h.mirrorCalls).toContain("https://cdn.example.com/oil.png");
    expect(r.json.ad.productImageUrl).toContain("r2://mirrored/");
  });

  it("a brief the caller hasn't claimed is a 404; a claimed brief pre-fills", async () => {
    const [brief] = await db
      .insert(ugcBriefsTable)
      .values({
        brandUserId: BOB,
        productName: "Brief Boots",
        details: "Show them surviving a rainy festival day.",
        style: "problem-fix",
        status: "open",
      })
      .returning();
    const notClaimed = await call("POST", "/api/ugc-ads", {
      user: ALICE,
      body: { productSource: "upload", briefId: brief.id },
    });
    expect(notClaimed.status).toBe(404);

    await db
      .update(ugcBriefsTable)
      .set({ status: "claimed", claimedByUserId: ALICE })
      .where(eq(ugcBriefsTable.id, brief.id));
    const r = await call("POST", "/api/ugc-ads", {
      user: ALICE,
      body: { productSource: "upload", briefId: brief.id },
    });
    expect(r.status).toBe(201);
    expect(r.json.ad.productName).toBe("Brief Boots");
    expect(r.json.ad.style).toBe("problem-fix");
    expect(r.json.ad.briefId).toBe(brief.id);
  });
});

describe("read / edit / delete scoping", () => {
  it("lists only my ads", async () => {
    await makeDraft(ALICE);
    await makeDraft(BOB);
    const r = await call("GET", "/api/ugc-ads", { user: ALICE });
    expect(r.json.ads).toHaveLength(1);
    expect(r.json.ads[0].productName).toBe("Miracle Hair Oil");
  });

  it("a foreign ad is a 404 on read, edit, delete, and generate — and never charges", async () => {
    const ad = await makeDraft(BOB);
    expect((await call("GET", `/api/ugc-ads/${ad.id}`, { user: ALICE })).status).toBe(404);
    expect(
      (await call("PATCH", `/api/ugc-ads/${ad.id}`, { user: ALICE, body: { style: "grwm" } })).status,
    ).toBe(404);
    expect((await call("DELETE", `/api/ugc-ads/${ad.id}`, { user: ALICE })).status).toBe(404);
    expect((await call("POST", `/api/ugc-ads/${ad.id}/generate`, { user: ALICE, body: {} })).status).toBe(404);
    expect(h.chargeCalls).toHaveLength(0);
    /* Bob's ad survives untouched. */
    const still = await call("GET", `/api/ugc-ads/${ad.id}`, { user: BOB });
    expect(still.status).toBe(200);
    expect(still.json.ad.style).toBe("honest-review");
  });

  it("the brand a brief was delivered to can read the delivered ad", async () => {
    const ad = await makeDraft(ALICE);
    await db
      .update(ugcAdsTable)
      .set({ status: "ready", videoRef: "supabase://generated-clips/ugc-ads/x.mp4" })
      .where(eq(ugcAdsTable.id, ad.id));
    const [brief] = await db
      .insert(ugcBriefsTable)
      .values({
        brandUserId: BOB,
        productName: "Miracle Hair Oil",
        details: "Delivered work for review.",
        style: "honest-review",
        status: "delivered",
        claimedByUserId: ALICE,
        deliveredAdId: ad.id,
      })
      .returning();
    const r = await call("GET", `/api/ugc-ads/${ad.id}`, { user: BOB });
    expect(r.status).toBe(200);
    expect(r.json.viaBriefId).toBe(brief.id);
    expect(r.json.ad.videoUrl).toBe("https://signed.example/ugc-ads/x.mp4");
    /* A third party still gets nothing. */
    const third = await call("GET", `/api/ugc-ads/${ad.id}`, {
      user: "00000000-0000-4000-8000-00000000cc33",
    });
    expect(third.status).toBe(404);
  });

  it("draft edits land; a ready ad refuses edits at 409", async () => {
    const ad = await makeDraft(ALICE);
    const edited = await call("PATCH", `/api/ugc-ads/${ad.id}`, {
      user: ALICE,
      body: { style: "grwm" },
    });
    expect(edited.status).toBe(200);
    expect(edited.json.ad.style).toBe("grwm");
    await db
      .update(ugcAdsTable)
      .set({ status: "ready" })
      .where(eq(ugcAdsTable.id, ad.id));
    const locked = await call("PATCH", `/api/ugc-ads/${ad.id}`, {
      user: ALICE,
      body: { style: "unboxing" },
    });
    expect(locked.status).toBe(409);
  });

  it("delete removes my row", async () => {
    const ad = await makeDraft(ALICE);
    expect((await call("DELETE", `/api/ugc-ads/${ad.id}`, { user: ALICE })).status).toBe(200);
    expect((await call("GET", `/api/ugc-ads/${ad.id}`, { user: ALICE })).status).toBe(404);
  });
});

describe("generate", () => {
  it("charges 400 (the gen4.5 flat rate) and lands a ready, captioned, library-saved ad", async () => {
    expect(UGC_VIDEO_CREDIT_COST).toBe(400);
    h.brandKit = {
      brandName: "Alice Co",
      vibe: "luxury",
      industry: null,
      colors: [{ hex: "#C9A84C", name: "Gold", role: "primary" }],
      fonts: [],
      logoPrompt: "",
      taglines: [],
      selectedTagline: null,
      logoUrl: "https://r2.test/logo.png",
      bioLines: [],
      pressFacts: [],
      generatedAt: null,
      updatedAt: null,
    };
    const ad = await makeDraft(ALICE, {
      faceImageUrl: "https://r2.test/ugc-personas/alice/face.png",
      faceKind: "persona",
    });
    const r = await call("POST", `/api/ugc-ads/${ad.id}/generate`, { user: ALICE, body: {} });
    expect(r.status).toBe(200);
    expect(r.json.creditsUsed).toBe(400);
    expect(r.json.ad.status).toBe("ready");
    expect(r.json.ad.videoUrl).toMatch(/^https:\/\/signed\.example\/ugc-ads\/.+\.mp4$/);
    expect(r.json.ad.captions).toEqual([SCRIPT.hook, ...SCRIPT.lines, SCRIPT.cta]);
    expect(r.json.ad.captionsBurned).toBe(true);
    expect(r.json.ad.brand.primaryColor).toBe("#C9A84C");
    expect(r.json.ad.creditsCharged).toBe(400);
    /* The charge: one call, 400, keyed. */
    expect(h.chargeCalls).toHaveLength(1);
    expect(h.chargeCalls[0].cost).toBe(400);
    expect(h.chargeCalls[0].opts.idempotencyKey).toContain("ugc-ad-video");
    expect(h.refundCalls).toHaveLength(0);
    /* The rail: image-to-video anchored on the face, vertical. */
    expect(h.runwayCalls).toHaveLength(1);
    expect(h.runwayCalls[0].kind).toBe("imageToVideo");
    expect(h.runwayCalls[0].args.ratio).toBe("720:1280");
    expect(h.runwayCalls[0].args.promptImage).toBe("https://r2.test/ugc-personas/alice/face.png");
    /* Library save landed. */
    const clips = await db.select().from(generatedClipsTable);
    expect(clips).toHaveLength(1);
    expect(clips[0].title).toContain("Miracle Hair Oil");
  });

  it("an honest captions flag: when the burn misses, the clip still lands with captionsBurned false", async () => {
    __setUgcCaptionBurnerForTests(async () => null);
    const ad = await makeDraft(ALICE);
    const r = await call("POST", `/api/ugc-ads/${ad.id}/generate`, { user: ALICE, body: {} });
    expect(r.status).toBe(200);
    expect(r.json.ad.status).toBe("ready");
    expect(r.json.ad.captionsBurned).toBe(false);
    expect(r.json.ad.captions.length).toBeGreaterThan(0);
    __setUgcCaptionBurnerForTests(async () => "/tmp/ugc-captioned-fake.mp4");
  });

  it("replaying generate on a ready ad charges nothing", async () => {
    const ad = await makeDraft(ALICE);
    await call("POST", `/api/ugc-ads/${ad.id}/generate`, { user: ALICE, body: {} });
    expect(h.chargeCalls).toHaveLength(1);
    const replay = await call("POST", `/api/ugc-ads/${ad.id}/generate`, { user: ALICE, body: {} });
    expect(replay.status).toBe(200);
    expect(replay.json.alreadyGenerated).toBe(true);
    expect(h.chargeCalls).toHaveLength(1);
  });

  it("a short balance is a 402 and the ad stays a draft", async () => {
    h.chargeMode = "out_of_credits";
    const ad = await makeDraft(ALICE);
    const r = await call("POST", `/api/ugc-ads/${ad.id}/generate`, { user: ALICE, body: {} });
    expect(r.status).toBe(402);
    const after = await call("GET", `/api/ugc-ads/${ad.id}`, { user: ALICE });
    expect(after.json.ad.status).toBe("draft");
    expect(h.runwayCalls).toHaveLength(0);
  });

  it("a provider failure refunds in full, keeps the reason, and a retry uses a new key", async () => {
    h.runwayMode = "fail";
    const ad = await makeDraft(ALICE);
    const r = await call("POST", `/api/ugc-ads/${ad.id}/generate`, { user: ALICE, body: {} });
    expect(r.status).toBe(502);
    expect(r.json.refunded).toBe(true);
    expect(h.refundCalls).toHaveLength(1);
    expect(h.refundCalls[0].cost).toBe(400);
    const failedKey = h.chargeCalls[0].opts.idempotencyKey;
    const after = await call("GET", `/api/ugc-ads/${ad.id}`, { user: ALICE });
    expect(after.json.ad.status).toBe("failed");
    expect(after.json.ad.lastError).toContain("moderation said no");

    h.runwayMode = "ok";
    const retry = await call("POST", `/api/ugc-ads/${ad.id}/generate`, { user: ALICE, body: {} });
    expect(retry.status).toBe(200);
    expect(retry.json.ad.status).toBe("ready");
    expect(h.chargeCalls).toHaveLength(2);
    expect(h.chargeCalls[1].opts.idempotencyKey).not.toBe(failedKey);
  });

  it("an ad with no script refuses to generate and never charges", async () => {
    const r0 = await call("POST", "/api/ugc-ads", {
      user: ALICE,
      body: { productSource: "upload", productName: "Scriptless Soap", style: "grwm" },
    });
    expect(r0.status).toBe(201);
    const r = await call("POST", `/api/ugc-ads/${r0.json.ad.id}/generate`, { user: ALICE, body: {} });
    expect(r.status).toBe(400);
    expect(h.chargeCalls).toHaveLength(0);
  });

  it("a second generate while one is in flight is a 409", async () => {
    const ad = await makeDraft(ALICE);
    await db
      .update(ugcAdsTable)
      .set({ status: "generating" })
      .where(eq(ugcAdsTable.id, ad.id));
    const r = await call("POST", `/api/ugc-ads/${ad.id}/generate`, { user: ALICE, body: {} });
    expect(r.status).toBe(409);
    expect(h.chargeCalls).toHaveLength(0);
  });
});
