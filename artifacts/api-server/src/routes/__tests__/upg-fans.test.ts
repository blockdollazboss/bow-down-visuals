/**
 * upg-fans route tests (JOIN2 owed verification — the upg-fans lane
 * shipped routes/upg-fans.ts with lib tests only; these pin the HTTP
 * surface end to end against the house fake db):
 *  - Collab Match: no profile → honest empty; a due generation pairs
 *    two public profiles; marks are owner-only, and mutual interest
 *    brokers exactly one intro collab_requests row.
 *  - Fan Links: mint validation (bad type 400, own content 400,
 *    unknown creator 404), mint dedupe (second mint returns the same
 *    link), /mine stats, the public /f/:code redirect records a click
 *    before landing, unknown/malformed codes land on "/".
 *  - Signup attribution: self-attribution refused; a fan's link
 *    records the signup.
 *  - Audience Room: no creator profile → 404; profile with no media
 *    → an honest zeroed 28-day summary.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => {
  process.env["DATABASE_URL"] = "postgres://test:test@localhost:5432/test";
  process.env["SUPABASE_URL"] = "http://localhost";
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test";
  return { fake: null as any };
});

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

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb(
    {
      collabProfiles: actual.collabProfilesTable,
      collabSuggestions: actual.collabSuggestionsTable,
      collabRequests: actual.collabRequestsTable,
      creatorProfiles: actual.creatorProfilesTable,
      fanLinks: actual.fanLinksTable,
      fanLinkEvents: actual.fanLinkEventsTable,
      playEvents: actual.playEventsTable,
      profileTracks: actual.profileTracksTable,
      profileVideos: actual.profileVideosTable,
    },
    {
      collabSuggestions: [["user_a_id", "user_b_id"]],
      fanLinks: [["code"], ["fan_user_id", "content_type", "content_id"]],
    },
  );
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import upgFansRouter from "../upg-fans";

let server: any;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use("/api", upgFansRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  h.fake.clear();
});

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CREATOR = "33333333-3333-4333-8333-333333333333";
const FAN = "44444444-4444-4444-8444-444444444444";
const CREATOR_PROFILE_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-10-26T12:00:00Z");

function collabProfile(userId: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id: `cp-${userId.slice(0, 4)}`,
    user_id: userId,
    display_name: name,
    niche: "afrobeats",
    platforms: [{ platform: "tiktok", followers: 12000 }],
    collab_interests: "hooks and duets",
    bio: "",
    is_public: true,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

function creatorProfile(userId: string, over: Record<string, unknown> = {}) {
  return {
    id: CREATOR_PROFILE_ID,
    userId,
    displayName: "Creator Cee",
    slug: "creator-cee",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

async function call(method: string, path: string, user: string | null, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* redirects carry no JSON */
  }
  return { status: res.status, json, location: res.headers.get("location") };
}

describe("collab match", () => {
  it("no collab profile → honest empty, not an error", async () => {
    const r = await call("GET", "/collab-match", ME);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ hasProfile: false, suggestions: [] });
  });

  it("a due generation pairs two public profiles in the same niche", async () => {
    h.fake.seed("collabProfiles", [collabProfile(ME, "Me"), collabProfile(OTHER, "Other")]);
    const r = await call("GET", "/collab-match", ME);
    expect(r.status).toBe(200);
    expect(r.json.hasProfile).toBe(true);
    expect(r.json.suggestions).toHaveLength(1);
    expect(r.json.suggestions[0].status).toBe("open");
    expect(r.json.suggestions[0].other.userId).toBe(OTHER);
    expect(r.json.suggestions[0].myStatus).toBe("pending");
    /* the pair is stored canonically, exactly once */
    const stored = h.fake.store("collabSuggestions").rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].user_a_id < stored[0].user_b_id).toBe(true);
  });

  it("marks: invalid body 400, stranger 404, mutual interest brokers one intro", async () => {
    h.fake.seed("collabProfiles", [collabProfile(ME, "Me"), collabProfile(OTHER, "Other")]);
    const list = await call("GET", "/collab-match", ME);
    const sid = list.json.suggestions[0].id;

    const bad = await call("POST", `/collab-match/${sid}/mark`, ME, { mark: "maybe" });
    expect(bad.status).toBe(400);

    const stranger = await call("POST", `/collab-match/${sid}/mark`, FAN, { mark: "interested" });
    expect(stranger.status).toBe(404);

    const mine = await call("POST", `/collab-match/${sid}/mark`, ME, { mark: "interested" });
    expect(mine.status).toBe(200);
    expect(mine.json.status).toBe("open");
    expect(h.fake.store("collabRequests").rows).toHaveLength(0);

    const theirs = await call("POST", `/collab-match/${sid}/mark`, OTHER, { mark: "interested" });
    expect(theirs.status).toBe(200);
    expect(theirs.json.status).toBe("connected");
    expect(theirs.json.introRequestId).toBeTruthy();
    const intros = h.fake.store("collabRequests").rows;
    expect(intros).toHaveLength(1);
    expect(intros[0].status).toBe("pending");
    expect(String(intros[0].message)).toContain("Me");
    expect(String(intros[0].message)).toContain("Other");
  });
});

