/**
 * Content warnings (Wave 4 #40) — the co-post DTO.
 *
 * coPostDto ships media_urls outside enrichPosts, so the cover has to
 * live there too: a labelled co-post must reach the public profile
 * list covered, while BOTH creator sides — who must see exactly what
 * they are co-signing — read it in full.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const AUTHOR = "00000000-0000-4000-8000-0000000000a1";
const AUTHOR_PROFILE = "11111111-1111-4111-8111-1111111111a1";
const PARTNER = "00000000-0000-4000-8000-0000000000b2";
const PARTNER_PROFILE = "11111111-1111-4111-8111-1111111111b2";
const CO_POST = "22222222-2222-4222-8222-222222222401";

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(u);
    next();
  },
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    creatorProfiles: actual.creatorProfilesTable,
    posts: actual.postsTable,
    postCoAuthors: actual.postCoAuthorsTable,
    collabRequests: actual.collabRequestsTable,
    notifications: actual.notificationsTable,
    contentWarningPreferences: actual.contentWarningPreferencesTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import router from "../co-posts";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function call(method: string, path: string, opts: { user?: string } = {}) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json: json as any };
}

const NOW = new Date("2026-10-24T12:00:00Z");

beforeEach(() => {
  h.fake.clear();
  h.fake.seed("creatorProfiles", [
    { id: AUTHOR_PROFILE, userId: AUTHOR, slug: "author", displayName: "Author", avatarUrl: null, isVerified: false },
    { id: PARTNER_PROFILE, userId: PARTNER, slug: "partner", displayName: "Partner", avatarUrl: null, isVerified: false },
  ]);
  h.fake.seed("posts", [{
    id: CO_POST,
    profileId: AUTHOR_PROFILE,
    body: "our collab cover art",
    mediaUrls: [{ kind: "image", url: "https://cdn.example.com/collab.jpg" }],
    kind: "post",
    replyTo: null,
    quoteOf: null,
    repostOf: null,
    groupId: null,
    scheduledFor: null,
    audience: "public",
    minTierId: null,
    contentWarnings: ["mature_themes"],
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    createdAt: NOW,
    removedAt: null,
    removedByEmail: null,
    removalReason: null,
    removalNote: null,
  }]);
  h.fake.seed("postCoAuthors", [
    { id: "33333333-3333-4333-8333-333333333301", post_id: CO_POST, profile_id: AUTHOR_PROFILE, user_id: AUTHOR, role: "author", status: "accepted", accepted_at: NOW, responded_at: NOW, withdrawn_at: null, collab_request_id: null, created_at: NOW, updated_at: NOW },
    { id: "33333333-3333-4333-8333-333333333302", post_id: CO_POST, profile_id: PARTNER_PROFILE, user_id: PARTNER, role: "co_author", status: "accepted", accepted_at: NOW, responded_at: NOW, withdrawn_at: null, collab_request_id: null, created_at: NOW, updated_at: NOW },
  ]);
});

describe("co-post DTO cover", () => {
  it("the public by-profile list serves a labelled co-post covered — no media URL", async () => {
    const res = await call("GET", `/co-posts/by-profile/${AUTHOR_PROFILE}`);
    expect(res.status).toBe(200);
    const p = (res.json.posts ?? []).find((x: any) => x.id === CO_POST);
    expect(p).toBeTruthy();
    expect(p.content_warnings).toEqual(["mature_themes"]);
    expect(p.media_urls).toEqual([]);
    expect(p.content_cover).toBeTruthy();
    expect(p.content_cover.mode).toBe("covered");
    expect(JSON.stringify(res.json)).not.toContain("collab.jpg");
  });

  it("both creator sides read their own co-post in full (they are its authors)", async () => {
    for (const u of [AUTHOR, PARTNER]) {
      const res = await call("GET", "/co-posts/mine", { user: u });
      expect(res.status).toBe(200);
      const p = (res.json.posts ?? []).find((x: any) => x.id === CO_POST);
      expect(p, `side ${u} should see the co-post`).toBeTruthy();
      expect(p.content_cover).toBeNull();
      expect(p.media_urls?.[0]?.url).toBe("https://cdn.example.com/collab.jpg");
    }
  });
});
