/**
 * lightning-setup.test.ts — first-run truth pins for the 60-second
 * wizard (Lane N6, stack1000).
 *
 * The slug check distinguishes two failures server-side: a slug that
 * is TAKEN (valid but unavailable) and a slug that is INVALID (too
 * short, bad edges — the server sends the real reason). The wizard
 * used to map both to "Taken — try …?", telling a new creator their
 * link was snatched when it was really just too short, and throwing
 * the server's actual explanation away. These pins hold the split.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./lightning-setup.tsx", import.meta.url), "utf8");

describe("LightningSetup — slug feedback tells the truth", () => {
  it("keeps invalid and taken as separate states", () => {
    expect(src).toContain('"taken" | "invalid"');
    expect(src).toContain('if (data.valid === false) {');
    expect(src).toContain('setSlugState("invalid")');
  });

  it("surfaces the server's reason for an invalid slug", () => {
    expect(src).toContain("setSlugError(typeof data.error === \"string\" ? data.error");
    expect(src).toContain('slugState === "invalid"');
    expect(src).toContain("{slugError}");
  });

  it("only calls a slug Taken when it is actually taken", () => {
    expect(src).toContain('slugState === "taken"');
    expect(src).toContain('setSlugState(data.available ? "ok" : "taken")');
  });

  it("still gates Continue on an ok slug", () => {
    expect(src).toContain('slugState === "ok"');
  });
});

describe("LightningSetup — the plan arrives pre-filled from the ONE suggestion brain", () => {
  const setupSrc = readFileSync(new URL("../../pages/artist-setup.tsx", import.meta.url), "utf8");

  it("the wizard's create payload carries the brain's bio, not a blank one", () => {
    expect(src).toContain('from "@/lib/suggest"');
    expect(src).toContain("suggestedBioForProfile({");
    expect(src).toContain("genre: vaultSignal.genre");
    expect(src).toContain("vertical: lane");
    /* Brain has nothing → bio stays empty, the old honest behavior. */
    expect(src).toContain('?? ""');
  });

  it("the wizard keeps the Vault's suggestion signal from its prefill fetch", () => {
    expect(src).toContain("setVaultSignal({");
    expect(src).toContain("visualStyle: v.visual_style ?? null");
    expect(src).toContain("voiceStyle: v.voice_style ?? null");
  });

  it("the manual editor path pre-fills the same way, raw description as fallback", () => {
    expect(setupSrc).toContain("suggestedBioForProfile({");
    expect(setupSrc).toContain("v.description ??");
    expect(setupSrc).toContain("prefillWithSuggestion(");
    expect(setupSrc).toContain("bio: preBio");
  });
});
