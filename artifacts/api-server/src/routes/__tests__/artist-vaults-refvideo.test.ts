/**
 * Route-level tests for the Artist Vault REFERENCE-VIDEO rails
 * (Stack-4 wave-2 #1 — reference-video honesty):
 *   POST /api/artist-vaults/:id/reference-video/attach
 *   POST /api/artist-vaults/:id/reference-video          (generate submit)
 *   GET  /api/artist-vaults/:id/reference-video/:taskId  (generate poll)
 *   POST /api/artist-vaults/:id/reference-video/loop     (loop submit)
 *   GET  /api/artist-vaults/:id/reference-video/loop/:taskId (loop poll)
 *
 * The defect: all three paths gated on USE-access (owner or team
 * member) but their writes are OWNER-scoped, and both polls charged
 * the caller BEFORE the save. A team member was charged 1,500 / 200
 * Visual Bucs and told "succeeded" while zero rows changed. These
 * tests pin the fixed contract: non-owners are refused honestly
 * (no-leak 404) before any charge, any provider submission, or any
 * mirror work; the polls re-check ownership before charging; owner
 * flows work end-to-end with the charge landing exactly once.
 *
 * RESERVE-AT-SUBMIT (stack1400 ruling #43 Part B): the generate rail
 * now charges 1,500 at SUBMIT (before the provider call) and the poll
 * only saves or refunds; the same reversal for the loop rail is pinned
 * in its own sections below.
 *
 * Heavy modules (DB, auth, Runway, credits) are mocked; the real
 * Express router runs against a local ephemeral server — the same
 * harness as artist-vaults-manage.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  vaultRows: [] as any[],
  linkRows: [] as any[],
  balances: {} as Record<string, number>,
  taskSeq: 0,
  chargeCalls: [] as any[],
  refundCalls: [] as any[],
  createCalls: 0,
  mirrorCalls: 0,
  failVaultUpdates: false,
  events: [] as string[],
  createImpl: null as null | (() => Promise<any>),
  retrieveImpl: null as null | (() => Promise<any>),
  loopImpl: null as null | (() => Promise<any>),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __eq: true, col: col.__col, val }),
  and: (...conds: any[]) => ({ __and: true, conds }),
  or: (...conds: any[]) => ({ __or: true, conds }),
  isNull: (col: any) => ({ __isNull: true, col: col.__col }),
  asc: (col: any) => ({ __asc: true, col: col.__col }),
  desc: (col: any) => ({ __desc: true, col: col.__col }),
  sql: (strings: any, ...vals: any[]) => ({ __sql: true, strings, vals }),
}));

function matchRow(row: any, where: any): boolean {
  if (!where) return true;
  if (where.__eq) return row[where.col] === where.val;
  if (where.__isNull) return row[where.col] === null || row[where.col] === undefined;
  if (where.__and) return (where.conds as any[]).every((c) => matchRow(row, c));
  if (where.__or) return (where.conds as any[]).some((c) => matchRow(row, c));
  return true;
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const auth = req.headers["authorization"];
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = (req.headers["x-test-user"] as string) || "user-1";
    req.log = { info: () => {}, error: () => {} };
    // Balance reads in the submit handlers go through the caller's
    // Supabase client; steer them from the hoisted balance table.
    req.userSupabase = {
      from: (_table: string) => ({
        select: (_cols: string) => ({
          eq: (_col: string, val: string) => ({
            single: async () => ({ data: { credits: state.balances[val] ?? 0 } }),
          }),
        }),
      }),
    };
    next();
  },
}));

vi.mock("@runwayml/sdk", () => ({
  default: class {
    imageToVideo = {
      create: vi.fn(async () => {
        state.createCalls++;
        state.events.push("provider");
        if (state.createImpl) return state.createImpl();
        return { id: `gen-task-${++state.taskSeq}` };
      }),
    };
    tasks = {
      retrieve: vi.fn(async () => {
        if (state.retrieveImpl) return state.retrieveImpl();
        return {
          status: "SUCCEEDED",
          output: ["https://provider.example/living-portrait.mp4"],
        };
      }),
    };
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (userId: string, amount: number, meta: any, opts?: any) => {
    state.chargeCalls.push({ userId, amount, meta, opts });
    state.events.push("charge");
    return 4242;
  }),
  refundCredits: vi.fn(async (userId: string, amount: number, meta: any) => {
    state.refundCalls.push({ userId, amount, meta });
    state.events.push("refund");
  }),
  LedgerWriteError: class LedgerWriteError extends Error {},
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  voidChargeIdempotencyKey: vi.fn(async () => true),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
}));

vi.mock("../../lib/r2-client", () => ({
  r2Upload: vi.fn(async (path: string) => `https://r2.example/${path}`),
}));

vi.mock("../../lib/teams", () => ({
  // user-1's active team is team-1 — that's what gives them
  // USE-access (not ownership) to the team-shared vault below.
  getUserActiveTeam: vi.fn(async (userId: string) =>
    userId === "user-1" ? { team: { id: "team-1" } } : null,
  ),
}));

vi.mock("./generate/clip-pricing", () => ({
  SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT: 300,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => {
    state.mirrorCalls++;
    return v ?? null;
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: vi.fn(async (v: any) => v),
}));

vi.mock("../../lib/video-loop", () => ({
  // Produce a REAL temp file per job: the route reads it back and
  // cleans the work dir up itself, exactly like production.
  loopVideoFromUrl: vi.fn(async () => {
    if (state.loopImpl) return state.loopImpl();
    const workDir = await mkdtemp(join(tmpdir(), "refvideo-loop-"));
    const outPath = join(workDir, "loop.mp4");
    await writeFile(outPath, "fake-looped-mp4-bytes");
    return { outPath, workDir };
  }),
  VideoLoopError: class VideoLoopError extends Error {},
}));

vi.mock("../../lib/character-voice-profile", () => ({
  sanitizeCharacterVoiceProfile: vi.fn((v: any) => v),
}));

vi.mock("@workspace/db", () => {
  const mkTable = (name: string, rowsKey: "vaultRows" | "linkRows", cols: string[]) => {
    const t: any = { __table: name, __rowsKey: rowsKey };
    for (const c of cols) t[c] = { __col: c };
    return t;
  };
  const rowsOf = (t: any): any[] => (state as any)[t.__rowsKey];
  const setRows = (t: any, rows: any[]) => {
    (state as any)[t.__rowsKey] = rows;
  };
  const chain = (rows: any[]) => ({
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    orderBy: (..._o: any[]) => Promise.resolve(rows),
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
  });
  return {
    db: {
      select: (_fields?: any) => ({
        from: (table: any) => ({
          where: (w: any) => chain(rowsOf(table).filter((r) => matchRow(r, w))),
        }),
      }),
      insert: (table: any) => ({
        values: (vals: any) => ({
          returning: () => {
            const row = { id: `row-${rowsOf(table).length + 1}`, ...vals };
            setRows(table, [...rowsOf(table), row]);
            return Promise.resolve([row]);
          },
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
      update: (table: any) => ({
        set: (vals: any) => ({
          where: (w: any) => {
            if (state.failVaultUpdates && table.__rowsKey === "vaultRows") {
              return Promise.reject(new Error("simulated vault write failure"));
            }
            for (const r of rowsOf(table)) if (matchRow(r, w)) Object.assign(r, vals);
            return Promise.resolve([]);
          },
        }),
      }),
      delete: (table: any) => ({
        where: (w: any) => {
          setRows(table, rowsOf(table).filter((r) => !matchRow(r, w)));
          return Promise.resolve([]);
        },
      }),
      execute: () => Promise.resolve({ rows: [] }),
    },
    artistVaultsTable: mkTable("artist_vaults", "vaultRows", [
      "id", "user_id", "team_id", "deleted_at", "created_at", "updated_at",
      "artist_name", "reference_image_url", "reference_video_url", "reference_video_path",
      "spotlight_order",
    ]),
    artistCharacterLinksTable: mkTable("artist_character_links", "linkRows", [
      "id", "user_id", "character_id", "linked_character_id", "created_at",
    ]),
  };
});

import router from "../artist-vaults";

let server: any;
let baseUrl: string;
const AUTH = { Authorization: "Bearer test-token" };
const asUser2 = { Authorization: "Bearer test-token", "x-test-user": "user-2" };
const asUser3 = { Authorization: "Bearer test-token", "x-test-user": "user-3" };

beforeAll(async () => {
  process.env["RUNWAYML_API_SECRET"] = "test-key";
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.vaultRows = [
    {
      id: "vault-own", user_id: "user-1", team_id: null, deleted_at: null,
      artist_name: "Owner Char",
      reference_image_url: "https://cdn.example/own.png",
      reference_video_url: "https://cdn.example/own.mp4",
      reference_video_path: "own/path.mp4",
    },
    {
      // Owned by user-2, shared with team-1. Default caller user-1 is
      // a team member: USE-access yes, ownership no — the defect case.
      id: "vault-team", user_id: "user-2", team_id: "team-1", deleted_at: null,
      artist_name: "Teammate Char",
      reference_image_url: "https://cdn.example/team.png",
      reference_video_url: "https://cdn.example/team.mp4",
      reference_video_path: "team/path.mp4",
    },
  ];
  state.linkRows = [];
  state.balances = { "user-1": 100_000, "user-2": 100_000, "user-3": 100_000 };
  state.chargeCalls = [];
  state.refundCalls = [];
  state.createCalls = 0;
  state.mirrorCalls = 0;
  state.failVaultUpdates = false;
  state.events = [];
  state.createImpl = null;
  state.retrieveImpl = null;
  state.loopImpl = null;
});

const post = (p: string, body: any, headers: any = AUTH) =>
  fetch(`${baseUrl}${p}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const get = (p: string, headers: any = AUTH) => fetch(`${baseUrl}${p}`, { headers });

const vaultRow = (id: string) => state.vaultRows.find((r) => r.id === id);
const snapshot = (id: string) => JSON.parse(JSON.stringify(vaultRow(id)));

/* An https URL nothing listens on: the attach HEAD check fails fast
   and the handler falls through, exactly as it does for dead links. */
