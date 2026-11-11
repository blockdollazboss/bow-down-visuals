/**
 * CA-4 (Stack400 charge audit, batch B4) — replay hardening for the
 * generate m–p Pattern B async-job rails: mastering, media-importer,
 * mix-master (master + mix), motion-track (track).
 *
 * These rails mint a server-owned background job after charging. The
 * CA-4 fix derives the job's identity from the server-derived charge
 * key (avatar-presenter CA-KEY precedent): a duplicate — concurrent
 * or sequential — computes the same jobId, finds the existing job,
 * and answers from it with replayed: true and NO new charge; when
 * the job's work fails, the runner refunds and VOIDS the charge key,
 * so the identical retry falls through to a fresh charged attempt.
 *
 * These tests fake the credits ledger and the media seams and pin,
 * per rail:
 *   1. fresh POST → 202 with the derived jobId; exactly one charge;
 *   2. duplicate POST (sequential + concurrent) → same jobId,
 *      replayed: true, no second charge, no second job;
 *   3. after the job FAILS (provider work throws), the charge is
 *      refunded and its key voided; the retry charges fresh and
 *      mints a live job under the same derived id.
 *
 * The job runners' ffmpeg work is faked at the child_process seam:
 * every ffmpeg/ffprobe call fails instantly, which is exactly the
 * "job fails → refund + void" leg. Waiting for the job to reach the
 * failed state polls the rail's own status route.
 *
 * mastering note: uploaded bytes go to os.tmpdir() via the REAL
 * tmpUploadStorage, so the test posts real multipart form data.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-1";

const h = vi.hoisted(() => ({
  balance: 100_000,
  charges: [] as Array<{ amount: number; key: string }>,
  refunds: [] as number[],
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  fetchMode: "fail" as "fail" | "ok",
}));

function keyFromCondition(cond: unknown): string | null {
  const walk = (node: unknown, depth: number): string | null => {
    if (node === null || typeof node !== "object" || depth > 6) return null;
    if ((node as { constructor?: { name?: string } }).constructor?.name === "Param") {
      const v = (node as { value?: unknown }).value;
      return typeof v === "string" ? v : null;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = walk(child, depth + 1);
        if (hit !== null) return hit;
      }
      return null;
    }
    const chunks = (node as { queryChunks?: unknown }).queryChunks;
    return Array.isArray(chunks) ? walk(chunks, depth + 1) : null;
  };
  return walk(cond, 0);
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    req.userCredits = h.balance;
    req.log = { info() {}, error() {}, warn() {} };
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  class LedgerWriteError extends Error { readonly code = "LEDGER_WRITE"; }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) =>
      typeof clientKey === "string" && clientKey.trim().length >= 8
        ? `${scope}:${userId}:client:${clientKey.trim()}`
        : `${scope}:${userId}:${JSON.stringify(intent)}`,
    chargeCredits: async (_userId: string, amount: number, _meta: unknown, opts?: { idempotencyKey?: string | null }) => {
      const key = opts?.idempotencyKey ?? "";
      if (key && h.chargedKeys.has(key)) return h.balance;
      if (h.balance < amount) throw new OutOfCreditsError("out");
      h.balance -= amount;
      if (key) h.chargedKeys.add(key);
      h.charges.push({ amount, key });
      return h.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      h.balance += amount;
      h.refunds.push(amount);
      return h.balance;
    },
    refundCreditsGuaranteed: async (_userId: string, amount: number, _meta: unknown, opts?: { idempotencyKey?: string | null }) => {
      /* Faithful mirror of the real helper against this fake ledger:
         refund, void only when the refund landed, exactly one retry. */
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          h.balance += amount;
          h.refunds.push(amount);
          if (opts?.idempotencyKey) {
            h.voids.push(opts.idempotencyKey);
            h.chargedKeys.delete(opts.idempotencyKey);
          }
          return true;
        } catch { /* the real helper retries exactly once */ }
      }
      return false;
    },
    voidChargeIdempotencyKey: async (key: string) => {
      h.voids.push(key);
      return h.chargedKeys.delete(key);
    },
  };
});

