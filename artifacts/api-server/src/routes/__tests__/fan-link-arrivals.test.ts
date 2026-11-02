/**
 * Fan Link arrivals — the missing wire (N17, stack1300).
 *
 * THE DISEASE: fan links recorded clicks (the public redirect) and
 * signups (post-signup attribution), but ARRIVALS were never recorded —
 * lib/fan-link-events.ts carried the arrival writer's doc comment above
 * a helper nothing called, and neither play door ever inserted a
 * kind:"arrival" row. The creator view's arrival counts and arrivalRate
 * therefore read 0 forever: a shipped number presented as fact that was
 * structurally incapable of being anything else.
 *
 * THE MODEL (lib/fan-links.ts, the pure core, unchanged): an arrival is
 * a play of the linked content made while carrying the code — proven
 * when the play IS the linked content (kind maps song→track /
 * video→video, id matches) and the player is not the fan. Creator-level
 * links (no content id) require the played media to belong to the
 * link's creator, proven by ownership. An arrival rides a COUNTED play
 * (the play doors' own doctrine: an uncounted play writes nothing) —
 * one arrival row per counted play carrying a qualifying code, counted
 * as its own fact, distinct from the click the same landing recorded.
 *
 * THE PINS: mint → land (click) → play carrying the code → exactly one
 * arrival and the creator view reports it; both play doors wired; the
 * fan's own plays, the creator's self-plays, uncounted replays, wrong
 * media, wrong kind, other creators' media under a creator-level link,
 * and unknown/malformed codes all record NOTHING.
 *
 * Real routers over pg-mem (the counter-consistency-media /
 * discovery-play-counting harness shape): real SQL, real counting.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { DataType } from "pg-mem";

const h = vi.hoisted(() => {
  process.env["DATABASE_URL"] = "postgres://test:test@localhost:5432/test";
  process.env["SUPABASE_URL"] = "http://localhost";
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test";
  return { db: null as any, mem: null as any };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) return res.status(401).json({ error: "Unauthorized" });
    req.userId = String(u);
    next();
  },
}));
vi.mock("../../lib/optional-auth", () => ({
  resolveOptionalSession: async (req: any) => {
    const u = req.headers["x-test-user"];
    if (u) req.userId = String(u);
  },
}));
vi.mock("../../lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const pass = (_req: any, _res: any, next: any) => next();
  return { ...actual, publicApiLimiter: pass, freeAiLimiter: pass };
});
vi.mock("../referrals", () => ({
  getRecruiterBadgeForUser: async () => null,
}));
vi.mock("../generate/milestones", () => ({
  computeAchievements: () => [],
}));
vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (x: string) => x,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
}));
vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));
vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
  addCreditsToProfile: async () => {},
  addCreditsAtomic: async () => ({ oldCredits: 0, newCredits: 0, created: false }),
  deductCreditsAtomic: async () => ({ ok: true }),
}));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

import { createTestDb } from "../../lib/__tests__/test-db";
import { __resetPlayCounterForTests } from "../../lib/play-counting";
import upgFansRouter from "../upg-fans";
import discoveryRouter from "../discovery";
import creatorPlatformRouter from "../creator-platform";

const CREATOR = "33333333-3333-4333-8333-333333333333";
const FAN = "44444444-4444-4444-8444-444444444444";
const LISTENER = "77777777-7777-4777-8777-777777777777";
const LISTENER2 = "88888888-8888-4888-8888-888888888888";
const OTHER_CREATOR = "99999999-9999-4999-8999-999999999999";
const PROFILE_ID = "55555555-5555-4555-8555-555555555555";
const PROFILE2_ID = "66666666-6666-4666-8666-666666666666";
const TRACK = "22222222-2222-4222-8222-222222222222";
const TRACK2 = "23232323-2323-4232-8232-232323232323";
const OTHER_TRACK = "24242424-2424-4242-8242-242424242424";
const VIDEO = "25252525-2525-4252-8252-252525252525";

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  bio text NOT NULL DEFAULT '', declared_city text, avatar_url text, banner_url text,
  theme_id text NOT NULL DEFAULT 'gold-lux', vertical text NOT NULL DEFAULT 'music',
  stream_schedule jsonb NOT NULL DEFAULT '[]', media_kit jsonb,
  theme_config jsonb NOT NULL DEFAULT '{}', sections jsonb NOT NULL DEFAULT '[]',
  layout_blocks jsonb NOT NULL DEFAULT '[]', pinned_kind text, pinned_item_id uuid,
  collection_visibility text NOT NULL DEFAULT 'public', featured_media jsonb,
  merch_items jsonb NOT NULL DEFAULT '[]', events jsonb NOT NULL DEFAULT '[]',
  series jsonb NOT NULL DEFAULT '[]', social_posts jsonb NOT NULL DEFAULT '[]',
  social_links jsonb NOT NULL DEFAULT '{}', top_creators jsonb NOT NULL DEFAULT '[]',
  tip_jar_enabled boolean NOT NULL DEFAULT true,
  meta_pixel_id text, tiktok_pixel_id text, google_tag_id text, ai_design jsonb,
  is_public boolean NOT NULL DEFAULT true, is_verified boolean NOT NULL DEFAULT false,
  is_official boolean NOT NULL DEFAULT false,
  follower_count integer NOT NULL DEFAULT 0, total_plays integer NOT NULL DEFAULT 0,
  stripe_connect_account_id text,
  stripe_connect_onboarded boolean NOT NULL DEFAULT false,
  stripe_connect_charges_enabled boolean NOT NULL DEFAULT false,
  stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE profile_tracks (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL, audio_url text NOT NULL,
  artwork_url text, genre text, tags text[], isrc text,
  duration_sec integer NOT NULL DEFAULT 0, download_price_cents integer NOT NULL DEFAULT 0,
  pwyw_enabled boolean NOT NULL DEFAULT false, pwyw_min_cents integer NOT NULL DEFAULT 0,
  play_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0,
  repost_count integer NOT NULL DEFAULT 0, comment_count integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL, video_url text NOT NULL,
  thumbnail_url text, thumbnail_alt_text text, description text NOT NULL DEFAULT '',
  genre text, tags text[], duration_sec integer NOT NULL DEFAULT 0,
  season integer, episode integer, sound_track_id uuid,
  download_price_cents integer NOT NULL DEFAULT 0,
  pwyw_enabled boolean NOT NULL DEFAULT false, pwyw_min_cents integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0,
  repost_count integer NOT NULL DEFAULT 0, comment_count integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false, is_short boolean NOT NULL DEFAULT false,
  duet_with uuid, stitch_with uuid, duets_enabled boolean NOT NULL DEFAULT true,
  king_featured_at timestamptz, sound_id text, sound_title text, sound_url text,
  sound_use_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE play_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, media_id uuid NOT NULL,
  user_id uuid, source text, played_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE fan_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  fan_user_id uuid NOT NULL,
  creator_user_id uuid NOT NULL,
  content_type text NOT NULL,
  content_id text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX fan_links_fan_content_uidx ON fan_links (fan_user_id, content_type, content_id);
CREATE INDEX fan_links_creator_idx ON fan_links (creator_user_id);
CREATE INDEX fan_links_code_idx ON fan_links (code);
CREATE TABLE fan_link_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fan_link_id uuid NOT NULL REFERENCES fan_links (id) ON DELETE CASCADE,
  kind text NOT NULL,
  visitor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX fan_link_events_link_idx ON fan_link_events (fan_link_id, kind);
CREATE INDEX fan_link_events_visitor_idx ON fan_link_events (visitor_user_id);
CREATE UNIQUE INDEX fan_link_events_signup_once_uidx
  ON fan_link_events (visitor_user_id) WHERE kind = 'signup' AND visitor_user_id IS NOT NULL;
`;

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
  app.use("/api/discovery", discoveryRouter);
  app.use("/api", creatorPlatformRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  const t = createTestDb();
  h.db = t.db;
  h.mem = t.mem;
  h.mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  h.mem.public.none(DDL);
  h.mem.public.none(`
    INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES
      ('${PROFILE_ID}', '${CREATOR}', 'cee', 'Cee'),
      ('${PROFILE2_ID}', '${OTHER_CREATOR}', 'oh', 'Oh');
    INSERT INTO profile_tracks (id, profile_id, title, audio_url, is_published) VALUES
      ('${TRACK}', '${PROFILE_ID}', 'Linked Song', 'https://x/a.mp3', true),
      ('${TRACK2}', '${PROFILE_ID}', 'Other Song', 'https://x/b.mp3', true),
      ('${OTHER_TRACK}', '${PROFILE2_ID}', 'Not Yours', 'https://x/c.mp3', true);
    INSERT INTO profile_videos (id, profile_id, title, video_url, is_published) VALUES
      ('${VIDEO}', '${PROFILE_ID}', 'Linked Video', 'https://x/v.mp4', true);
  `);
  __resetPlayCounterForTests();
});

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

async function mint(contentType: string, contentId?: string): Promise<string> {
  const r = await call("POST", "/fan-links", FAN, {
    creatorUserId: CREATOR,
    contentType,
    ...(contentId ? { contentId } : {}),
  });
  expect(r.status).toBe(200);
  return r.json.link.code as string;
}

function events(kind?: string): any[] {
  const rows = h.mem.public.many(`SELECT * FROM fan_link_events`);
  return kind ? rows.filter((r: any) => r.kind === kind) : rows;
}

describe("fan link arrivals — the wire (N17)", () => {
  it("discovery door: land through the link, play carrying the code → one arrival, creator view proves it", async () => {
    const code = await mint("song", TRACK);

    const land = await call("GET", `/f/${code}`, null);
    expect(land.status).toBe(302);
    expect(events("click")).toHaveLength(1);
    expect(events("arrival")).toHaveLength(0);

    const play = await call("POST", "/discovery/play", LISTENER, {
      kind: "track",
      mediaId: TRACK,
      fanCode: code,
    });
    expect(play.status).toBe(200);
    expect(play.json.counted).toBe(true);

    const arrivals = events("arrival");
    expect(arrivals).toHaveLength(1);
    expect(String(arrivals[0].visitor_user_id)).toBe(LISTENER);
    /* click and arrival are distinct facts — two rows, two kinds */
    expect(events()).toHaveLength(2);

    const view = await call("GET", "/fan-links/for-me", CREATOR);
    expect(view.status).toBe(200);
    expect(view.json.rollup.totalClicks).toBe(1);
    expect(view.json.rollup.totalArrivals).toBe(1);
    expect(view.json.links[0].stats.arrivalRate).toBe(1);
  });

  it("media door: the landing URL's own ?fan= on the play call records the arrival", async () => {
    const code = await mint("video", VIDEO);
    const play = await call("POST", `/media/video/${VIDEO}/play?fan=${code}`, LISTENER);
    expect(play.status).toBe(200);
    expect(play.json.counted).toBe(true);
    const arrivals = events("arrival");
    expect(arrivals).toHaveLength(1);
    expect(String(arrivals[0].visitor_user_id)).toBe(LISTENER);
  });

  it("media door also honours a fanCode body — both doors accept the code either way it is handed back", async () => {
    const code = await mint("song", TRACK);
    const play = await call("POST", `/media/track/${TRACK}/play`, LISTENER, { fanCode: code });
    expect(play.status).toBe(200);
    expect(play.json.counted).toBe(true);
    expect(events("arrival")).toHaveLength(1);
  });

  it("a counted play with no code records no arrival", async () => {
    await mint("song", TRACK);
    const play = await call("POST", "/discovery/play", LISTENER, { kind: "track", mediaId: TRACK });
    expect(play.json.counted).toBe(true);
    expect(events("arrival")).toHaveLength(0);
  });

  it("the fan's own play through their own link never arrives (no self-farming)", async () => {
    const code = await mint("song", TRACK);
    const play = await call("POST", "/discovery/play", FAN, {
      kind: "track",
      mediaId: TRACK,
      fanCode: code,
    });
    expect(play.json.counted).toBe(true); // the play counts — the fan is not the owner
    expect(events("arrival")).toHaveLength(0);
  });

  it("the creator's self-play never counts, so it never arrives", async () => {
    const code = await mint("song", TRACK);
    const play = await call("POST", "/discovery/play", CREATOR, {
      kind: "track",
      mediaId: TRACK,
      fanCode: code,
    });
    expect(play.json.counted).toBe(false);
    expect(events("arrival")).toHaveLength(0);
  });

  it("an uncounted replay inside the pacing gap does not double the arrival", async () => {
    const code = await mint("song", TRACK);
    const first = await call("POST", "/discovery/play", LISTENER, {
      kind: "track",
      mediaId: TRACK,
      fanCode: code,
    });
    const replay = await call("POST", "/discovery/play", LISTENER, {
      kind: "track",
      mediaId: TRACK,
      fanCode: code,
    });
    expect(first.json.counted).toBe(true);
    expect(replay.json.counted).toBe(false);
    expect(events("arrival")).toHaveLength(1);
  });

  it("a code naming other content does not arrive on the wrong media or the wrong kind", async () => {
    const code = await mint("song", TRACK);
    const wrongMedia = await call("POST", "/discovery/play", LISTENER, {
      kind: "track",
      mediaId: TRACK2,
      fanCode: code,
    });
    expect(wrongMedia.json.counted).toBe(true);
    const wrongKind = await call("POST", "/discovery/play", LISTENER, {
      kind: "video",
      mediaId: VIDEO,
      fanCode: code,
    });
    expect(wrongKind.json.counted).toBe(true);
    expect(events("arrival")).toHaveLength(0);
  });

  it("creator-level link: arrivals only for the link creator's own content, kind still gates", async () => {
    const code = await mint("song");
    const own = await call("POST", "/discovery/play", LISTENER, {
      kind: "track",
      mediaId: TRACK2,
      fanCode: code,
    });
    expect(own.json.counted).toBe(true);
    expect(events("arrival")).toHaveLength(1);

    const foreign = await call("POST", "/discovery/play", LISTENER, {
      kind: "track",
      mediaId: OTHER_TRACK,
      fanCode: code,
    });
    expect(foreign.json.counted).toBe(true); // a real play of real content — just not an arrival for this link
    expect(events("arrival")).toHaveLength(1);

    const wrongKind = await call("POST", "/discovery/play", LISTENER, {
      kind: "video",
      mediaId: VIDEO,
      fanCode: code,
    });
    expect(wrongKind.json.counted).toBe(true);
    expect(events("arrival")).toHaveLength(1);
  });

  it("unknown or malformed codes are ignored — the play still counts, nothing breaks", async () => {
    await mint("song", TRACK);
    const unknown = await call("POST", "/discovery/play", LISTENER, {
      kind: "track",
      mediaId: TRACK,
      fanCode: "zzzzzzzz",
    });
    expect(unknown.status).toBe(200);
    expect(unknown.json.counted).toBe(true);
    const malformed = await call("POST", `/media/track/${TRACK}/play?fan=nope`, LISTENER2);
    expect(malformed.status).toBe(200);
    expect(malformed.json.counted).toBe(true);
    expect(events("arrival")).toHaveLength(0);
  });

  it("a guest play carrying the code arrives anonymously (visitor null, like a guest click)", async () => {
    const code = await mint("song", TRACK);
    const play = await call("POST", "/discovery/play", null, {
      kind: "track",
      mediaId: TRACK,
      fanCode: code,
    });
    expect(play.json.counted).toBe(true);
    const arrivals = events("arrival");
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].visitor_user_id).toBeNull();
  });
});
