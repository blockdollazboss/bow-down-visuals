/**
 * Counter consistency, round 2 (stack1100 lane X5) — DELETE
 * /publish/video/:id in routes/publish.ts, over pg-mem.
 *
 * THE DEFECT: two denormalized counts live on rows OTHER than the
 * deleted video and were maintained only by their create doors:
 *  - challenges.entry_count is recomputed when an entry lands
 *    (challenge-engine.ts, shorts.ts) — but a video delete cascades
 *    the challenge_entries row away and nothing recomputed, so the
 *    challenge kept counting an entry that no longer exists.
 *  - profile_videos.sound_use_count is stamped across every video
 *    sharing a sound_id and refreshed when a short is created
 *    (shorts.ts) — a delete through the publish door never refreshed
 *    it, so the surviving carriers kept the stale total.
 *
 * The fix captures the affected challenges before the delete and
 * recomputes both counts from their rows after it — the same
 * recomputes the create doors run.
 *
 * Harness note: publish.ts checks ownership through an HTTP self-call
 * to /api/creator-profiles; the fetch stub below answers exactly that
 * call from the bearer token and passes everything else through. The
 * delete itself runs for real against pg-mem, FK cascade included.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => {
  process.env["DATABASE_URL"] = "postgres://test:test@localhost:5432/test";
  process.env["SUPABASE_URL"] = "http://localhost";
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test";
  return { db: null as any, mem: null as any };
});

const AUTHOR = "00000000-0000-4000-8000-0000000000a1";
const AUTHOR_PROFILE = "11111111-1111-4111-8111-1111111111a1";
const OTHER = "00000000-0000-4000-8000-0000000000b1";
const OTHER_PROFILE = "11111111-1111-4111-8111-1111111111b1";
const PROFILES_BY_USER: Record<string, string> = {
  [AUTHOR]: AUTHOR_PROFILE,
  [OTHER]: OTHER_PROFILE,
};

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) return res.status(401).json({ error: "Unauthorized" });
    req.userId = String(u);
    next();
  },
}));
vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async () => "ref",
  refreshSupabaseStorageUrl: (u: any) => u,
  refreshSupabaseStorageUrlsDeep: (v: any) => v,
}));
vi.mock("../../lib/mirrorMedia", () => ({ mirrorExternalMediaUrl: async (u: string) => u }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

import { createTestDb } from "../../lib/__tests__/test-db";
import publishRouter from "../publish";

const DDL = `
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL,
  sound_id text, sound_use_count integer NOT NULL DEFAULT 0);
CREATE TABLE challenges (id uuid PRIMARY KEY, entry_count integer NOT NULL DEFAULT 0);
CREATE TABLE challenge_entries (
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES profile_videos(id) ON DELETE CASCADE,
  PRIMARY KEY (challenge_id, video_id));
`;

const CHALLENGE = "33333333-3333-4333-8333-333333333333";
const V1 = "22222222-2222-4222-8222-222222222201";
const V2 = "22222222-2222-4222-8222-222222222202";
const V3 = "22222222-2222-4222-8222-222222222203";

let server: any;
let base: string;
const realFetch = globalThis.fetch;
beforeAll(async () => {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes("/api/creator-profiles")) {
      const auth = String(init?.headers?.Authorization ?? init?.headers?.authorization ?? "");
      const user = auth.replace("Bearer tok-", "");
      const profileId = PROFILES_BY_USER[user];
      return new Response(JSON.stringify(profileId ? [{ id: profileId }] : []), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use("/api/publish", publishRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((r) => server.close(() => r()));
});

function q(sqlText: string): any[] {
  return h.mem.public.many(sqlText);
}

beforeEach(() => {
  const t = createTestDb();
  h.db = t.db;
  h.mem = t.mem;
  h.mem.public.none(DDL);
  // The state the create doors would have left: V1+V2 entered in the
  // challenge (entry_count 2); V1+V2+V3 share one sound (use count 3).
  h.mem.public.none(`
    INSERT INTO challenges (id, entry_count) VALUES ('${CHALLENGE}', 2);
    INSERT INTO profile_videos (id, profile_id, sound_id, sound_use_count) VALUES
      ('${V1}', '${AUTHOR_PROFILE}', 'sound-x', 3),
      ('${V2}', '${AUTHOR_PROFILE}', 'sound-x', 3),
      ('${V3}', '${AUTHOR_PROFILE}', 'sound-x', 3);
    INSERT INTO challenge_entries (challenge_id, video_id) VALUES
      ('${CHALLENGE}', '${V1}'), ('${CHALLENGE}', '${V2}');
  `);
});

async function call(method: string, path: string, user: string) {
  const res = await realFetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-test-user": user,
      authorization: `Bearer tok-${user}`,
    },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe("DELETE /publish/video/:id — counter give-backs (stack1100 X5)", () => {
  it("recomputes the challenge's entry_count from the entries that stand", async () => {
    const res = await call("DELETE", `/publish/video/${V1}`, AUTHOR);
    expect(res.status).toBe(200);
    expect(q(`SELECT * FROM challenge_entries;`)).toHaveLength(1);
    expect(q(`SELECT entry_count FROM challenges WHERE id = '${CHALLENGE}';`)[0].entry_count).toBe(1);
    const res2 = await call("DELETE", `/publish/video/${V2}`, AUTHOR);
    expect(res2.status).toBe(200);
    expect(q(`SELECT * FROM challenge_entries;`)).toHaveLength(0);
    expect(q(`SELECT entry_count FROM challenges WHERE id = '${CHALLENGE}';`)[0].entry_count).toBe(0);
  });

  it("refreshes sound_use_count across the sound's surviving carriers", async () => {
    const res = await call("DELETE", `/publish/video/${V1}`, AUTHOR);
    expect(res.status).toBe(200);
    const rows = q(`SELECT id, sound_use_count FROM profile_videos ORDER BY id;`);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.sound_use_count).toBe(2);
  });

  it("a stranger's delete is refused and moves nothing", async () => {
    const res = await call("DELETE", `/publish/video/${V1}`, OTHER);
    expect(res.status).toBe(403);
    expect(q(`SELECT * FROM profile_videos;`)).toHaveLength(3);
    expect(q(`SELECT entry_count FROM challenges WHERE id = '${CHALLENGE}';`)[0].entry_count).toBe(2);
    expect(q(`SELECT sound_use_count FROM profile_videos WHERE id = '${V2}';`)[0].sound_use_count).toBe(3);
  });

  it("deleting a video with no sound and no entries is a plain delete", async () => {
    h.mem.public.none(`
      INSERT INTO profile_videos (id, profile_id, sound_id, sound_use_count)
      VALUES ('${V3.replace("203", "209")}', '${AUTHOR_PROFILE}', NULL, 0);
    `);
    const plain = V3.replace("203", "209");
    const res = await call("DELETE", `/publish/video/${plain}`, AUTHOR);
    expect(res.status).toBe(200);
    expect(q(`SELECT entry_count FROM challenges WHERE id = '${CHALLENGE}';`)[0].entry_count).toBe(2);
  });
});
