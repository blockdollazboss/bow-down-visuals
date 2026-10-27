/**
 * Plain-Words Deals (Stack-200 upgrade #164) — the deals router end to
 * end over the house fake db (real table objects, real router).
 *
 * Why not pg-mem: mapped drizzle selects (db.select().from(...)) are
 * incompatible with the pg-mem adapter (rowMode) — the same reason the
 * co-releases router has no pg-mem suite. The fake db evaluates the
 * real query-builder conditions, so the routes run unmodified.
 *
 * Pins:
 *  - draft: author signs at draft, partner pending, nothing agreed;
 *    the partner is notified; a bad split (sum ≠ 100) refuses 400 and
 *    writes nothing;
 *  - the item must be the author's own (someone else's release → 404);
 *  - sign completes the pair: split + text freeze; a RELEASE deal
 *    attaches a published co-release with the agreed shares frozen;
 *  - a STORE_PRODUCT deal attaches by writing the product's
 *    sale-splits list (validated by the sale-splits machine);
 *  - a non-party can neither read (403) nor sign (403) a deal;
 *  - decline ends a deal before signature; signing after decline → 409;
 *  - amend un-signs the partner — the partner then signs the NEW words
 *    and the NEW split is what freezes;
 *  - /mine lists deals for both sides and hides them from strangers.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  fake: null as any,
  userId: "",
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: (...a: any[]) => console.error("[route-log]", ...a),
    debug: vi.fn(),
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb(
    {
      creatorProfiles: actual.creatorProfilesTable,
      distributionReleases: actual.distributionReleasesTable,
      storeProducts: actual.storeProductsTable,
      shopProducts: actual.shopProductsTable,
      notifications: actual.notificationsTable,
      plainDeals: actual.plainDealsTable,
      plainDealSides: actual.plainDealSidesTable,
      coReleases: actual.coReleasesTable,
      coReleaseSides: actual.coReleaseSidesTable,
    },
    { plainDealSides: [["plain_deal_id", "profile_id"]] },
  );
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import plainDealsRouter from "../plain-deals";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const AUTHOR = randomUUID();
const PARTNER = randomUUID();
const STRANGER = randomUUID();
const AUTHOR_PROFILE = randomUUID();
const PARTNER_PROFILE = randomUUID();
const RELEASE_ID = randomUUID();
const PRODUCT_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", plainDealsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[plain-deals-test] unhandled route error:", err?.message ?? err);
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.fake.clear();
  h.userId = AUTHOR;
  h.fake.seed("creatorProfiles", [
    { id: AUTHOR_PROFILE, userId: AUTHOR, displayName: "Author One", slug: "author-one", avatarUrl: null, isVerified: false },
    { id: PARTNER_PROFILE, userId: PARTNER, displayName: "Partner Two", slug: "partner-two", avatarUrl: null, isVerified: false },
  ]);
  h.fake.seed("distributionReleases", [{ id: RELEASE_ID, user_id: AUTHOR, title: "Midnight Run" }]);
  h.fake.seed("storeProducts", [{ id: PRODUCT_ID, profileId: AUTHOR_PROFILE, title: "Collab Beat Pack", splits: null }]);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

function dealBody(over: Record<string, unknown> = {}) {
  return {
    title: "Our song 'Midnight Run'",
    item_kind: "general",
    partner_profile_id: PARTNER_PROFILE,
    author: { does_text: "writes and records the song", gets_text: "credit as lead artist", share_pct: 60 },
    partner: { does_text: "produces the beat", gets_text: "producer credit", share_pct: 40 },
    signed_name: "Author One",
    ...over,
  };
}

const rows = (name: string) => h.fake.store(name).rows as any[];

describe("plain-words deals router", () => {
  it("drafts a deal: author signed at draft, partner pending, partner notified", async () => {
    const r = await req("POST", "/plain-deals", dealBody());
    expect(r.status).toBe(201);
    const deal = r.json.plain_deal;
    expect(deal.deal_state).toBe("awaiting_signature");
    expect(deal.agreed_shares).toBeNull();
    const authorSide = deal.sides.find((s: any) => s.role === "author");
    const partnerSide = deal.sides.find((s: any) => s.role === "partner");
    expect(authorSide.status).toBe("signed");
    expect(authorSide.signed_name).toBe("Author One");
    expect(partnerSide.status).toBe("pending");
    expect(deal.plain_text).toContain("Author One does: writes and records the song");
    expect(deal.plain_text).toContain("Partner Two 40%");
    const notes = rows("notifications").filter((n) => n.userId === PARTNER);
    expect(notes.length).toBe(1);
    expect(notes[0].kind).toBe("plain_deal_invite");
  });

  it("refuses a split that doesn't sum to 100 — and writes nothing", async () => {
    const r = await req("POST", "/plain-deals", dealBody({
      partner: { does_text: "produces the beat", gets_text: "producer credit", share_pct: 30 },
    }));
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toContain("split");
    expect(rows("plainDeals").length).toBe(0);
    expect(rows("plainDealSides").length).toBe(0);
  });

  it("refuses a deal naming a release the author doesn't own", async () => {
    const foreign = randomUUID();
    h.fake.seed("distributionReleases", [{ id: foreign, user_id: PARTNER, title: "Not Yours" }]);
    const r = await req("POST", "/plain-deals", dealBody({ item_kind: "release", item_id: foreign }));
    expect(r.status).toBe(404);
    expect(r.json.error).toBe("item_not_found");
  });

  it("signing completes the pair: terms freeze and a co-release attaches for a release deal", async () => {
    const created = await req("POST", "/plain-deals", dealBody({ item_kind: "release", item_id: RELEASE_ID }));
    expect(created.status).toBe(201);
    const dealId = created.json.plain_deal.id;

    h.userId = PARTNER;
    const signed = await req("POST", `/plain-deals/${dealId}/sign`, { signed_name: "Partner Two" });
    expect(signed.status).toBe(200);
    const deal = signed.json.plain_deal;
    expect(deal.deal_state).toBe("signed");
    expect(deal.agreed_shares).toEqual([
      { profileId: AUTHOR_PROFILE, userId: AUTHOR, sharePct: 60 },
      { profileId: PARTNER_PROFILE, userId: PARTNER, sharePct: 40 },
    ]);
    expect(deal.signed_text).toContain("A plain-words deal between Author One and Partner Two.");
    expect(deal.split_attach.rail).toBe("co_release");

    const coHeads = rows("coReleases").filter((x) => x.item_id === RELEASE_ID);
    expect(coHeads.length).toBe(1);
    expect(coHeads[0].published_at).not.toBeNull();
    const coSides = rows("coReleaseSides").filter((x) => x.co_release_id === deal.split_attach.refId);
    expect(coSides.length).toBe(2);
    for (const s of coSides) {
      expect(s.status).toBe("accepted");
      expect(Number(s.agreed_share_pct)).toBe(Number(s.share_pct));
    }
  });

  it("signing a store-product deal writes the product's sale-splits list", async () => {
    const created = await req("POST", "/plain-deals", dealBody({ item_kind: "store_product", item_id: PRODUCT_ID }));
    expect(created.status).toBe(201);
    const dealId = created.json.plain_deal.id;
    h.userId = PARTNER;
    const signed = await req("POST", `/plain-deals/${dealId}/sign`, { signed_name: "Partner Two" });
    expect(signed.status).toBe(200);
    expect(signed.json.plain_deal.split_attach.rail).toBe("sale_splits");
    const prod = rows("storeProducts").find((p) => p.id === PRODUCT_ID);
    expect(prod.splits).toEqual([
      { userId: AUTHOR, sharePct: 60 },
      { userId: PARTNER, sharePct: 40 },
    ]);
  });

  it("a non-party can neither read nor sign a deal", async () => {
    const created = await req("POST", "/plain-deals", dealBody());
    const dealId = created.json.plain_deal.id;
    h.userId = STRANGER;
    const read = await req("GET", `/plain-deals/${dealId}`);
    expect(read.status).toBe(403);
    const sign = await req("POST", `/plain-deals/${dealId}/sign`, { signed_name: "Nope" });
    expect(sign.status).toBe(403);
  });

  it("decline ends the deal; signing afterwards is refused", async () => {
    const created = await req("POST", "/plain-deals", dealBody());
    const dealId = created.json.plain_deal.id;
    h.userId = PARTNER;
    const declined = await req("POST", `/plain-deals/${dealId}/decline`);
    expect(declined.status).toBe(200);
    expect(declined.json.plain_deal.deal_state).toBe("declined");
    const sign = await req("POST", `/plain-deals/${dealId}/sign`, { signed_name: "Partner Two" });
    expect(sign.status).toBe(409);
  });

  it("amend un-signs the partner; the new words and new split are what freeze", async () => {
    const created = await req("POST", "/plain-deals", dealBody());
    const dealId = created.json.plain_deal.id;
    const amended = await req("POST", `/plain-deals/${dealId}/amend`, {
      title: "Our song 'Midnight Run' (remix)",
      author: { does_text: "writes, records and mixes", gets_text: "lead credit", share_pct: 50, signed_name: "Author One" },
      partner: { does_text: "produces and masters", gets_text: "producer credit", share_pct: 50 },
    });
    expect(amended.status).toBe(200);
    const partnerSide = amended.json.plain_deal.sides.find((s: any) => s.role === "partner");
    expect(partnerSide.status).toBe("pending");
    expect(partnerSide.share_pct).toBe(50);

    h.userId = PARTNER;
    const signed = await req("POST", `/plain-deals/${dealId}/sign`, { signed_name: "Partner Two" });
    expect(signed.status).toBe(200);
    expect(signed.json.plain_deal.deal_state).toBe("signed");
    expect(signed.json.plain_deal.signed_text).toContain("Author One 50% / Partner Two 50%");
    expect(signed.json.plain_deal.signed_text).toContain("writes, records and mixes");
  });

  it("mine lists deals for both sides and hides them from strangers", async () => {
    await req("POST", "/plain-deals", dealBody());
    const mineAuthor = await req("GET", "/plain-deals/mine");
    expect(mineAuthor.json.plain_deals.length).toBe(1);
    h.userId = PARTNER;
    const minePartner = await req("GET", "/plain-deals/mine");
    expect(minePartner.json.plain_deals.length).toBe(1);
    h.userId = STRANGER;
    const mineStranger = await req("GET", "/plain-deals/mine");
    expect(mineStranger.json.plain_deals.length).toBe(0);
  });
});
