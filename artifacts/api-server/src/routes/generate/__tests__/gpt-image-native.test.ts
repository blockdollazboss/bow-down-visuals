/**
 * Tests for the GPT Image-native conversion of the seven ex-DALL·E routes
 * (script-to-video, thumbnail-ab, thumb-bg, chapter-art, storyboard,
 * social-kit, promo-cards).
 *
 * Before the conversion these helpers POSTed dall-e-era request shapes
 * (quality: "standard", 1792x1024 / 1024x1792 sizes) and expected a hosted
 * `url` in the response — all broken against the GPT Image family, which
 * takes quality low/medium/high, generates at 1024x1024 / 1536x1024 /
 * 1024x1536, and always returns base64 (b64_json). These tests pin the new
 * provider-call shape (SDK via getOpenAI, mirroring cover-art /
 * thumbnail-generator) and the b64 → file write path for every helper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(),
  refreshSupabaseStorageUrl: vi.fn(),
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "gpt-6-sol"),
}));

import { getOpenAI } from "../../../lib/ai-clients";
import { generateImage as scriptToVideoImage } from "../script-to-video";
import { generateImage as thumbnailAbImage } from "../thumbnail-ab";
import { generateImage as thumbBgImage } from "../thumb-bg";
import { generateImage as chapterArtImage } from "../chapter-art";
import { generateShotImage as storyboardImage } from "../storyboard";
import { generateImage as socialKitImage } from "../social-kit";
import { generateImage as promoCardsImage } from "../promo-cards";

const PNG_BYTES = Buffer.from("fake-png-bytes-for-gpt-image-test");
const PNG_B64 = PNG_BYTES.toString("base64");

const mockGenerate = vi.fn();
const mockGetOpenAI = vi.mocked(getOpenAI);
const mockFetch = vi.fn(() => {
  throw new Error("fetch must not be used for image generation");
});

let workDir: string;
let outPath: string;

beforeEach(async () => {
  vi.clearAllMocks();
  delete process.env.OPENAI_IMAGE_MODEL;
  mockGetOpenAI.mockReturnValue({
    images: { generate: mockGenerate },
  } as unknown as ReturnType<typeof getOpenAI>);
  vi.stubGlobal("fetch", mockFetch);
  workDir = await mkdtemp(join(tmpdir(), "gpt-image-native-"));
  outPath = join(workDir, "out.png");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_IMAGE_MODEL;
  await rm(workDir, { recursive: true, force: true });
});

interface FixedSizeCase {
  name: string;
  fn: (prompt: string, outputPath: string) => Promise<void>;
  size: string;
  failMessage: string;
}

const fixedSizeCases: FixedSizeCase[] = [
  { name: "script-to-video", fn: scriptToVideoImage, size: "1536x1024", failMessage: "Image generation failed." },
  { name: "thumbnail-ab", fn: thumbnailAbImage, size: "1536x1024", failMessage: "Image generation failed." },
  { name: "thumb-bg", fn: thumbBgImage, size: "1536x1024", failMessage: "Image generation failed." },
  { name: "chapter-art", fn: chapterArtImage, size: "1024x1024", failMessage: "Image generation failed." },
  { name: "storyboard", fn: storyboardImage, size: "1536x1024", failMessage: "Storyboard frame generation failed." },
];

describe.each(fixedSizeCases)("$name image helper", ({ fn, size, failMessage }) => {
  it("calls the GPT Image model via the SDK with a native request shape", async () => {
    mockGenerate.mockResolvedValue({ data: [{ b64_json: PNG_B64 }] });

    await fn("a golden shark on a throne", outPath);

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const [params, options] = mockGenerate.mock.calls[0] as [
      Record<string, unknown>,
      { signal?: unknown } | undefined,
    ];
    expect(params).toMatchObject({
      model: "gpt-image-2.5-sunburst",
      prompt: "a golden shark on a throne",
      size,
      quality: "high",
    });
    // No dall-e-era leftovers: no "standard" quality, no response_format,
    // and the request keeps its 180s abort signal.
    expect(params).not.toHaveProperty("response_format");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("writes the decoded b64_json bytes to the output path", async () => {
    mockGenerate.mockResolvedValue({ data: [{ b64_json: PNG_B64 }] });

    await fn("prompt", outPath);

    expect(await readFile(outPath)).toEqual(PNG_BYTES);
  });

  it("maps provider failures to the route's own error message", async () => {
    mockGenerate.mockRejectedValue(new Error("provider boom"));

    await expect(fn("prompt", outPath)).rejects.toThrow(failMessage);
  });

  it("fails when the response carries no image data", async () => {
    mockGenerate.mockResolvedValue({ data: [] });

    await expect(fn("prompt", outPath)).rejects.toThrow("No image data returned.");
    await expect(readFile(outPath)).rejects.toThrow();
  });
});

describe.each([
  { name: "social-kit", fn: socialKitImage },
  { name: "promo-cards", fn: promoCardsImage },
])("$name image helper (caller-sized)", ({ fn }) => {
  it("passes the caller's size through with quality high and writes b64 bytes", async () => {
    mockGenerate.mockResolvedValue({ data: [{ b64_json: PNG_B64 }] });

    await fn("a promo background", "1024x1536", outPath);

    const [params] = mockGenerate.mock.calls[0] as [Record<string, unknown>];
    expect(params).toMatchObject({
      model: "gpt-image-2.5-sunburst",
      prompt: "a promo background",
      size: "1024x1536",
      quality: "high",
    });
    expect(await readFile(outPath)).toEqual(PNG_BYTES);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("maps provider failures to the route's own error message", async () => {
    mockGenerate.mockRejectedValue(new Error("provider boom"));

    await expect(fn("prompt", "1536x1024", outPath)).rejects.toThrow(
      "Image generation failed.",
    );
  });
});

describe("model selection", () => {
  it("honors the OPENAI_IMAGE_MODEL env override", async () => {
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-2.5-flare";
    mockGenerate.mockResolvedValue({ data: [{ b64_json: PNG_B64 }] });

    await thumbnailAbImage("prompt", outPath);

    const [params] = mockGenerate.mock.calls[0] as [Record<string, unknown>];
    expect(params.model).toBe("gpt-image-2.5-flare");
  });
});
