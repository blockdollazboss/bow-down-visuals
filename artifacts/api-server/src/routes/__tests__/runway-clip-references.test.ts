/**
 * Route-level tests for multi-reference scene generation
 * (POST /api/generate-runway-clip).
 *
 * Pins the provider-facing contract:
 *  - Seedance 2.5 receives the scene's reference SET as an array of
 *    unpositioned {uri} reference images (roles in priority order).
 *  - Gen-4.5 receives exactly ONE image — the highest-priority set
 *    member (character) — and the response reports the reduction with a
 *    plain-language note (never a silent drop).
 *  - With no set, the legacy single-photo submission is byte-identical.
 *  - In pack mode the LOCKED pack's reference set wins and a client-sent
 *    set is ignored; legacy packs' locked plates ride as product refs.
 *
 * The Runway SDK, credits, storage, and pack loader are mocked; the real
 * Express router + real clip-references planner run.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => ({
  imageToVideoCalls: [] as any[],
  textToVideoCalls: [] as any[],
  taskSeq: 0,
  lockedPack: null as any,
}));

vi.mock("@runwayml/sdk", () => ({
  default: class {
    imageToVideo = {
      create: vi.fn(async (args: any) => {
        state.imageToVideoCalls.push(args);
        return { id: `task-${++state.taskSeq}` };
      }),
    };
    textToVideo = {
      create: vi.fn(async (args: any) => {
        state.textToVideoCalls.push(args);
        return { id: `task-${++state.taskSeq}` };
      }),
    };
    tasks = { retrieve: vi.fn(async () => ({ status: "RUNNING" })) };
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = (req.headers["x-test-user"] as string) || "user-1";
    req.userCredits = 100_000;
    req.log = { info: () => {}, warn: () => {}, error: () => {} };
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  generationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/rail-core", () => ({
  invokeRailHandler: vi.fn(async () => ({ status: 200, body: {} })),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => "supabase://generated-clips/x.jpg"),
  uploadFileStreamToSupabaseStorage: vi.fn(async () => "supabase://generated-clips/x.mp4"),
  SUPABASE_CLIPS_BUCKET: "generated-clips",
  refreshSupabaseStorageUrl: vi.fn(async (ref: string) =>
    ref.startsWith("http") ? ref : `https://signed.example/${ref}`,
  ),
  parseSupabaseStorageRef: vi.fn(() => null),
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 99_000),
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/clip-charge-obligations", () => ({
  recordClipCharge: vi.fn(async () => {}),
}));

vi.mock("../../lib/veo-client", () => ({
  submitVeoVideo: vi.fn(async () => "operations/test"),
  pollVeoOperation: vi.fn(async () => ({ done: false })),
  downloadVeoVideoToFile: vi.fn(async () => {}),
}));

vi.mock("../../routes/generate/pre-production", () => ({
  getLockedPack: vi.fn(async () => {
    if (!state.lockedPack) throw Object.assign(new Error("not found"), { status: 404 });
    return state.lockedPack;
  }),
}));

import runwayClipRouter from "../generate/runway-clip";

const CHAR = "https://img.example/character.jpg";
const LOC = "https://img.example/location.jpg";
const PROD = "https://img.example/product.jpg";
const STYLE = "https://img.example/style.jpg";

const fullSet = [
  { role: "character", url: CHAR, label: "Lead — Artist Vault photo", source: "artist_vault" },
  { role: "location", url: LOC, label: "Throne Room", source: "location_library" },
  { role: "product", url: PROD, label: "Gold Crown", source: "pack_prop" },
  { role: "style", url: STYLE, label: "Brand kit logo", source: "brand_kit" },
];

let server: any;
let baseUrl: string;

beforeAll(async () => {
  process.env["RUNWAYML_API_SECRET"] = "test-secret";
  const app = express();
  app.use(express.json());
  app.use("/api", runwayClipRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  state.imageToVideoCalls = [];
  state.textToVideoCalls = [];
  state.lockedPack = null;
});

async function submit(body: unknown) {
  const res = await fetch(`${baseUrl}/api/generate-runway-clip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": "user-1" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("POST /generate-runway-clip — reference sets", () => {
  it("Seedance receives the full set as unpositioned reference images in priority order", async () => {
    const { status, json } = await submit({
      promptText: "The king performs in the throne room",
      model: "seedance2_5",
      durationSec: 5,
      referenceSet: [...fullSet].reverse(),
    });
    expect(status).toBe(200);
    expect(state.textToVideoCalls).toHaveLength(0);
    expect(state.imageToVideoCalls).toHaveLength(1);
    const args = state.imageToVideoCalls[0];
    expect(args.model).toBe("seedance2_5");
    expect(args.promptImage).toEqual([{ uri: CHAR }, { uri: LOC }, { uri: PROD }, { uri: STYLE }]);
    expect(json.references).toEqual({
      mode: "reference_images",
      submitted: 4,
      inSet: 4,
      reduced: false,
      note: null,
    });
  });

  it("Gen-4.5 receives the priority (character) reference only, with the reduction reported", async () => {
    const { status, json } = await submit({
      promptText: "The king performs",
      model: "gen4.5",
      referenceSet: fullSet,
    });
    expect(status).toBe(200);
    const args = state.imageToVideoCalls[0];
    expect(args.model).toBe("gen4.5");
    expect(args.promptImage).toBe(CHAR);
    expect(json.references.mode).toBe("single");
    expect(json.references.submitted).toBe(1);
    expect(json.references.inSet).toBe(4);
    expect(json.references.reduced).toBe(true);
    expect(json.references.note).toMatch(/1 of your 4 references/);
  });

  it("with no set, the legacy single vault photo submission is unchanged", async () => {
    const { status, json } = await submit({
      promptText: "The king performs",
      model: "gen4.5",
      referenceImageUrl: CHAR,
    });
    expect(status).toBe(200);
    expect(state.imageToVideoCalls[0].promptImage).toBe(CHAR);
    expect(json.referenceSource).toBe("vault_photo");
    expect(json.references).toEqual({
      mode: "single",
      submitted: 1,
      inSet: 0,
      reduced: false,
      note: null,
    });
  });

  it("with no set and no photo, generation stays text-to-video", async () => {
    const { status, json } = await submit({ promptText: "A city flyover", model: "gen4.5" });
    expect(status).toBe(200);
    expect(state.imageToVideoCalls).toHaveLength(0);
    expect(state.textToVideoCalls).toHaveLength(1);
    expect(json.references.mode).toBe("none");
  });

  it("pack mode: the LOCKED pack's set is submitted and the client's set is ignored", async () => {
    state.lockedPack = {
      status: "locked",
      ingredients: [
        {
          shotNumber: 1,
          prompt: "Locked pack prompt for shot one",
          negativePrompt: "",
          referenceAssetUrls: [],
          referenceSet: fullSet,
          continuityNotes: "",
          model: "seedance2_5",
          durationSec: 5,
          ratio: "720:1280",
        },
      ],
    };
    const { status, json } = await submit({
      promptText: "Client prompt that must be ignored",
      packId: "pack-1",
      shotNumber: 1,
      referenceSet: [
        { role: "character", url: "https://img.example/attacker-pick.jpg", label: "Nope", source: "upload" },
      ],
    });
    expect(status).toBe(200);
    const args = state.imageToVideoCalls[0];
    expect(args.model).toBe("seedance2_5");
    expect(args.promptImage).toEqual([{ uri: CHAR }, { uri: LOC }, { uri: PROD }, { uri: STYLE }]);
    expect(JSON.stringify(args)).not.toMatch(/attacker-pick/);
    expect(json.references.inSet).toBe(4);
  });

  it("pack mode: a legacy pack's locked plates ride as product references", async () => {
    state.lockedPack = {
      status: "locked",
      ingredients: [
        {
          shotNumber: 2,
          prompt: "Locked prompt",
          negativePrompt: "",
          referenceAssetUrls: [PROD, STYLE],
          continuityNotes: "",
          model: "gen4.5",
          durationSec: 5,
          ratio: "720:1280",
        },
      ],
    };
    const { status, json } = await submit({ packId: "pack-2", shotNumber: 2 });
    expect(status).toBe(200);
    const args = state.imageToVideoCalls[0];
    expect(args.model).toBe("gen4.5");
    /* Gen-4.5 takes one: the first locked plate, with the reduction stated. */
    expect(args.promptImage).toBe(PROD);
    expect(json.references.inSet).toBe(2);
    expect(json.references.reduced).toBe(true);
  });
});