const ATTACH_URL = "https://127.0.0.1:9/clip.mp4";

describe("POST /artist-vaults/:id/reference-video/attach", () => {
  it("team member (use-access, not owner) is refused 404 — no write, no mirror work", async () => {
    const before = snapshot("vault-team");
    const res = await post("/artist-vaults/vault-team/reference-video/attach", { videoUrl: ATTACH_URL });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Vault not found.");
    expect(snapshot("vault-team")).toEqual(before);
    expect(state.mirrorCalls).toBe(0);
    expect(state.chargeCalls).toEqual([]);
  });

  it("owner attach works: row updated, path cleared, success answered", async () => {
    const res = await post("/artist-vaults/vault-own/reference-video/attach", { videoUrl: ATTACH_URL });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.url).toBe(ATTACH_URL);
    expect(vaultRow("vault-own").reference_video_url).toBe(ATTACH_URL);
    expect(vaultRow("vault-own").reference_video_path).toBeNull();
  });

  it("the team vault's actual owner can attach to it", async () => {
    const res = await post("/artist-vaults/vault-team/reference-video/attach", { videoUrl: ATTACH_URL }, asUser2);
    expect(res.status).toBe(200);
    expect(vaultRow("vault-team").reference_video_url).toBe(ATTACH_URL);
  });

  it("a stranger with no access gets the same 404 (no existence leak)", async () => {
    const before = snapshot("vault-team");
    const res = await post("/artist-vaults/vault-team/reference-video/attach", { videoUrl: ATTACH_URL }, asUser3);
    expect(res.status).toBe(404);
    expect(snapshot("vault-team")).toEqual(before);
  });

  it("attach to a nonexistent vault 404s", async () => {
    const res = await post("/artist-vaults/vault-nope/reference-video/attach", { videoUrl: ATTACH_URL });
    expect(res.status).toBe(404);
  });
});

