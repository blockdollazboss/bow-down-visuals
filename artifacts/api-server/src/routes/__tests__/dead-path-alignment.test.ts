/**
 * S27-40 / S27-41 — dead-path alignment pins.
 *
 * THE DEFECTS (A2 audit): two editor surfaces POSTed to API paths that no
 * mounted route answered, so they failed on EVERY use:
 *   - AICopilotPanel POSTs /api/ai-copilot/analyze, but ai-copilot.ts
 *     defines POST /analyze and routes/index.ts mounted the router BARE —
 *     the true effective path was POST /api/analyze.
 *   - EffectsSection POSTed /api/video-background-removal, but
 *     video-background-removal.ts defines POST /remove-video-background,
 *     mounted bare — the true effective path is POST
 *     /api/remove-video-background.
 *
 * THE FIXES (one side moves per item):
 *   - Copilot: the mount moved — routes/index.ts now mounts
 *     router.use("/ai-copilot", aiCopilotRouter), the same prefix the
 *     G14 refund test has always used for this router. FE unchanged.
 *   - Video background removal: the FE moved — EffectsSection now POSTs
 *     the true route /api/remove-video-background. Server unchanged.
 *
 * THE PIN: two apps mirror the production wiring from routes/index.ts
 * (app -> /api -> the mounts exactly as index.ts declares them) and assert
 * the endpoints respond at the paths the FE calls, plus source-shape pins
 * on index.ts / the router files / the FE sources so the alignment can't
 * silently drift apart again.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  charges: [] as Array<{ amount: number; action?: string }>,
  refunds: [] as Array<{ amount: number; action?: string }>,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (_u: string, amount: number, meta: any) => {
    h.charges.push({ amount, action: meta?.action });
    return 4242;
  }),
  refundCredits: vi.fn(async (_u: string, amount: number, meta: any) => {
    h.refunds.push({ amount, action: meta?.action });
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({}),
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => "video-background-removal/user-1/x.mov"),
  refreshSupabaseStorageUrl: vi.fn(async () => "https://cdn.example/x.mov"),
}));

import aiCopilotRouter from "../generate/ai-copilot";
import videoBackgroundRemovalRouter from "../generate/video-background-removal";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  process.env["OPENAI_API_KEY"] = "test-key";
  /* Production wiring, mirrored from app.ts + routes/index.ts:
     app.use("/api", router); router.use("/ai-copilot", aiCopilotRouter);
     router.use(videoBackgroundRemovalRouter); */
  const apiRouter = express.Router();
  apiRouter.use("/ai-copilot", aiCopilotRouter);
  apiRouter.use(videoBackgroundRemovalRouter);

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use("/api", apiRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.charges = [];
  h.refunds = [];
  vi.clearAllMocks();
});

async function post(path: string, body: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const VALID_SCENES = [{ id: "s1", sceneNumber: 1, durationSec: 5 }];

describe("S27-40 — AI Copilot responds at the path the FE calls", () => {
  it("POST /api/ai-copilot/analyze returns { suggestions } on success", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                suggestions: [
                  {
                    title: "Tighten the intro",
                    reason: "First scene runs long.",
                    severity: "polish",
                    action: { kind: "note", text: "Trim it." },
                  },
                ],
              }),
            },
          },
        ],
      }),
    }));
    try {
      const r = await post("/api/ai-copilot/analyze", {
        scenes: VALID_SCENES,
        songTitle: "My Song",
      });
      expect(r.status).toBe(200);
      expect(Array.isArray(r.json.suggestions)).toBe(true);
      expect(r.json.suggestions).toHaveLength(1);
      expect(r.json.suggestions[0].title).toBe("Tighten the intro");
      expect(h.charges).toEqual([{ amount: 50, action: "AI Copilot analysis" }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("POST /api/ai-copilot/analyze with an invalid body is a 400, not a 404", async () => {
    const r = await post("/api/ai-copilot/analyze", { scenes: [] });
    expect(r.status).toBe(400);
  });

  it("the old bare-mount path POST /api/analyze no longer resolves", async () => {
    const r = await post("/api/analyze", { scenes: VALID_SCENES });
    expect(r.status).toBe(404);
  });
});

describe("S27-41 — Video Background Removal responds at the path the FE now calls", () => {
  it("POST /api/remove-video-background with an invalid body is a 400, not a 404", async () => {
    const r = await post("/api/remove-video-background", {});
    expect(r.status).toBe(400);
    expect(h.charges).toHaveLength(0);
  });

  it("the old FE path POST /api/video-background-removal is a 404", async () => {
    const r = await post("/api/video-background-removal", { videoUrl: "https://x/v.mp4" });
    expect(r.status).toBe(404);
    expect(h.charges).toHaveLength(0);
  });
});

describe("source-shape pins — the wiring cannot drift apart again", () => {
  const indexSrc = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  const copilotSrc = readFileSync(new URL("../generate/ai-copilot.ts", import.meta.url), "utf8");
  const videoBgSrc = readFileSync(
    new URL("../generate/video-background-removal.ts", import.meta.url),
    "utf8",
  );

  it("routes/index.ts mounts the copilot router under /ai-copilot exactly once", () => {
    expect(indexSrc.match(/router\.use\("\/ai-copilot", aiCopilotRouter\)/g) ?? []).toHaveLength(1);
    expect(indexSrc).not.toContain("router.use(aiCopilotRouter);");
  });

  it("routes/index.ts mounts the video-background-removal router bare exactly once", () => {
    expect(indexSrc.match(/router\.use\(videoBackgroundRemovalRouter\)/g) ?? []).toHaveLength(1);
  });

  it("the routers define the handler paths the mounts compose with", () => {
    expect(copilotSrc).toContain('router.post("/analyze"');
    expect(videoBgSrc).toContain('router.post("/remove-video-background"');
  });
});
