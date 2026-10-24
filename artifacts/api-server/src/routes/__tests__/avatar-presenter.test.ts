/**
 * Avatar presenter — Hedra wiring, money-path pins.
 *
 * The 1,200 VB price is owner-ruled (Oct 24 2026), charged on SUCCESS
 * only, exactly once. Provider + credits + storage are faked at their
 * module seams; the router runs over real HTTP.
 *
 *  - status reports the real 1,200 price, pricePlaceholder: false
 *  - no provider key → 503 AVATAR_PROVIDER_NOT_CONFIGURED, no charge
 *  - balance < 1,200 → 402 and the provider is NEVER called
 *  - success → exactly one 1,200 charge under `avatar-presenter:<jobId>`
 *  - a replayed completion cannot double-charge (idempotency key)
 *  - provider failure → job failed, zero charges, balance untouched
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => ({
  balance: 5000,
  charges: [] as { amount: number; key: string }[],
  chargedKeys: new Set<string>(),
  configured: true,
  submitCalls: 0,
  submitImpl: null as null | (() => Promise<{ providerJobId: string; status: string }>),
  statusImpl: null as null | (() => Promise<{ providerJobId: string; status: string; videoUrl?: string; error?: string }>),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: { userId?: string; userCredits?: number }, _res: unknown, next: () => void) => {
    req.userId = "user-1";
    req.userCredits = state.balance;
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {
    readonly code = "OUT_OF_CREDITS";
  }
  return {
    OutOfCreditsError,
    chargeCredits: async (
      _userId: string,
      cost: number,
      _rec: unknown,
      opts?: { idempotencyKey?: string },
    ) => {
      const key = opts?.idempotencyKey ?? "";
      if (key && state.chargedKeys.has(key)) return state.balance; // idempotent replay
      if (state.balance < cost) throw new OutOfCreditsError("out_of_credits");
      state.balance -= cost;
      if (key) state.chargedKeys.add(key);
      state.charges.push({ amount: cost, key });
      return state.balance;
    },
  };
});

vi.mock("../../lib/avatar-client", () => {
  class AvatarNotConfiguredError extends Error {
    readonly code = "AVATAR_PROVIDER_NOT_CONFIGURED";
    constructor() {
      super("not configured");
      this.name = "AvatarNotConfiguredError";
    }
  }
  return {
    AvatarNotConfiguredError,
    avatarProviderConfigured: () => state.configured,
    avatarProviderName: () => (state.configured ? "hedra" : null),
    AVATAR_PLACEHOLDER_CATALOG: [
      { id: "avatar-host-male", name: "Host — Male", style: "Confident studio host", providerAvatarId: null, imageUrl: null },
    ],
    submitAvatarVideo: async () => {
      state.submitCalls += 1;
      if (state.submitImpl) return state.submitImpl();
      return { providerJobId: "hedra-job-1", status: "processing" };
    },
    getAvatarVideoStatus: async (providerJobId: string) => {
      if (state.statusImpl) return state.statusImpl();
      return { providerJobId, status: "processing" };
    },
  };
});

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (objectName: string) => `r2://generated-clips/${objectName}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://cdn.example/play?ref=${encodeURIComponent(ref)}`,
}));

import avatarPresenterRouter, {
  AVATAR_PRESENTER_CREDIT_COST,
  processAvatarJob,
  __putAvatarJob,
  type AvatarJob,
} from "../generate/avatar-presenter";

const realFetch = globalThis.fetch;
let base = "";
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  process.env["AVATAR_POLL_INTERVAL_MS"] = "1";
  // The finished-video download inside the route uses global fetch: serve
  // fake bytes for the provider URL, delegate everything else (our own
  // test HTTP calls) to the real fetch.
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://provider.example/finished.mp4") {
      return new Response(Buffer.from("fake-mp4-bytes"), { status: 200 });
    }
    return realFetch(input as string, init);
  });

  const app = express();
  app.use(express.json());
  app.use(avatarPresenterRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env["AVATAR_POLL_INTERVAL_MS"];
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  state.balance = 5000;
  state.charges = [];
  state.chargedKeys = new Set();
  state.configured = true;
  state.submitCalls = 0;
  state.submitImpl = null;
  state.statusImpl = null;
});

async function post(path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function getJob(jobId: string) {
  const res = await realFetch(`${base}/avatar-presenter/${jobId}`);
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function waitForTerminal(jobId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 8_000;
  for (;;) {
    const { json } = await getJob(jobId);
    if (json && (json["status"] === "done" || json["status"] === "failed")) return json;
    if (Date.now() > deadline) throw new Error(`job ${jobId} never reached a terminal state`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const validBody = {
  avatarId: "avatar-host-male",
  script: "Welcome back.",
  imageUrl: "https://img.example/char.png",
  audioUrl: "https://audio.example/voice.mp3",
};

describe("GET /avatar-presenter/status", () => {
  it("reports the ruled 1,200 VB price as final (not a placeholder)", async () => {
    const res = await realFetch(`${base}/avatar-presenter/status`);
    const json = (await res.json()) as { configured: boolean; provider: string; creditCost: number; pricePlaceholder: boolean };
    expect(json.configured).toBe(true);
    expect(json.provider).toBe("hedra");
    expect(json.creditCost).toBe(1200);
    expect(json.creditCost).toBe(AVATAR_PRESENTER_CREDIT_COST);
    expect(json.pricePlaceholder).toBe(false);
  });
});

describe("POST /avatar-presenter — gates", () => {
  it("no provider key → honest 503, no submit, no charge", async () => {
    state.configured = false;
    const r = await post("/avatar-presenter", validBody);
    expect(r.status).toBe(503);
    expect(r.json?.["error"]).toBe("AVATAR_PROVIDER_NOT_CONFIGURED");
    expect(state.submitCalls).toBe(0);
    expect(state.charges).toEqual([]);
  });

  it("balance below 1,200 → 402 BEFORE the provider is called", async () => {
    state.balance = 1199;
    const r = await post("/avatar-presenter", validBody);
    expect(r.status).toBe(402);
    expect(r.json?.["error"]).toBe("OUT_OF_CREDITS");
    expect(r.json?.["creditsNeeded"]).toBe(1200);
    expect(state.submitCalls).toBe(0);
    expect(state.charges).toEqual([]);
  });

  it("exact balance of 1,200 is allowed through the gate", async () => {
    state.balance = 1200;
    state.statusImpl = async () => ({ providerJobId: "hedra-job-1", status: "failed", error: "provider said no" });
    const r = await post("/avatar-presenter", validBody);
    expect(r.status).toBe(202);
    const job = await waitForTerminal(String(r.json?.["jobId"]));
    expect(job["status"]).toBe("failed");
    expect(state.charges).toEqual([]); // failed job: never charged
    expect(state.balance).toBe(1200);
  });
});

describe("POST /avatar-presenter — money path", () => {
  it("success charges exactly 1,200 VB once and surfaces the stored video", async () => {
    let polls = 0;
    state.statusImpl = async () => {
      polls += 1;
      if (polls < 2) return { providerJobId: "hedra-job-1", status: "processing" };
      return { providerJobId: "hedra-job-1", status: "done", videoUrl: "https://provider.example/finished.mp4" };
    };
    const r = await post("/avatar-presenter", validBody);
    expect(r.status).toBe(202);
    const jobId = String(r.json?.["jobId"]);
    const job = await waitForTerminal(jobId);
    expect(job["status"]).toBe("done");
    expect(job["creditsCharged"]).toBe(1200);
    expect(String(job["outputUrl"])).toContain("cdn.example/play");
    expect(state.charges).toEqual([{ amount: 1200, key: `avatar-presenter:${jobId}` }]);
    expect(state.balance).toBe(3800);
  });

  it("a replayed completion cannot double-charge (same idempotency key)", async () => {
    state.statusImpl = async () => ({
      providerJobId: "hedra-job-1",
      status: "done",
      videoUrl: "https://provider.example/finished.mp4",
    });
    const r = await post("/avatar-presenter", validBody);
    const jobId = String(r.json?.["jobId"]);
    await waitForTerminal(jobId);
    expect(state.charges).toHaveLength(1);

    // Drive the worker a second time for the same job id (crash/retry replay).
    const replay: AvatarJob = {
      id: jobId,
      userId: "user-1",
      status: "queued",
      avatarId: "avatar-host-male",
      script: "Welcome back.",
      outputUrl: null,
      error: null,
      creditsCharged: 0,
      providerJobId: null,
      createdAt: Date.now(),
    };
    __putAvatarJob(replay);
    await processAvatarJob(replay, { imageUrl: validBody.imageUrl, audioUrl: validBody.audioUrl });
    expect(replay.status).toBe("done");
    expect(state.charges).toHaveLength(1); // still exactly one charge
    expect(state.balance).toBe(3800);
  });

  it("provider failure → job failed with the provider's message, zero charges", async () => {
    state.statusImpl = async () => ({
      providerJobId: "hedra-job-1",
      status: "failed",
      error: "Hedra generation failed: bad audio",
    });
    const r = await post("/avatar-presenter", validBody);
    const job = await waitForTerminal(String(r.json?.["jobId"]));
    expect(job["status"]).toBe("failed");
    expect(String(job["error"])).toContain("bad audio");
    expect(job["creditsCharged"]).toBe(0);
    expect(state.charges).toEqual([]);
    expect(state.balance).toBe(5000);
  });

  it("submit throwing (e.g. missing character image) → job failed, zero charges", async () => {
    state.submitImpl = async () => {
      const err = new Error("Hedra Character-3 animates a character image — supply one to generate.");
      err.name = "AvatarInputError";
      throw err;
    };
    const r = await post("/avatar-presenter", { avatarId: "avatar-host-male", script: "Hi." });
    expect(r.status).toBe(202);
    const job = await waitForTerminal(String(r.json?.["jobId"]));
    expect(job["status"]).toBe("failed");
    expect(String(job["error"])).toContain("character image");
    expect(state.charges).toEqual([]);
    expect(state.balance).toBe(5000);
  });
});