describe("POST /artist-vaults/:id/reference-video — generate submit", () => {
  it("team member submit is refused 404 BEFORE any provider submission", async () => {
    const res = await post("/artist-vaults/vault-team/reference-video", {});
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Character not found");
    expect(state.createCalls).toBe(0);
    expect(state.chargeCalls).toEqual([]);
  });

  it("owner submit RESERVES at submit: charges 1,500 BEFORE the provider call and quotes the real price", async () => {
    const res = await post("/artist-vaults/vault-own/reference-video", {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskId).toMatch(/^gen-task-/);
    expect(body.creditCost).toBe(1500); // 5s × 300 VB/s (mocked rate)
    expect(state.createCalls).toBe(1);
    expect(state.chargeCalls).toHaveLength(1);
    expect(state.chargeCalls[0].userId).toBe("user-1");
    expect(state.chargeCalls[0].amount).toBe(1500);
    expect(state.chargeCalls[0].meta).toEqual({ action: "Character Reference Video", projectId: null });
    expect(state.chargeCalls[0].opts?.idempotencyKey).toMatch(/^artist-vault-ref-video:/);
    // Charge strictly precedes the provider submission.
    expect(state.events.indexOf("charge")).toBeLessThan(state.events.indexOf("provider"));
    expect(state.refundCalls).toEqual([]);
  });

  it("owner with too-small balance still gets the honest 402 — no charge, no provider call", async () => {
    state.balances["user-1"] = 100;
    const res = await post("/artist-vaults/vault-own/reference-video", {});
    expect(res.status).toBe(402);
    expect(state.createCalls).toBe(0);
    expect(state.chargeCalls).toEqual([]);
  });

  it("provider submission throwing at submit refunds the reserve exactly once", async () => {
    state.createImpl = async () => { throw new Error("runway unavailable"); };
    const res = await post("/artist-vaults/vault-own/reference-video", {});
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/refunded/);
    expect(state.chargeCalls).toHaveLength(1);
    expect(state.refundCalls).toEqual([
      {
        userId: "user-1",
        amount: 1500,
        meta: { action: "Character Reference Video — Refund (provider failed to start)", projectId: null },
      },
    ]);
  });
});

