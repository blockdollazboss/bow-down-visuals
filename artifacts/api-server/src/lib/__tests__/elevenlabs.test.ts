import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { canUseInstantVoiceCloning } from "../elevenlabs";

describe("canUseInstantVoiceCloning", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockSubscription(body: unknown, ok = true) {
    vi.mocked(fetch).mockResolvedValue({ ok, json: async () => body } as any);
  }

  it("returns false when the subscription explicitly disallows IVC", async () => {
    mockSubscription({ can_use_instant_voice_cloning: false });
    expect(await canUseInstantVoiceCloning("key-123")).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/user/subscription",
      expect.objectContaining({
        headers: { "xi-api-key": "key-123" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns true when the subscription allows IVC", async () => {
    mockSubscription({ can_use_instant_voice_cloning: true });
    expect(await canUseInstantVoiceCloning("key-123")).toBe(true);
  });

  it("fails open when the field is missing", async () => {
    mockSubscription({ tier: "starter" });
    expect(await canUseInstantVoiceCloning("key-123")).toBe(true);
  });

  it("fails open on non-200 responses", async () => {
    mockSubscription({ detail: "boom" }, false);
    expect(await canUseInstantVoiceCloning("key-123")).toBe(true);
  });

  it("fails open on network errors", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("socket hang up"));
    expect(await canUseInstantVoiceCloning("key-123")).toBe(true);
  });
});
