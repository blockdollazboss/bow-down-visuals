/**
 * #29 AI alt-text (Stack-100 #3): the generation route + shared lib.
 *  - POST /api/generate/alt-text is FREE (creditsCharged: 0, no credits
 *    module involved at all) and rides the stack's OpenAI seam.
 *  - The system prompt carries the hard rule: describe the scene, NEVER
 *    identify or name a person.
 *  - Model wrappers (labels/quotes) are stripped; output is sanitized
 *    and capped at 400 chars.
 *  - Failures are honest JSON errors (400/502/503) — a publish door is
 *    never blocked; the client keeps its hand-written field.
 *  - sanitizeAttachmentAlts keeps a good alt inside post JSONB, drops
 *    empty ones, and leaves every other attachment field untouched.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const ai = vi.hoisted(() => ({
  mode: "ok" as "ok" | "empty" | "down" | "quoted",
  lastRequest: null as unknown,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = "user-1";
    next();
  },
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-vision-model",
  getOpenAI: () => {
    if (ai.mode === "down") {
      throw new Error("OPENAI_API_KEY is not configured — this AI feature is unavailable.");
    }
    return {
      chat: {
        completions: {
          create: async (req: unknown) => {
            ai.lastRequest = req;
            const content =
              ai.mode === "empty"
                ? ""
                : ai.mode === "quoted"
                  ? '"Alt text: A performer in a gold jacket on a dark stage."'
                  : "A performer in a gold jacket on a dark stage, red spotlights, crowd silhouettes below.";
            return { choices: [{ message: { content } }] };
          },
        },
      },
    };
  },
}));

import altTextRouter from "../generate/alt-text";
import {
  ALT_TEXT_MAX_CHARS,
  ALT_TEXT_SYSTEM_PROMPT,
  sanitizeAltText,
  parseAltTextResponse,
  sanitizeAttachmentAlts,
  sanitizeAltTextList,
} from "../../lib/alt-text";

/* 1x1 transparent PNG — a real image ffmpeg can decode + downscale. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_DATA_URL = `data:image/png;base64,${PNG_1PX.toString("base64")}`;

let base = "";
let server: ReturnType<express.Express["listen"]>;
let imageServer: ReturnType<typeof createServer>;
let imageUrl = "";

beforeAll(async () => {
  process.env["TMPDIR"] = process.env["TMPDIR"] || "/tmp";
  imageServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(PNG_1PX);
  });
  await new Promise<void>((r) => imageServer.listen(0, () => r()));
  imageUrl = `http://127.0.0.1:${(imageServer.address() as AddressInfo).port}/cover.png`;

  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use(altTextRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => imageServer.close(r));
});
beforeEach(() => { ai.mode = "ok"; ai.lastRequest = null; });

async function post(path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

describe("POST /generate/alt-text", () => {
  it("describes an image by URL — free, sanitized, suggestion only", async () => {
    const r = await post("/generate/alt-text", { imageUrl });
    expect(r.status).toBe(200);
    expect(r.json?.["ok"]).toBe(true);
    expect(r.json?.["altText"]).toContain("gold jacket");
    expect(r.json?.["creditsCharged"]).toBe(0);
  });

  it("describes an image sent as a data URL (not uploaded yet)", async () => {
    const r = await post("/generate/alt-text", { imageDataUrl: PNG_DATA_URL });
    expect(r.status).toBe(200);
    expect(r.json?.["altText"]).toContain("gold jacket");
  });

  it("sends the vision request with the never-identify-a-person rule", async () => {
    await post("/generate/alt-text", { imageUrl, context: "cover for my single" });
    const req = ai.lastRequest as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(req.model).toBe("test-vision-model");
    const system = req.messages.find((m) => m.role === "system");
    expect(String(system?.content)).toBe(ALT_TEXT_SYSTEM_PROMPT);
    expect(String(system?.content)).toContain("NEVER identify or name any person");
    const user = req.messages.find((m) => m.role === "user");
    const parts = user?.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.some((p) => p.type === "image_url" && p.image_url?.url.startsWith("data:image/jpeg"))).toBe(true);
  });

  it("strips model wrappers (label + quotes) from the suggestion", async () => {
    ai.mode = "quoted";
    const r = await post("/generate/alt-text", { imageUrl });
    expect(r.status).toBe(200);
    expect(r.json?.["altText"]).toBe("A performer in a gold jacket on a dark stage.");
  });

  it("rejects both/neither image inputs and non-http URLs with 400", async () => {
    expect((await post("/generate/alt-text", {})).status).toBe(400);
    expect((await post("/generate/alt-text", { imageUrl, imageDataUrl: PNG_DATA_URL })).status).toBe(400);
    expect((await post("/generate/alt-text", { imageUrl: "ftp://example.com/x.png" })).status).toBe(400);
  });

  it("provider down (no key) → 503 alt_text_unavailable, never a crash", async () => {
    ai.mode = "down";
    const r = await post("/generate/alt-text", { imageUrl });
    expect(r.status).toBe(503);
    expect(r.json?.["error"]).toBe("alt_text_unavailable");
  });

  it("empty model reply → 502 alt_text_failed", async () => {
    ai.mode = "empty";
    const r = await post("/generate/alt-text", { imageUrl });
    expect(r.status).toBe(502);
    expect(r.json?.["error"]).toBe("alt_text_failed");
  });
});

describe("lib/alt-text sanitizers", () => {
  it("sanitizeAltText flattens whitespace/control chars and caps length", () => {
    expect(sanitizeAltText("  a\n b\t\tc  ")).toBe("a b c");
    expect(sanitizeAltText("x".repeat(900))).toHaveLength(ALT_TEXT_MAX_CHARS);
    expect(sanitizeAltText(42)).toBe("");
    expect(sanitizeAltText(null)).toBe("");
  });

  it("parseAltTextResponse strips labels and wrapping quotes", () => {
    expect(parseAltTextResponse("Alt text: A red stage.")).toBe("A red stage.");
    expect(parseAltTextResponse('"A red stage."')).toBe("A red stage.");
    expect(parseAltTextResponse("")).toBe("");
    expect(parseAltTextResponse(undefined)).toBe("");
  });

  it("sanitizeAttachmentAlts keeps good alts, drops empty ones, touches nothing else", () => {
    const out = sanitizeAttachmentAlts([
      { kind: "image", url: "https://x/a.png", alt: "  A gold stage.\n" },
      { kind: "video", url: "https://x/v.mp4", alt: "   " },
      { kind: "product", id: "p1", kindSlug: "merch", title: "Tee" },
    ]);
    expect(out[0]).toEqual({ kind: "image", url: "https://x/a.png", alt: "A gold stage." });
    expect(out[1]).toEqual({ kind: "video", url: "https://x/v.mp4" });
    expect(out[2]).toEqual({ kind: "product", id: "p1", kindSlug: "merch", title: "Tee" });
  });

  it("sanitizeAltTextList sanitizes, caps and trims trailing empties", () => {
    expect(sanitizeAltTextList([" one ", "", "three", ""])).toEqual(["one", "", "three"]);
    expect(sanitizeAltTextList("nope")).toEqual([]);
    expect(sanitizeAltTextList([42, null])).toEqual([]);
  });
});
