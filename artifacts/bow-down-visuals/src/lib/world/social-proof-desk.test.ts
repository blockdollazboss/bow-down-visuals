/**
 * social-proof-desk — stack1500 world parity wave #3 item 32
 * pins. The Social Proof desk is the settings card's native
 * form. These pins hold: the refresh rail is FREE in the
 * registry (cost 0 — no confirmation exists because nothing is
 * charged); the state guard accepts only the rail's real state
 * shape and drops malformed figures rather than dressing them
 * up; the toggle computation is the settings card's own
 * (show removes the key, hide adds it, deduped); the visibility
 * payload is exactly { hiddenKeys }.
 */
import { describe, expect, it } from "vitest";
import {
  SOCIAL_PROOF_ME_PATH,
  SOCIAL_PROOF_REFRESH_COST,
  SOCIAL_PROOF_REFRESH_PATH,
  SOCIAL_PROOF_VISIBILITY_PATH,
  buildVisibilityPayload,
  hiddenKeysAfterToggle,
  platformLabel,
  socialProofStateOf,
} from "./social-proof-desk";
import { getCreditCost } from "../credit-costs";

describe("free rails", () => {
  it("the refresh path's registry row is cost 0 (Social Proof (free))", () => {
    expect(getCreditCost(SOCIAL_PROOF_REFRESH_PATH)?.cost).toBe(0);
    expect(getCreditCost(SOCIAL_PROOF_REFRESH_PATH)?.feature).toBe("Social Proof (free)");
    expect(SOCIAL_PROOF_REFRESH_COST).toBe(0);
    expect(SOCIAL_PROOF_ME_PATH).toBe("/api/social-proof/me");
    expect(SOCIAL_PROOF_VISIBILITY_PATH).toBe("/api/social-proof/visibility");
  });
});

const FIGURE = {
  key: "instagram.followers",
  platform: "instagram",
  accountId: "acc-1",
  accountLabel: "@thycheatcode",
  label: "Instagram followers",
  value: 1204,
  updatedAt: "2026-11-03T10:00:00.000Z",
  visible: true,
  connected: true,
};

const STATE = {
  hasProfile: true,
  figures: [FIGURE],
  hiddenKeys: [],
  refreshedAt: "2026-11-03T10:00:00.000Z",
  stale: false,
  connectedPlatforms: ["instagram"],
};

describe("the state guard", () => {
  it("accepts the rail's state whole", () => {
    const s = socialProofStateOf(STATE);
    expect(s).not.toBeNull();
    expect(s!.figures[0]).toMatchObject({ key: "instagram.followers", value: 1204, visible: true });
    expect(s!.connectedPlatforms).toEqual(["instagram"]);
  });

  it("reads fetchedAt when a payload names the timestamp that way", () => {
    const { updatedAt: _u, ...rest } = FIGURE;
    const s = socialProofStateOf({ ...STATE, figures: [{ ...rest, fetchedAt: "2026-11-01T00:00:00.000Z" }] });
    expect(s!.figures[0]!.updatedAt).toBe("2026-11-01T00:00:00.000Z");
  });

  it("drops figures missing a key, label, or finite value — never dresses them up", () => {
    const s = socialProofStateOf({
      ...STATE,
      figures: [FIGURE, { platform: "tiktok", value: 5 }, { ...FIGURE, key: "x", value: "many" }],
    });
    expect(s!.figures).toHaveLength(1);
  });

  it("a missing or non-boolean hasProfile is not a state at all", () => {
    expect(socialProofStateOf({ figures: [] })).toBeNull();
    expect(socialProofStateOf({ hasProfile: "yes" })).toBeNull();
    expect(socialProofStateOf(null)).toBeNull();
    expect(socialProofStateOf({ error: "social_proof_not_ready" })).toBeNull();
  });

  it("the no-profile state is a real state (its own honest rendering)", () => {
    const s = socialProofStateOf({
      hasProfile: false,
      figures: [],
      hiddenKeys: [],
      refreshedAt: null,
      stale: true,
      connectedPlatforms: [],
    });
    expect(s).not.toBeNull();
    expect(s!.hasProfile).toBe(false);
  });
});

describe("the toggle — the settings card's own computation", () => {
  it("hide adds the key (deduped); show removes it; others untouched", () => {
    expect(hiddenKeysAfterToggle([], "a", false)).toEqual(["a"]);
    expect(hiddenKeysAfterToggle(["a"], "a", false)).toEqual(["a"]);
    expect(hiddenKeysAfterToggle(["a", "b"], "a", true)).toEqual(["b"]);
    expect(hiddenKeysAfterToggle(["a"], "b", true)).toEqual(["a"]);
  });

  it("the visibility payload is exactly { hiddenKeys }", () => {
    expect(buildVisibilityPayload(["a", "b"])).toEqual({ hiddenKeys: ["a", "b"] });
  });

  it("platform labels name the three catalog platforms, others pass through", () => {
    expect(platformLabel("instagram")).toBe("Instagram");
    expect(platformLabel("tiktok")).toBe("TikTok");
    expect(platformLabel("facebook")).toBe("Facebook");
    expect(platformLabel("myspace")).toBe("myspace");
  });
});
