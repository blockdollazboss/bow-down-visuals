import { describe, it, expect } from "vitest";
import {
  NicheLabel,
  PlatformLabel,
  scoreColor,
  fillProposalTemplate,
  clampFollowers,
} from "./collabs";

describe("NicheLabel", () => {
  it("capitalizes the first letter", () => {
    expect(NicheLabel("music")).toBe("Music");
    expect(NicheLabel("podcasting")).toBe("Podcasting");
  });

  it("handles empty strings", () => {
    expect(NicheLabel("")).toBe("");
  });
});

describe("PlatformLabel", () => {
  it("capitalizes platforms", () => {
    expect(PlatformLabel("tiktok")).toBe("Tiktok");
    expect(PlatformLabel("youtube")).toBe("Youtube");
  });

  it("special-cases X", () => {
    expect(PlatformLabel("x")).toBe("X");
  });
});

describe("scoreColor", () => {
  it("returns emerald for great fits", () => {
    expect(scoreColor(75)).toBe("text-emerald-400");
    expect(scoreColor(100)).toBe("text-emerald-400");
  });

  it("returns amber for middling fits", () => {
    expect(scoreColor(50)).toBe("text-amber-300");
    expect(scoreColor(74)).toBe("text-amber-300");
  });

  it("returns red for poor fits", () => {
    expect(scoreColor(49)).toBe("text-red-400");
    expect(scoreColor(0)).toBe("text-red-400");
  });
});

describe("fillProposalTemplate", () => {
  const tpl = "Hey {name}! I'm {me} — I create {myNiche} content and love your {niche} work.";

  it("fills all placeholders", () => {
    const out = fillProposalTemplate(
      tpl,
      { displayName: "Vox Queen", nicheLabel: "Music" },
      { displayName: "Shark Beats", nicheLabel: "Music" },
    );
    expect(out).toBe("Hey Vox Queen! I'm Shark Beats — I create music content and love your music work.");
  });

  it("falls back to 'a fellow creator' when the sender has no name", () => {
    const out = fillProposalTemplate(
      tpl,
      { displayName: "Vox Queen", nicheLabel: "Gaming" },
      { displayName: "", nicheLabel: "Music" },
    );
    expect(out).toContain("I'm a fellow creator");
  });

  it("lowercases niche labels", () => {
    const out = fillProposalTemplate(
      tpl,
      { displayName: "A", nicheLabel: "Vlogging" },
      { displayName: "B", nicheLabel: "Comedy" },
    );
    expect(out).toContain("comedy content");
    expect(out).toContain("vlogging work");
  });
});

describe("clampFollowers", () => {
  it("parses plain numbers", () => {
    expect(clampFollowers("50000")).toBe(50000);
    expect(clampFollowers("")).toBe(0);
    expect(clampFollowers("abc")).toBe(0);
  });

  it("clamps negatives to zero", () => {
    expect(clampFollowers("-100")).toBe(0);
  });

  it("clamps huge values to 1B", () => {
    expect(clampFollowers("99999999999")).toBe(1000000000);
  });
});
