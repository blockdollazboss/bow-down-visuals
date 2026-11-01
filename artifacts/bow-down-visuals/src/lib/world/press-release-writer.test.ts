import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PRESS_RELEASE_COST_VB,
  PRESS_RELEASE_PATH,
  buildKitReleaseEntry,
  buildPressReleaseBody,
  cleanKeyFacts,
  formatReleaseText,
  parseGeneratedRelease,
  pressReleaseReady,
  savedReleasesForKit,
  type GeneratedRelease,
  type PressReleaseForm,
} from "./press-release-writer";

/* ─── Press-release writer (stack1100 world parity) ────────────────
   The last BUSINESS_NATIVE_FOLLOW_ONS bench entry graduates into
   the Press Kit desk. These tests pin the seam to the 2D panel's
   own contract (components/PressReleasePanel.tsx): the body it
   posts, the registry's 100-Buc price, the .txt format line for
   line, and the save-into-kit append that starts from the kit's
   real saved list — never an overwrite. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const FORM: PressReleaseForm = {
  announcementType: "single",
  topic: "The new single drops Friday with a palace listening party.",
  artistName: "Thy Cheat Code",
  keyFactsText: "Out Friday, Nov 6\nProduced by The King\n",
  quote: "",
  contactName: "Bow Down Visuals",
  contactEmail: "hello@bowdownvisuals.com",
  contactPhone: "",
  datelineCity: "Atlanta, GA",
};

const RELEASE: GeneratedRelease = {
  headline: "Thy Cheat Code Drops “Midnight Fins”",
  dateline: "ATLANTA, GA",
  lede: "The King Shark returns with a midnight anthem.",
  body: ["First paragraph.", "Second paragraph."],
  quote: "This one is for the whole kingdom.",
  boilerplate: "Bow Down Visuals is the content creator's cheat code.",
  contactBlock: ["Contact: Bow Down Visuals", "Email: hello@bowdownvisuals.com"],
  social: "Midnight Fins out Friday 🦈",
};

describe("the rail + the price", () => {
  it("the path is the panel's own endpoint and the cost is the registry's pinned 100", () => {
    expect(PRESS_RELEASE_PATH).toBe("/api/press-release");
    expect(PRESS_RELEASE_COST_VB).toBe(100);
    const costs = read("../credit-costs.ts");
    expect(costs).toContain('"/api/press-release": { cost: 100, feature: "Press Release Generator" }');
  });
});

describe("form → body (the panel's handleGenerate shape)", () => {
  it("key facts clean to the non-empty trimmed lines", () => {
    expect(cleanKeyFacts("  a \n\n b\n")).toEqual(["a", "b"]);
    expect(cleanKeyFacts("")).toEqual([]);
  });

  it("readiness mirrors the rail's schema (type enum, artist 1–120, topic 10–2000, 1–8 facts ≤200, quote ≤600)", () => {
    expect(pressReleaseReady(FORM)).toBe(true);
    expect(pressReleaseReady({ ...FORM, announcementType: "rave" })).toBe(false);
    expect(pressReleaseReady({ ...FORM, artistName: " " })).toBe(false);
    expect(pressReleaseReady({ ...FORM, topic: "too short" })).toBe(false);
    expect(pressReleaseReady({ ...FORM, keyFactsText: " \n " })).toBe(false);
    expect(pressReleaseReady({ ...FORM, keyFactsText: Array(9).fill("fact").join("\n") })).toBe(false);
    expect(pressReleaseReady({ ...FORM, keyFactsText: "x".repeat(201) })).toBe(false);
    expect(pressReleaseReady({ ...FORM, quote: "q".repeat(601) })).toBe(false);
  });

  it("the body is field-for-field the panel's — blanks omitted the same way", () => {
    expect(buildPressReleaseBody(FORM)).toEqual({
      announcementType: "single",
      topic: "The new single drops Friday with a palace listening party.",
      artistName: "Thy Cheat Code",
      keyFacts: ["Out Friday, Nov 6", "Produced by The King"],
      quote: undefined,
      contactInfo: { name: "Bow Down Visuals", email: "hello@bowdownvisuals.com", phone: "" },
      datelineCity: "Atlanta, GA",
    });
    expect(buildPressReleaseBody({ ...FORM, quote: "  My words. ", datelineCity: " " })).toEqual(
      expect.objectContaining({ quote: "My words.", datelineCity: undefined }),
    );
  });
});

describe("the generated release", () => {
  it("parses the rail's { release } answer; anything else is a failed read", () => {
    expect(parseGeneratedRelease({ release: RELEASE })).toEqual(RELEASE);
    expect(parseGeneratedRelease({})).toBeNull();
    expect(parseGeneratedRelease({ release: { lede: "x" } })).toBeNull();
    expect(parseGeneratedRelease({ release: { ...RELEASE, body: ["ok", 5] } })?.body).toEqual(["ok"]);
  });

  it("the .txt rendering is the panel's formatReleaseText, line for line", () => {
    expect(formatReleaseText(RELEASE, "Thy Cheat Code")).toBe(
      [
        "FOR IMMEDIATE RELEASE",
        "",
        "Thy Cheat Code Drops “Midnight Fins”",
        "",
        "ATLANTA, GA — The King Shark returns with a midnight anthem.",
        "",
        "First paragraph.",
        "",
        "Second paragraph.",
        "",
        "\"This one is for the whole kingdom.\" — Thy Cheat Code",
        "",
        "About Thy Cheat Code",
        "Bow Down Visuals is the content creator's cheat code.",
        "",
        "###",
        "Contact: Bow Down Visuals",
        "Email: hello@bowdownvisuals.com",
        "",
      ].join("\n"),
    );
    const bare = formatReleaseText({ ...RELEASE, dateline: "", quote: "", boilerplate: "" }, "X");
    expect(bare).toContain("The King Shark returns with a midnight anthem.");
    expect(bare).not.toContain("About X");
  });
});

describe("save into the kit — the append starts from the kit's real list", () => {
  const mine = {
    kits: [
      { id: "kit-1", press_releases: [{ id: "pr-1", headline: "Old", body: "b", announcementType: "album", social: "s", createdAt: "2026-10-01T00:00:00.000Z" }] },
      { id: "kit-2" },
    ],
  };

  it("reads the named kit's saved releases; a kit without the field reads as none yet", () => {
    expect(savedReleasesForKit(mine, "kit-1")).toHaveLength(1);
    expect(savedReleasesForKit(mine, "kit-2")).toEqual([]);
  });

  it("an unknown kit or a malformed row reads null — the desk refuses rather than overwrite", () => {
    expect(savedReleasesForKit(mine, "kit-9")).toBeNull();
    expect(savedReleasesForKit({ kits: [{ id: "k", press_releases: [{ headline: "no id" }] }] }, "k")).toBeNull();
    expect(savedReleasesForKit({}, "k")).toBeNull();
  });

  it("the entry carries the panel's saved shape", () => {
    const entry = buildKitReleaseEntry(RELEASE, FORM, new Date("2026-10-31T12:00:00.000Z"));
    expect(entry.id).toBe(`pr-${new Date("2026-10-31T12:00:00.000Z").getTime()}`);
    expect(entry.headline).toBe(RELEASE.headline);
    expect(entry.announcementType).toBe("single");
    expect(entry.social).toBe(RELEASE.social);
    expect(entry.createdAt).toBe("2026-10-31T12:00:00.000Z");
    expect(entry.body).toBe(formatReleaseText(RELEASE, "Thy Cheat Code"));
  });
});

describe("the writer is docked in the Press Kit desk and rides the confirmation", () => {
  const writerSrc = read("../../components/world/native/PressReleaseWriter.tsx");
  const desksSrc = read("../../components/world/native/BusinessDesks.tsx");

  it("the mount sits inside PressKitDesk (between it and the next desk)", () => {
    const deskAt = desksSrc.indexOf("export function PressKitDesk");
    const mountAt = desksSrc.indexOf("<PressReleaseWriter");
    const nextDeskAt = desksSrc.indexOf("export function PromoteDesk");
    expect(deskAt).toBeGreaterThan(-1);
    expect(mountAt).toBeGreaterThan(deskAt);
    expect(mountAt).toBeLessThan(nextDeskAt);
    expect(desksSrc).toContain('import { PressReleaseWriter } from "./PressReleaseWriter"');
  });

  it("generation rides confirmedFetch with the pinned cost named; the save PUTs the appended list", () => {
    expect(writerSrc).toContain('data-testid="world-press-release-writer"');
    expect(writerSrc).toContain("confirmedFetch(PRESS_RELEASE_PATH");
    expect(writerSrc).toContain("overrideCost: PRESS_RELEASE_COST_VB");
    expect(writerSrc).toContain('method: "PUT"');
    expect(writerSrc).toContain("press_releases: [...existing, entry]");
    /* A declined confirmation charges nothing and says so in the flow. */
    expect(writerSrc).toContain("if (!res) return");
  });
});