/* Every ffmpeg/ffprobe invocation fails — but AFTER a 250ms delay,
   on purpose: the runners' first exec call is still in flight when
   the test's sequential duplicate POST lands, so the duplicate must
   see the LIVE job and answer replayed: true. With an instant
   failure the job was already "failed" (+ refunded + voided) by
   duplicate time and the fall-through-to-fresh-attempt branch
   answered instead — correct code, wrong test timing. */
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    execFile: (_cmd: string, _args: unknown, _opts: unknown, cb?: unknown) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      const err = Object.assign(new Error("ffmpeg unavailable in test"), { code: 1 });
      setTimeout(() => (callback as any)(err, "", ""), 250);
      return { kill() {}, on() {}, stdout: null, stderr: null };
    },
  };
});

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (objectName: string) => `storage-ref:${objectName}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://signed.example/${ref}`,
  normalizeToStorageRef: (u: string) => u,
}));

vi.mock("../../lib/job-map-sweeper", () => ({ attachJobMapTtl: (_m: unknown) => {} }));
vi.mock("../../lib/library-song", () => ({
  librarySongTitle: (name: string, kind: string) => `${name} (${kind})`,
  recordLibrarySong: async () => "lib-song-1",
}));
vi.mock("../../lib/admin", () => ({ isAdminRequest: () => false }));
vi.mock("../../lib/logger", () => ({ logger: { info() {}, error() {}, warn() {} } }));
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../lib/co-stars", () => ({ buildCoStarContext: async () => null }));
vi.mock("../../lib/payment-record", () => ({ recordCreditUsage: async () => {}, recordGenerationHistory: async () => "hist-1", markGenerationHistoryCharged: async () => {} }));
vi.mock("../../lib/rail-core", () => ({ invokeRailHandler: async () => { throw new Error("rail-core unused in ca4 tests"); } }));
vi.mock("../../lib/voice-swap", () => ({ swapSongVocalsToVoice: async () => null }));
vi.mock("../../lib/r2-client", () => ({
  r2Upload: async () => {},
  r2PublicUrl: (key: string) => `https://r2.example/${key}`,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => ({
          limit: async () => {
            const key = keyFromCondition(cond);
            const row = key !== null ? h.stored.get(key) : undefined;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: { idempotencyKey: string; userId: string; rail: string; result: any }) => ({
        onConflictDoNothing: async () => {
          if (!h.stored.has(v.idempotencyKey)) {
            h.stored.set(v.idempotencyKey, { userId: v.userId, rail: v.rail, result: v.result });
          }
          return [];
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  };
  return { ...actual, db: fakeDb };
});

import masteringRouter from "../generate/mastering";
import mediaImporterRouter from "../generate/media-importer";
import mixMasterRouter from "../generate/mix-master";
import motionTrackRouter from "../generate/motion-track";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;

async function postJson(path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

async function getJson(path: string) {
  const res = await realFetch(`${base}${path}`);
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

async function postForm(path: string, build: (fd: FormData) => void) {
  const fd = new FormData();
  build(fd);
  const res = await realFetch(`${base}${path}`, { method: "POST", body: fd });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

async function waitFor(cond: () => boolean | Promise<boolean>, label: string, timeoutMs = 12_000) {
  const start = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(masteringRouter);
  app.use(mediaImporterRouter);
  app.use(mixMasterRouter);
  app.use(motionTrackRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  h.fetchMode = "fail";
  /* NOTE: the stub must be installed with a plain assignment, NOT
     vi.stubGlobal — stubGlobal registers the stub for automatic
     unstubbing BETWEEN TESTS in this vitest version, which silently
     restored the real fetch (motion-track's download then hit the
     real network and hung past the test timeout, and every later
     rail in the file inherited the confusion). */
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    if (url.startsWith(base)) return realFetch(input as any, init as any);
    /* Delayed 404 — same timing reason as the execFile delay: a
       fetch-first runner (media-importer, motion-track download)
       must still be working when the duplicate POST lands. */
    await new Promise((r) => setTimeout(r, 250));
    return { ok: false, status: 404, body: null, headers: { get: () => null } };
  }) as typeof fetch;
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
});

describe("mastering — CA-4 Pattern B derived job identity", () => {
  const audioBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const postMastering = () => postForm("/mastering", (fd) => {
    fd.append("audio", new Blob([audioBytes]), "take.wav");
    fd.append("preset", "streaming");
  });

  it("duplicate POSTs share one derived job and one charge; failure refunds+voids; retry charges fresh", async () => {
    const a = await postMastering();
    expect(a.status).toBe(202);
    expect(a.json?.["replayed"]).toBeUndefined();
    const jobId = a.json?.["jobId"] as string;
    expect(typeof jobId).toBe("string");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(400);

    const b = await postMastering();
    expect(b.status).toBe(202);
    expect(b.json?.["jobId"]).toBe(jobId);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);

    const [c1, c2] = await Promise.all([postMastering(), postMastering()]);
    expect(c1.json?.["jobId"]).toBe(jobId);
    expect(c2.json?.["jobId"]).toBe(jobId);
    expect(h.charges).toHaveLength(1);

    /* The runner's ffmpeg work fails → job failed, refund + void. */
    await waitFor(async () => {
      const s = await getJson(`/mastering/${jobId}`);
      return s.json?.["status"] === "failed";
    }, "mastering job to fail");
    expect(h.refunds).toEqual([400]);
    expect(h.voids).toHaveLength(1);
    expect(h.balance).toBe(100_000);

    const d = await postMastering();
    expect(d.status).toBe(202);
    expect(d.json?.["jobId"]).toBe(jobId);
    expect(d.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.balance).toBe(100_000 - 400);

    /* Drain: the retry job also fails and refunds — wait for it so
       nothing bleeds into the next describe's arrays. */
    await waitFor(async () => h.refunds.length >= 2, "retry job to fail and refund");
    expect(h.voids).toHaveLength(2);
    expect(h.balance).toBe(100_000);
  });
});

describe("media-importer — CA-4 Pattern B derived job identity", () => {
  /* format "video": the direct path skips the mp3 transcode, so the
     only failing seam needed is the fetch itself. The stubbed fetch
     404s in "fail" mode — the runner's download throws before any
     ffmpeg call, and the refund+void leg fires. */
  const body = { url: "https://cdn.example.com/clip.mp4", format: "video", rightsConfirmed: true };

  it("duplicate POSTs share one derived job and one charge; failure refunds+voids; retry charges fresh", async () => {
    const a = await postJson("/media-import", body);
    expect(a.status).toBe(202);
    expect(a.json?.["replayed"]).toBeUndefined();
    const jobId = a.json?.["jobId"] as string;
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(200);

    const b = await postJson("/media-import", body);
    expect(b.status).toBe(202);
    expect(b.json?.["jobId"]).toBe(jobId);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);

    const [c1, c2] = await Promise.all([postJson("/media-import", body), postJson("/media-import", body)]);
    expect(c1.json?.["jobId"]).toBe(jobId);
    expect(c2.json?.["jobId"]).toBe(jobId);
    expect(h.charges).toHaveLength(1);

    await waitFor(async () => {
      const s = await getJson(`/media-import/${jobId}`);
      return s.json?.["status"] === "failed";
    }, "import job to fail");
    /* The runner's catch records the refund failure-tolerantly: a
       400-shaped entry would mean the POST itself was rejected (the
       pre-fix shape); the real leg refunds exactly 200 once. */
    expect(h.refunds).toEqual([200]);
    expect(h.voids).toHaveLength(1);
    expect(h.balance).toBe(100_000);

    const d = await postJson("/media-import", body);
    expect(d.status).toBe(202);
    expect(d.json?.["jobId"]).toBe(jobId);
    expect(d.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.balance).toBe(100_000 - 200);

    await waitFor(async () => h.refunds.length >= 2, "retry job to fail and refund");
    expect(h.voids).toHaveLength(2);
    expect(h.balance).toBe(100_000);
  });
});

describe("mix-master — CA-4 Pattern B derived job identity (master route)", () => {
  const audioBytes = new Uint8Array([9, 8, 7, 6, 5]);
  const postMaster = () => postForm("/mix-master/master", (fd) => {
    fd.append("audio", new Blob([audioBytes]), "song.wav");
    fd.append("genre", "trap");
    fd.append("intensity", "balanced");
    fd.append("loudness", "streaming");
  });

  it("duplicate POSTs share one derived job and one charge; failure refunds+voids; retry charges fresh", async () => {
    const a = await postMaster();
    expect(a.status).toBe(202);
    expect(a.json?.["replayed"]).toBeUndefined();
    const jobId = a.json?.["jobId"] as string;
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(800);

    const b = await postMaster();
    expect(b.status).toBe(202);
    expect(b.json?.["jobId"]).toBe(jobId);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);

    const [c1, c2] = await Promise.all([postMaster(), postMaster()]);
    expect(c1.json?.["jobId"]).toBe(jobId);
    expect(c2.json?.["jobId"]).toBe(jobId);
    expect(h.charges).toHaveLength(1);

    await waitFor(async () => {
      const s = await getJson(`/mix-master/job/${jobId}`);
      return s.json?.["status"] === "failed";
    }, "mix-master job to fail");
    expect(h.refunds).toEqual([800]);
    expect(h.voids).toHaveLength(1);
    expect(h.balance).toBe(100_000);

    const d = await postMaster();
    expect(d.status).toBe(202);
    expect(d.json?.["jobId"]).toBe(jobId);
    expect(d.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.balance).toBe(100_000 - 800);

    await waitFor(async () => h.refunds.length >= 2, "retry job to fail and refund");
    expect(h.voids).toHaveLength(2);
    expect(h.balance).toBe(100_000);
  });
});

describe("motion-track — CA-4 Pattern B derived job identity (track route)", () => {
  const body = {
    videoUrl: "https://cdn.example.com/dance.mp4",
    box: { x: 0.1, y: 0.1, w: 0.3, h: 0.4 },
    durationSec: 5,
  };

  it("duplicate POSTs share one derived job and one charge; failure refunds+voids; retry charges fresh", async () => {
    const a = await postJson("/motion-track/track", body);
    expect(a.status).toBe(202);
    expect(a.json?.["replayed"]).toBeUndefined();
    const jobId = a.json?.["jobId"] as string;
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(350);

    const b = await postJson("/motion-track/track", body);
    expect(b.status).toBe(202);
    expect(b.json?.["jobId"]).toBe(jobId);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);

    const [c1, c2] = await Promise.all([postJson("/motion-track/track", body), postJson("/motion-track/track", body)]);
    expect(c1.json?.["jobId"]).toBe(jobId);
    expect(c2.json?.["jobId"]).toBe(jobId);
    expect(h.charges).toHaveLength(1);

    await waitFor(async () => {
      const s = await getJson(`/motion-track/job/${jobId}`);
      return s.json?.["state"] === "failed";
    }, "track job to fail");
    expect(h.refunds).toEqual([350]);
    expect(h.voids).toHaveLength(1);
    expect(h.balance).toBe(100_000);

    const d = await postJson("/motion-track/track", body);
    expect(d.status).toBe(202);
    expect(d.json?.["jobId"]).toBe(jobId);
    expect(d.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.balance).toBe(100_000 - 350);

    await waitFor(async () => h.refunds.length >= 2, "retry job to fail and refund");
    expect(h.voids).toHaveLength(2);
    expect(h.balance).toBe(100_000);
  });
});
