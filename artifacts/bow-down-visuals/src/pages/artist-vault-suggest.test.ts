/**
 * artist-vault — the Vault profile editor reads the ONE suggestion
 * brain (stack1400 org wave #2, audit §3.3).
 *
 * Was: the editor's description field started blank and stayed blank
 * unless the creator wrote one from scratch — even with the artist's
 * name, genre, personality and style fields filled in right above it.
 * Now: while the description is empty, the editor offers the brain's
 * starter (lib/suggest) derived from those very fields. Pins hold
 * the wiring, the never-overwrite gate, and the brain's answer for a
 * form-shaped profile.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { suggestedBioForProfile } from "@/lib/suggest";

const src = readFileSync(new URL("./artist-vault.tsx", import.meta.url), "utf8");

describe("Vault profile editor — suggestion brain wiring", () => {
  it("imports and calls the one brain with the form's own fields", () => {
    expect(src).toContain('from "@/lib/suggest"');
    expect(src).toContain("suggestedBioForProfile({");
    expect(src).toContain("displayName: watched.artistName");
    expect(src).toContain("genre: watched.genre");
    expect(src).toContain("personality: watched.personality");
    expect(src).toContain("visualStyle: watched.visualStyle");
    expect(src).toContain("voiceStyle: watched.voiceStyle");
  });

  it("offers the suggestion only while the description is empty — never over the creator's words", () => {
    expect(src).toContain("!watched.artistDescription?.trim()");
    expect(src).toContain('data-testid="vault-suggested-description"');
    expect(src).toContain('setValue("artistDescription", suggested)');
  });

  it("the brain answers a form-shaped profile with a description in its own words", () => {
    const bio = suggestedBioForProfile({
      displayName: "King Shark",
      genre: "Hip-Hop",
      personality: "bold and playful",
      visualStyle: "gold luxury",
      voiceStyle: "deep",
    });
    expect(bio).toContain("King Shark makes Hip-Hop.");
    expect(bio).toContain("Bold and playful.");
    expect(bio).toContain("gold luxury · deep");
  });

  it("the brain has nothing for an untouched form — the field stays honestly empty", () => {
    expect(
      suggestedBioForProfile({ displayName: "", genre: "", personality: "", visualStyle: "", voiceStyle: "" }),
    ).toBeNull();
  });
});
