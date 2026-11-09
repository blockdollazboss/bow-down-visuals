/**
 * avatar-presenter-bench — Stack 400 world parity (census
 * B-06) seam pins. The bench mirrors the 2D panel: the
 * registry's 1,200 as the confirmation override, the status
 * gate as the ONLY dark-state truth (configured:false →
 * generation can never be offered), the route's payload
 * shape and caps, and honest poll reads — a "done" with no
 * clip is never dressed up as a success.
 */
import { describe, expect, it } from "vitest";
import { getCreditCost } from "@/lib/credit-costs";
import {
  AVATAR_PRESENTER_ASPECTS,
  AVATAR_PRESENTER_COST,
  AVATAR_PRESENTER_FEATURE,
  AVATAR_PRESENTER_PATH,
  AVATAR_PRESENTER_SCRIPT_MAX,
  AVATAR_PRESENTER_STATUS_PATH,
  avatarPresenterCanGenerate,
  avatarPresenterJobPath,
  buildAvatarPresenterPayload,
  parseAvatarPresenterJob,
  parseAvatarPresenterStatus,
  presenterJobOutcome,
  presenterSubmitOf,
} from "./avatar-presenter-bench";

describe("the rail + the price", () => {
  it("posts where the panel posts, at the registry's 1,200", () => {
    expect(AVATAR_PRESENTER_PATH).toBe("/api/avatar-presenter");
    expect(AVATAR_PRESENTER_STATUS_PATH).toBe("/api/avatar-presenter/status");
    expect(AVATAR_PRESENTER_COST).toBe(1200);
    expect(getCreditCost("/api/avatar-presenter")?.cost).toBe(1200);
    expect(AVATAR_PRESENTER_COST).toBe(getCreditCost(AVATAR_PRESENTER_PATH)?.cost);
    expect(AVATAR_PRESENTER_FEATURE).toBe(getCreditCost(AVATAR_PRESENTER_PATH)?.feature);
    expect(AVATAR_PRESENTER_FEATURE).toBe("Avatar Presenter");
  });

  it("carries the route's own caps", () => {
    expect(AVATAR_PRESENTER_SCRIPT_MAX).toBe(4000);
    expect(AVATAR_PRESENTER_ASPECTS).toEqual(["16:9", "9:16", "1:1"]);
  });
});

describe("the dark-state pin (B-06's hard condition)", () => {
  it("generation is offered ONLY when the server says configured", () => {
    expect(avatarPresenterCanGenerate(null)).toBe(false);
    expect(
      avatarPresenterCanGenerate({ configured: false, provider: null, catalog: [], creditCost: 1200 }),
    ).toBe(false);
    expect(
      avatarPresenterCanGenerate({ configured: true, provider: "hedra", catalog: [], creditCost: 1200 }),
    ).toBe(true);
  });

  it("a malformed status can never read as configured", () => {
    expect(parseAvatarPresenterStatus(null).configured).toBe(false);
    expect(parseAvatarPresenterStatus({}).configured).toBe(false);
    expect(parseAvatarPresenterStatus({ configured: "yes" }).configured).toBe(false);
    expect(parseAvatarPresenterStatus({ configured: 1 }).configured).toBe(false);
  });

  it("parses the status the route actually sends", () => {
    const s = parseAvatarPresenterStatus({
      configured: false,
      provider: null,
      catalog: [{ id: "host-1", name: "The Host", style: "Studio" }],
      creditCost: 1200,
      pricePlaceholder: false,
    });
    expect(s).toEqual({
      configured: false,
      provider: null,
      catalog: [{ id: "host-1", name: "The Host", style: "Studio" }],
      creditCost: 1200,
    });
  });

  it("drops catalog entries without an id and a name, and a bogus price", () => {
    const s = parseAvatarPresenterStatus({
      configured: true,
      provider: "hedra",
      catalog: [{ name: "No id" }, { id: "x" }, null, { id: "ok", name: "Ok" }],
      creditCost: "1200",
    });
    expect(s.catalog).toEqual([{ id: "ok", name: "Ok", style: "" }]);
    expect(s.creditCost).toBe(0);
  });
});

describe("the payload — the route's presenter schema", () => {
  it("shapes avatarId + script + aspectRatio", () => {
    expect(
      buildAvatarPresenterPayload({ avatarId: " host-1 ", script: "  Welcome in. ", aspect: "9:16" }),
    ).toEqual({ avatarId: "host-1", script: "Welcome in.", aspectRatio: "9:16" });
  });

  it("refuses an ask the route would 400 — no avatar, or nothing to say", () => {
    expect(buildAvatarPresenterPayload({ avatarId: "", script: "Hi", aspect: "16:9" })).toBeNull();
    expect(buildAvatarPresenterPayload({ avatarId: "a", script: "   ", aspect: "16:9" })).toBeNull();
  });

  it("caps the script at the route's 4,000", () => {
    const p = buildAvatarPresenterPayload({
      avatarId: "a",
      script: "x".repeat(5000),
      aspect: "1:1",
    });
    expect(p?.script.length).toBe(4000);
  });
});

describe("the submit + the poll reads", () => {
  it("takes only a real job id as the poll handle", () => {
    expect(presenterSubmitOf({ jobId: "job-1", status: "queued", creditsCharged: 1200 })).toBe("job-1");
    expect(presenterSubmitOf({})).toBeNull();
    expect(presenterSubmitOf({ jobId: "" })).toBeNull();
    expect(presenterSubmitOf(null)).toBeNull();
  });

  it("builds the poll path on the rail", () => {
    expect(avatarPresenterJobPath("job-1")).toBe("/api/avatar-presenter/job-1");
  });

  it("reads the job's honest states and never invents one", () => {
    expect(parseAvatarPresenterJob({ job: { status: "processing", outputUrl: null, error: null } })).toEqual({
      status: "processing",
      outputUrl: null,
      error: null,
    });
    expect(parseAvatarPresenterJob({ job: { status: "mystery" } })).toBeNull();
    expect(parseAvatarPresenterJob({})).toBeNull();
    expect(parseAvatarPresenterJob(null)).toBeNull();
  });

  it("a done job needs its clip — done-without-clip is its own outcome", () => {
    expect(presenterJobOutcome({ status: "queued", outputUrl: null, error: null })).toBe("running");
    expect(presenterJobOutcome({ status: "processing", outputUrl: null, error: null })).toBe("running");
    expect(presenterJobOutcome({ status: "failed", outputUrl: null, error: "boom" })).toBe("failed");
    expect(
      presenterJobOutcome({ status: "done", outputUrl: "https://cdn/clip.mp4", error: null }),
    ).toBe("done");
    expect(presenterJobOutcome({ status: "done", outputUrl: null, error: null })).toBe("done-no-clip");
  });
});
