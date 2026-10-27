import { describe, it, expect } from "vitest";
import { introForViewer, detectMutualIntro, mutualAcceptedStatus } from "../collab-intro";

describe("collab-intro double opt-in", () => {
  it("locks the pitch for the receiver while pending", () => {
    const v = introForViewer("pending", "let's make a song", false);
    expect(v.message).toBeNull();
    expect(v.introLocked).toBe(true);
    expect(v.lockedReason).toContain("both opt in");
  });
  it("reveals the pitch to the receiver after they accept (second opt-in)", () => {
    const v = introForViewer("accepted", "let's make a song", false);
    expect(v.message).toBe("let's make a song");
    expect(v.introLocked).toBe(false);
  });
  it("sender always sees their own pitch", () => {
    expect(introForViewer("pending", "mine", true).message).toBe("mine");
  });
  it("declined intros stay locked for the receiver", () => {
    const v = introForViewer("declined", "pitch", false);
    expect(v.message).toBeNull();
    expect(v.introLocked).toBe(true);
  });
  it("mutual pending requests count as double opt-in", () => {
    expect(detectMutualIntro("pending", "pending")).toBe(true);
    expect(detectMutualIntro("accepted", "pending")).toBe(true);
    expect(detectMutualIntro("pending", null)).toBe(false);
    expect(detectMutualIntro("pending", "declined")).toBe(false);
  });
  it("mutual acceptance never resurrects a declined request", () => {
    expect(mutualAcceptedStatus("pending")).toBe("accepted");
    expect(mutualAcceptedStatus("declined")).toBe("declined");
  });
});
