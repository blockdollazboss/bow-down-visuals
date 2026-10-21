/**
 * Veo 3.1 end frame — submitVeoVideo must place a `lastFrame` instance
 * next to the first-frame `image` (first/last-frame interpolation), and
 * must NEVER send a lone last frame (Veo rejects last-frame-only jobs).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { submitVeoVideo } from "../veo-client";

const bodies: any[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  bodies.length = 0;
  process.env["GEMINI_API_KEY"] = "test-gemini-key";
  globalThis.fetch = (async (_url: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => ({ name: "operations/test-op" }),
      text: async () => "",
    } as any;
  }) as any;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("submitVeoVideo end frame", () => {
  it("sends lastFrame alongside the first-frame image", async () => {
    const op = await submitVeoVideo({
      prompt: "dolly in on the performer",
      aspectRatio: "9:16",
      imageBase64: "FIRST_FRAME_B64",
      imageMimeType: "image/png",
      lastFrameBase64: "LAST_FRAME_B64",
      lastFrameMimeType: "image/jpeg",
    });
    expect(op).toBe("operations/test-op");
    const instance = bodies[0].instances[0];
    expect(instance.image).toEqual({ inlineData: { mimeType: "image/png", data: "FIRST_FRAME_B64" } });
    expect(instance.lastFrame).toEqual({ inlineData: { mimeType: "image/jpeg", data: "LAST_FRAME_B64" } });
  });

  it("never sends a lone last frame", async () => {
    await submitVeoVideo({
      prompt: "text only scene",
      aspectRatio: "16:9",
      lastFrameBase64: "LAST_FRAME_B64",
    });
    const instance = bodies[0].instances[0];
    expect(instance).not.toHaveProperty("image");
    expect(instance).not.toHaveProperty("lastFrame");
  });

  it("first frame without an end frame carries no lastFrame key", async () => {
    await submitVeoVideo({
      prompt: "image to video",
      aspectRatio: "9:16",
      imageBase64: "FIRST_FRAME_B64",
    });
    const instance = bodies[0].instances[0];
    expect(instance.image).toEqual({ inlineData: { mimeType: "image/jpeg", data: "FIRST_FRAME_B64" } });
    expect(instance).not.toHaveProperty("lastFrame");
  });
});