describe("GET /artist-vaults/:id/reference-video/:taskId — generate poll", () => {
  async function submitAsOwner(): Promise<string> {
    const res = await post("/artist-vaults/vault-own/reference-video", {});
    expect(res.status).toBe(200);
    return (await res.json()).taskId as string;
  }

  it("owner poll on SUCCEEDED: the submit charge is the ONLY charge (kept) and the save lands", async () => {
    const taskId = await submitAsOwner();
    expect(state.chargeCalls).toHaveLength(1); // reserved at submit
    const res = await get(`/artist-vaults/vault-own/reference-video/${taskId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("succeeded");
    expect(state.chargeCalls).toHaveLength(1); // poll charges nothing more
    expect(state.refundCalls).toEqual([]);
    expect(vaultRow("vault-own").reference_video_url).toBe("https://provider.example/living-portrait.mp4");
  });

  it("provider FAILED at poll refunds the reserve exactly once", async () => {
    const taskId = await submitAsOwner();
    state.retrieveImpl = async () => ({ status: "FAILED", output: [] });
    const res = await get(`/artist-vaults/vault-own/reference-video/${taskId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("failed");
    expect(state.chargeCalls).toHaveLength(1);
    expect(state.refundCalls).toEqual([
      {
        userId: "user-1",
        amount: 1500,
        meta: { action: "Character Reference Video — Refund (provider failed)", projectId: null },
      },
    ]);
    // A second poll 404s and cannot refund again.
    const again = await get(`/artist-vaults/vault-own/reference-video/${taskId}`);
    expect(again.status).toBe(404);
    expect(state.refundCalls).toHaveLength(1);
  });

  it("SUCCEEDED with NO output refunds the reserve and saves nothing", async () => {
    const taskId = await submitAsOwner();
    state.retrieveImpl = async () => ({ status: "SUCCEEDED", output: [] });
    const res = await get(`/artist-vaults/vault-own/reference-video/${taskId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.error).toMatch(/refunded/);
    expect(state.refundCalls).toEqual([
      {
        userId: "user-1",
        amount: 1500,
        meta: { action: "Character Reference Video — Refund (no output)", projectId: null },
      },
    ]);
    expect(vaultRow("vault-own").reference_video_url).toBe("https://cdn.example/own.mp4");
  });

  it("a second poll 404s and never double-charges", async () => {
    const taskId = await submitAsOwner();
    await get(`/artist-vaults/vault-own/reference-video/${taskId}`);
    const res = await get(`/artist-vaults/vault-own/reference-video/${taskId}`);
    expect(res.status).toBe(404);
    expect(state.chargeCalls).toHaveLength(1);
  });

  it("if the vault stops being the caller's before the poll, the reserve is refunded and nothing is saved", async () => {
    const taskId = await submitAsOwner();
    vaultRow("vault-own").user_id = "user-9"; // ownership moved mid-flight
    const res = await get(`/artist-vaults/vault-own/reference-video/${taskId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("failed");
    expect(state.chargeCalls).toHaveLength(1); // the submit reserve…
    expect(state.refundCalls).toEqual([
      {
        userId: "user-1",
        amount: 1500,
        meta: { action: "Character Reference Video — Refund (character no longer yours)", projectId: null },
      },
    ]); // …refunded in full
    expect(vaultRow("vault-own").reference_video_url).toBe("https://cdn.example/own.mp4");
  });

  it("G1: if the save throws AFTER the charge, the 1,500 VB is refunded exactly once", async () => {
    const taskId = await submitAsOwner();
    state.failVaultUpdates = true;
    const res = await get(`/artist-vaults/vault-own/reference-video/${taskId}`);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/refunded/);
    expect(state.chargeCalls).toHaveLength(1);
    expect(state.refundCalls).toEqual([
      {
        userId: "user-1",
        amount: 1500,
        meta: { action: "Character Reference Video — Refund (save failed)", projectId: null },
      },
    ]);
    // The row was never written.
    expect(vaultRow("vault-own").reference_video_url).toBe("https://cdn.example/own.mp4");
  });
});

describe("POST /artist-vaults/:id/reference-video/loop — loop submit", () => {
  it("team member submit is refused 404 — no job, no charge", async () => {
    const res = await post("/artist-vaults/vault-team/reference-video/loop", {});
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Artist vault not found.");
    expect(state.chargeCalls).toEqual([]);
    const poll = await get("/artist-vaults/vault-team/reference-video/loop/anything");
    expect(poll.status).toBe(404);
  });

  it("owner with too-small balance still gets the honest 402 and no job", async () => {
    state.balances["user-1"] = 50;
    const res = await post("/artist-vaults/vault-own/reference-video/loop", {});
    expect(res.status).toBe(402);
    expect(state.chargeCalls).toEqual([]);
  });

  it("owner submit RESERVES 200 at submit, keyed on the task id, before the job runs", async () => {
    const res = await post("/artist-vaults/vault-own/reference-video/loop", {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.creditCost).toBe(200);
    expect(state.chargeCalls).toHaveLength(1);
    expect(state.chargeCalls[0].userId).toBe("user-1");
    expect(state.chargeCalls[0].amount).toBe(200);
    expect(state.chargeCalls[0].meta).toEqual({ action: "Artist Vault Video Loop", projectId: null });
    expect(state.chargeCalls[0].opts?.idempotencyKey).toBe(`artist-vault-ref-video-loop:${body.taskId}`);
    expect(state.refundCalls).toEqual([]);
  });
});

describe("GET /artist-vaults/:id/reference-video/loop/:taskId — loop poll", () => {
  async function submitLoopAsOwner(): Promise<string> {
    const res = await post("/artist-vaults/vault-own/reference-video/loop", {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.creditCost).toBe(200);
    return body.taskId as string;
  }

  async function pollUntilTerminal(taskId: string, headers: any = AUTH): Promise<any> {
    for (let i = 0; i < 100; i++) {
      const res = await get(`/artist-vaults/vault-own/reference-video/loop/${taskId}`, headers);
      expect(res.status).toBe(200);
      const body = await res.json();
      if (body.status !== "processing") return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("loop job never reached a terminal state");
  }

  it("owner poll on done: the submit charge is the ONLY charge (200, kept) and the looped video is saved", async () => {
    const taskId = await submitLoopAsOwner();
    expect(state.chargeCalls).toHaveLength(1); // reserved at submit
    const body = await pollUntilTerminal(taskId);
    expect(body.status).toBe("succeeded");
    expect(body.newBalance).toBe(4242); // the submit charge's returned balance
    expect(state.chargeCalls).toHaveLength(1); // poll charges nothing more
    expect(state.refundCalls).toEqual([]);
    const row = vaultRow("vault-own");
    expect(row.reference_video_url).toMatch(/^https:\/\/r2\.example\/user-1\/reference-videos\/.+-loop\.mp4$/);
    expect(row.reference_video_path).toMatch(/^user-1\/reference-videos\/.+-loop\.mp4$/);
    // The task is consumed: a repeat poll 404s and cannot re-charge.
    const again = await get(`/artist-vaults/vault-own/reference-video/loop/${taskId}`);
    expect(again.status).toBe(404);
    expect(state.chargeCalls).toHaveLength(1);
  });

  it("processing failure refunds the reserve exactly once", async () => {
    state.loopImpl = async () => { throw new Error("ffmpeg died"); };
    const taskId = await submitLoopAsOwner();
    const body = await pollUntilTerminal(taskId);
    expect(body.status).toBe("failed");
    expect(body.error).toMatch(/ffmpeg died/);
    expect(state.chargeCalls).toHaveLength(1);
    expect(state.refundCalls).toEqual([
      {
        userId: "user-1",
        amount: 200,
        meta: { action: "Artist Vault Video Loop — Refund (processing failed)", projectId: null },
      },
    ]);
    const again = await get(`/artist-vaults/vault-own/reference-video/loop/${taskId}`);
    expect(again.status).toBe(404);
    expect(state.refundCalls).toHaveLength(1); // no double refund
  });

  it("if the vault stops being the caller's before the poll, the reserve is refunded and nothing is saved", async () => {
    const taskId = await submitLoopAsOwner();
    vaultRow("vault-own").user_id = "user-9"; // ownership moved mid-flight
    const body = await pollUntilTerminal(taskId);
    expect(body.status).toBe("failed");
    expect(body.error).toMatch(/refunded/);
    expect(state.chargeCalls).toHaveLength(1); // the submit reserve…
    expect(state.refundCalls).toEqual([
      {
        userId: "user-1",
        amount: 200,
        meta: { action: "Artist Vault Video Loop — Refund (character no longer yours)", projectId: null },
      },
    ]); // …refunded in full
    expect(vaultRow("vault-own").reference_video_url).toBe("https://cdn.example/own.mp4");
  });

  it("G4: if the save throws, the 200 VB reserve is refunded exactly once", async () => {
    const taskId = await submitLoopAsOwner();
    state.failVaultUpdates = true;
    const body = await pollUntilTerminal(taskId);
    expect(body.status).toBe("failed");
    expect(body.error).toMatch(/refunded/);
    expect(state.chargeCalls).toHaveLength(1);
    expect(state.refundCalls).toEqual([
      {
        userId: "user-1",
        amount: 200,
        meta: { action: "Artist Vault Video Loop — Refund (save failed)", projectId: null },
      },
    ]);
    expect(vaultRow("vault-own").reference_video_url).toBe("https://cdn.example/own.mp4");
  });
});
