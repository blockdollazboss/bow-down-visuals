import { describe, it, expect } from "vitest";
import { replayStateFor } from "./live-replay";

/* W4: the watch page may only say "no recording was saved" when the
   outcome is actually known. These pin the state machine the page
   renders from, one case per truth the DTO can tell. */
describe("replayStateFor", () => {
  it("a replay URL is available, whatever else the facts say", () => {
    expect(
      replayStateFor({ vod_url: "https://cdn.example/v.mp4", provider: "own-server", destinations: [] }),
    ).toEqual({ kind: "available", url: "https://cdn.example/v.mp4" });
  });

  it("a recorded not_saved outcome is the only 'none'", () => {
    expect(
      replayStateFor({
        vod_url: null,
        provider: "own-server",
        destinations: [{ platform: "site", vod_state: "not_saved" }],
      }),
    ).toEqual({ kind: "none" });
    expect(
      replayStateFor({
        vod_url: null,
        provider: "cloudflare-stream",
        destinations: [{ platform: "site", vod_state: "not_saved" }],
      }),
    ).toEqual({ kind: "none" });
  });

  it("an own-server stream with no outcome yet is still saving — never 'none'", () => {
    expect(
      replayStateFor({
        vod_url: null,
        provider: "own-server",
        destinations: [{ platform: "site", vod_state: null }],
      }),
    ).toEqual({ kind: "saving" });
    // Destinations missing entirely (older payloads) — same truth.
    expect(replayStateFor({ vod_url: null, provider: "own-server", destinations: null })).toEqual({
      kind: "saving",
    });
    expect(replayStateFor({ vod_url: null, provider: "own-server" })).toEqual({ kind: "saving" });
  });

  it("a provider stream with no recording yet is pending — it may still arrive from the studio", () => {
    expect(
      replayStateFor({
        vod_url: null,
        provider: "cloudflare-stream",
        destinations: [{ platform: "site", vod_state: null }],
      }),
    ).toEqual({ kind: "pending" });
    // Unknown/absent provider never claims the server is saving.
    expect(replayStateFor({ vod_url: null, provider: null, destinations: [] })).toEqual({
      kind: "pending",
    });
  });

  it("a non-site destination's outcome never decides the state", () => {
    expect(
      replayStateFor({
        vod_url: null,
        provider: "own-server",
        destinations: [{ platform: "youtube", vod_state: "not_saved" }],
      }),
    ).toEqual({ kind: "saving" });
  });
});
