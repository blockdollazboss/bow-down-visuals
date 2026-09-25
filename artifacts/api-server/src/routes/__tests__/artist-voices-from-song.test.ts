/**
 * Route-level hardening tests for POST /api/artist-vaults/:id/voice/from-song.
 *
 * Covers the 2026-09-25 OOM incident learnings:
 *  1. IVC eligibility pre-check rejects up front (402) without deducting
 *     credits or ever invoking Demucs.
 *  2. A failed pre-check fails OPEN: the request proceeds.
 *  3. A Demucs failure returns JSON (not an HTML error page) and refunds the
 *     deducted credits; the lighter model is passed through.
 *  4. A vault-lookup failure also returns JSON (vault lookup now lives
 *     inside the try/catch).
 *
 * Heavy modules (Demucs, Supabase, ElevenLabs, DB) are mocked; the real
 * Express router + multer run against a local ephemeral server.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const dbState = vi.hoisted(() => ({
  vaults: [] as any[],
  throwOnSelect: false,
}));

const sbState = vi.hoisted(() => ({
  updates: [] as any[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.userCredits = 10;
    req.log = { info: () => {}, error: () => {} };
    next();
  },
}));

vi.mock("../../lib/elevenlabs", () => ({
  canUseInstantVoiceCloning: vi.fn(),
}));

vi.mock("../../lib/stem-separation", () => ({
  separateVocalStems: vi.fn(),
  cleanupWorkdir: vi.fn(),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => {
    const chain: any = {};
    chain.from = vi.fn(() => chain);
    chain.select = vi.fn(() => chain);
    chain.update = vi.fn((vals: any) => {
      sbState.updates.push(vals);
      return chain;
    });
    chain.eq = vi.fn(() => chain);
    chain.single = vi.fn(() => Promise.resolve({ data: { credits: 10 }, error: null }));
    return chain;
  }),
  // refundCredits() restores via addCreditsToProfile — simulate the credit-back.
  addCreditsToProfile: vi.fn(async (_userId: string, amount: number) => {
    sbState.updates.push({ credits: 10 });
    return { oldCredits: 10 - amount, newCredits: 10, created: false };
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(),
  refreshSupabaseStorageUrl: vi.fn(),
  parseSupabaseStorageRefBucketed: vi.fn(),
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsage: vi.fn(() => Promise.resolve()),
  recordCreditUsageStrict: vi.fn(() => Promise.resolve()),
}));

vi.mock("@workspace/db", () => {
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.set = vi.fn(() => chain);
  chain.limit = vi.fn(() => {
    if (dbState.throwOnSelect) {
      return Promise.reject(Object.assign(new Error("db down"), { status: 503 }));
    }
    return Promise.resolve(dbState.vaults);
  });
  return {
    db: { select: vi.fn(() => chain), update: vi.fn(() => chain) },
    artistVaultsTable: { id: "id" },
    songsTable: { id: "id" },
  };
});

import router, { resolveFromSongTrimSeconds } from "../artist-voices";
import { canUseInstantVoiceCloning } from "../../lib/elevenlabs";
import { separateVocalStems } from "../../lib/stem-separation";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  dbState.vaults = [];
  dbState.throwOnSelect = false;
  sbState.updates = [];
  vi.mocked(canUseInstantVoiceCloning).mockResolvedValue(true);
  // Song-URL downloads are faked; everything else goes to the real fetch
  // (i.e. the ephemeral Express server under test).
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init: any) => {
      if (String(url).startsWith("https://example.com/")) {
        return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer } as any;
      }
      return realFetch(url, init);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function postFromSong(body: unknown) {
  const r = await realFetch(`${baseUrl}/artist-vaults/vault-1/voice/from-song`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any, contentType: r.headers.get("content-type") ?? "" };
}

describe("POST /api/artist-vaults/:id/voice/from-song hardening", () => {
  it("402s without deducting credits or running Demucs when IVC is not included", async () => {
    vi.mocked(canUseInstantVoiceCloning).mockResolvedValue(false);

    const { status, json } = await postFromSong({ songUrl: "https://example.com/s.mp3" });

    expect(status).toBe(402);
    expect(json.code).toBe("ivc_not_included");
    expect(json.error).toContain("instant voice cloning");
    expect(separateVocalStems).not.toHaveBeenCalled();
    expect(sbState.updates).toHaveLength(0);
  });

  it("fails open when the IVC check errors; a Demucs failure returns JSON and refunds", async () => {
    vi.mocked(canUseInstantVoiceCloning).mockRejectedValue(new Error("subscription check boom"));
    dbState.vaults = [{ id: "vault-1", artist_name: "Shark King", user_id: "user-1" }];
    vi.mocked(separateVocalStems).mockRejectedValue(new Error("Demucs exited with code 137"));

    const { status, json, contentType } = await postFromSong({ songUrl: "https://example.com/s.mp3" });

    // Fail-open: the request proceeded past the broken pre-check.
    expect(separateVocalStems).toHaveBeenCalled();
    // Lighter model + pre-Demucs trim window + vocal strategy + IVC
    // post-processing passed through to the isolation step.
    expect(separateVocalStems).toHaveBeenCalledWith(expect.any(Buffer), {
      model: "htdemucs",
      trimSeconds: 90,
      windowStrategy: "vocal",
      postProcessVocals: true,
    });
    // JSON error body (never an HTML error page), credits refunded.
    expect(status).toBe(500);
    expect(contentType).toContain("application/json");
    expect(json.error).toContain("137");
    expect(sbState.updates).toHaveLength(2);
    expect(sbState.updates[0]).toEqual({ credits: 8 }); // deducted
    expect(sbState.updates[1]).toEqual({ credits: 10 }); // refunded
  });

  it("returns JSON (not HTML) when the vault lookup fails", async () => {
    dbState.throwOnSelect = true;

    const { status, json, contentType } = await postFromSong({ songUrl: "https://example.com/s.mp3" });

    expect(status).toBe(503);
    expect(contentType).toContain("application/json");
    expect(json.error).toBe("db down");
    expect(sbState.updates).toHaveLength(0);
  });
});

describe("resolveFromSongTrimSeconds (FROM_SONG_TRIM_SECONDS env)", () => {
  it("defaults to 90 seconds when unset", () => {
    expect(resolveFromSongTrimSeconds({})).toBe(90);
  });

  it("respects the env override", () => {
    expect(resolveFromSongTrimSeconds({ FROM_SONG_TRIM_SECONDS: "45" })).toBe(45);
    expect(resolveFromSongTrimSeconds({ FROM_SONG_TRIM_SECONDS: "120" })).toBe(120);
  });

  it("falls back to 90 on missing/invalid values (never silently disables the trim)", () => {
    expect(resolveFromSongTrimSeconds({ FROM_SONG_TRIM_SECONDS: "0" })).toBe(90);
    expect(resolveFromSongTrimSeconds({ FROM_SONG_TRIM_SECONDS: "-5" })).toBe(90);
    expect(resolveFromSongTrimSeconds({ FROM_SONG_TRIM_SECONDS: "abc" })).toBe(90);
  });
});
