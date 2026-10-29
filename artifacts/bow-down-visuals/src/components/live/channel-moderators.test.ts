/**
 * ChannelModerators — the honest no-profile state (source pins, the
 * repo's established style for these panels).
 *
 * THE DEFECT (live, Oct 28 2026, stack600 settle walk): on /go-live
 * the panel showed "Moderators couldn't load." + Try again for the
 * owner. The endpoint is deliberate: GET /api/live/moderators
 * answers a signed-in user with NO creator profile with
 * 400 { code: "NO_PROFILE" } (pinned at the API layer in
 * live-moderators.test.ts) — moderators belong to a channel, and a
 * channel doesn't exist yet. The client treated EVERY non-200 as a
 * transient load failure, so a profile-less creator got a permanent
 * fake error and a Try again that could never succeed.
 *
 * The contract pinned here: the NO_PROFILE answer renders the
 * honest create-a-profile state (the server's own words for it);
 * every other failure keeps the error + Try again state; the ready
 * state's real empty state is untouched.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("./ChannelModerators.tsx", import.meta.url), "utf8");

describe("ChannelModerators — NO_PROFILE is a state, not an error", () => {
  it("branches on the server's NO_PROFILE code before calling anything a load failure", () => {
    expect(panel).toContain('json?.code === "NO_PROFILE"');
    expect(panel).toContain('setLoad("noprofile")');
    const branchAt = panel.indexOf('json?.code === "NO_PROFILE"');
    const throwAt = panel.indexOf('throw new Error("load failed")', branchAt);
    expect(branchAt).toBeGreaterThan(-1);
    expect(throwAt).toBeGreaterThan(branchAt);
  });

  it("renders the honest create-a-profile state, in the server's own words, with no futile retry", () => {
    expect(panel).toContain('data-testid="moderators-no-profile"');
    expect(panel).toContain("Create your creator profile first — moderators belong to your channel.");
    const blockAt = panel.indexOf('data-testid="moderators-no-profile"');
    const blockEnd = panel.indexOf('{load === "ready"', blockAt);
    expect(blockAt).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockAt);
    expect(panel.slice(blockAt, blockEnd)).not.toContain("Try again");
  });

  it("keeps the real error state for every other failure", () => {
    expect(panel).toContain('data-testid="moderators-error"');
    expect(panel).toContain("Moderators couldn&rsquo;t load.");
  });

  it("keeps the ready state's own empty state for a creator with no mods yet", () => {
    expect(panel).toContain('data-testid="moderators-empty"');
    expect(panel).toContain("No moderators yet — appoint someone from your community below.");
  });
});