describe("fan links", () => {
  beforeEach(() => {
    h.fake.seed("creatorProfiles", [creatorProfile(CREATOR)]);
  });

  it("mint validation: bad type 400, own content 400, unknown creator 404", async () => {
    const badType = await call("POST", "/fan-links", FAN, { creatorUserId: CREATOR, contentType: "essay" });
    expect(badType.status).toBe(400);
    const own = await call("POST", "/fan-links", CREATOR, { creatorUserId: CREATOR, contentType: "video" });
    expect(own.status).toBe(400);
    expect(String(own.json.error)).toContain("your own content");
    const ghost = await call("POST", "/fan-links", FAN, { creatorUserId: OTHER, contentType: "video" });
    expect(ghost.status).toBe(404);
  });

  it("mint → dedupe returns the same link; /mine carries zeroed proven stats", async () => {
    const first = await call("POST", "/fan-links", FAN, { creatorUserId: CREATOR, contentType: "video", contentId: "vid-1" });
    expect(first.status).toBe(200);
    expect(first.json.path).toBe(`/api/f/${first.json.link.code}`);
    const second = await call("POST", "/fan-links", FAN, { creatorUserId: CREATOR, contentType: "video", contentId: "vid-1" });
    expect(second.status).toBe(200);
    expect(second.json.link.code).toBe(first.json.link.code);
    expect(h.fake.store("fanLinks").rows).toHaveLength(1);

    const mine = await call("GET", "/fan-links/mine", FAN);
    expect(mine.status).toBe(200);
    expect(mine.json.links).toHaveLength(1);
    expect(mine.json.links[0].stats.clicks).toBe(0);
  });

  it("public redirect: known code lands on the creator page and records the click first", async () => {
    const minted = await call("POST", "/fan-links", FAN, { creatorUserId: CREATOR, contentType: "video", contentId: "vid-9" });
    const code = minted.json.link.code as string;
    const hit = await call("GET", `/f/${code}`, null);
    expect(hit.status).toBe(302);
    expect(hit.location).toContain("creator-cee");
    expect(hit.location).toContain(`fan=${code}`);
    expect(hit.location).toContain("#video-vid-9");
    const events = h.fake.store("fanLinkEvents").rows;
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("click");
  });

  it("public redirect: unknown or malformed codes land on / and record nothing", async () => {
    const unknown = await call("GET", "/f/ZZZZZZZZ", null);
    expect(unknown.status).toBe(302);
    expect(unknown.location).toBe("/");
    const malformed = await call("GET", "/f/nope", null);
    expect(malformed.status).toBe(302);
    expect(malformed.location).toBe("/");
    expect(h.fake.store("fanLinkEvents").rows).toHaveLength(0);
  });

  it("signup attribution: a fan's link records it; self-attribution is refused", async () => {
    const minted = await call("POST", "/fan-links", FAN, { creatorUserId: CREATOR, contentType: "song" });
    const code = minted.json.link.code as string;
    const ok = await call("POST", "/fan-links/attribute-signup", OTHER, { code });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ ok: true, alreadyAttributed: false });
    const signups = h.fake.store("fanLinkEvents").rows.filter((r: any) => r.kind === "signup");
    expect(signups).toHaveLength(1);
    const self = await call("POST", "/fan-links/attribute-signup", FAN, { code });
    expect(self.status).toBe(400);
    const badCode = await call("POST", "/fan-links/attribute-signup", OTHER, { code: "no" });
    expect(badCode.status).toBe(400);
  });
});

describe("audience room", () => {
  it("no creator profile → 404 with the honest setup message", async () => {
    const r = await call("GET", "/audience-room", ME);
    expect(r.status).toBe(404);
    expect(String(r.json.error)).toContain("creator profile");
  });

  it("profile with no media → zeroed 28-day summary", async () => {
    h.fake.seed("creatorProfiles", [creatorProfile(ME)]);
    const r = await call("GET", "/audience-room", ME);
    expect(r.status).toBe(200);
    expect(r.json.windowDays).toBe(28);
    expect(r.json.totalPlays).toBe(0);
  });
});
