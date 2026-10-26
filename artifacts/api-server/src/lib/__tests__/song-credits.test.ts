/**
 * Song credits that travel with the song (Stack-200 N1) — pure machine.
 *
 * Pins:
 *  - the canonical merge: writers (publishing rail), master splits,
 *    co-release agreed shares and credit entries for the SAME person
 *    become ONE credit with per-rail shares — never blended, never a
 *    second splits store;
 *  - split-sum integrity is checked through the EXISTING validator
 *    (validateWriterSplits from publishing-splits) — a bad legacy sum
 *    is reported, a good one passes, no writers is honest null;
 *  - inheritance: credits recorded on a parent song appear on the
 *    derived song labelled inherited, and a direct credit for the same
 *    person wins over the inherited copy (same record travelling);
 *  - entry validation: samples must declare their source, duplicates
 *    and unknown roles are refused;
 *  - honest empty: a song with nothing recorded has no credits and the
 *    sheet says so — no invented people.
 */
import { describe, expect, it } from "vitest";
import {
  buildCanonicalCredits,
  buildCreditsSheet,
  checkWriterSplits,
  mergeCanonicalCredits,
  normalizeCreditEntries,
  validateCreditEntries,
  SongCreditError,
  SONG_CREDITS_COPY,
  type CreditSources,
} from "../song-credits";
import type { PublishingWriter } from "../publishing-splits";

const OWNER = "11111111-1111-1111-1111-111111111111";
const CO = "22222222-2222-2222-2222-222222222222";
const P_OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const P_CO = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function writer(over: Partial<PublishingWriter> = {}): PublishingWriter {
  return {
    id: "w1",
    writerName: "Thy Cheat Code",
    writerUserId: OWNER,
    writerProfileId: P_OWNER,
    sharePct: 60,
    confirmationStatus: "confirmed",
    disputeNote: null,
    confirmedAt: null,
    disputedAt: null,
    ...over,
  };
}

function sources(over: Partial<CreditSources> = {}): CreditSources {
  return {
    owner: { userId: OWNER, profileId: P_OWNER, profileSlug: "thy-cheat-code", displayName: "Thy Cheat Code" },
    publishingWriters: [],
    masterSplits: [],
    coReleaseSides: [],
    entries: [],
    inheritedFrom: null,
    ...over,
  };
}

describe("mergeCanonicalCredits — one person, one credit, per-rail shares", () => {
  it("merges writer + master + entry records for the same profile into a single credit", () => {
    const merged = mergeCanonicalCredits(
      sources({
        publishingWriters: [
          writer(),
          writer({ id: "w2", writerName: "Co Writer", writerUserId: CO, writerProfileId: P_CO, sharePct: 40, confirmationStatus: "pending" }),
        ],
        masterSplits: [{ payeeName: "Thy Cheat Code", role: null, sharePct: 70 }],
        entries: [
          { id: "e1", role: "producer", displayName: "Co Writer", creditUserId: CO, creditProfileId: P_CO, detail: null, sortOrder: 0 },
        ],
      }),
    );
    expect(merged).toHaveLength(2);
    const owner = merged.find((c) => c.name === "Thy Cheat Code")!;
    expect(owner.roles).toContain("artist");
    expect(owner.roles).toContain("writer");
    expect(owner.profileSlug).toBe("thy-cheat-code");
    /* Shares stay per-rail: 60% publishing and 70% master are different
       rights — never blended into one number. */
    expect(owner.shares).toEqual([
      { source: "publishing", pct: 60 },
      { source: "master", pct: 70 },
    ]);
    const co = merged.find((c) => c.name === "Co Writer")!;
    expect(co.roles).toContain("writer");
    expect(co.roles).toContain("producer");
    expect(co.writerStatus).toBe("pending");
  });

  it("carries co-release agreed shares as frozen, and samples with their declared source", () => {
    const merged = mergeCanonicalCredits(
      sources({
        owner: null,
        coReleaseSides: [
          { profileId: P_CO, userId: CO, displayName: "Co Artist", profileSlug: "co-artist", sharePct: 50, frozen: true },
        ],
        entries: [
          { id: "e1", role: "sample", displayName: "Sample", creditUserId: null, creditProfileId: null, detail: "Blue Tide — The Harbour Band", sortOrder: 0 },
        ],
      }),
    );
    const co = merged.find((c) => c.name === "Co Artist")!;
    expect(co.shares).toEqual([{ source: "co_release", pct: 50, frozen: true }]);
    const sample = merged.find((c) => c.roles.includes("sample"))!;
    expect(sample.detail).toBe("Blue Tide — The Harbour Band");
  });
});

describe("checkWriterSplits — integrity through the existing validator", () => {
  it("passes an exact 100 and reports a legacy bad sum instead of throwing", () => {
    expect(checkWriterSplits([writer(), writer({ writerName: "Co", writerUserId: CO, writerProfileId: P_CO, sharePct: 40 })]).valid).toBe(true);
    const bad = checkWriterSplits([writer(), writer({ writerName: "Co", writerUserId: CO, writerProfileId: P_CO, sharePct: 30 })]);
    expect(bad.valid).toBe(false);
    expect(bad.error).toMatch(/total 90\.00%/);
  });
  it("no writers is honest null, not invalid", () => {
    expect(checkWriterSplits([])).toEqual({ valid: null, error: null });
  });
});

describe("validateCreditEntries / normalizeCreditEntries", () => {
  it("accepts named roles and trims them into stored shape", () => {
    const out = normalizeCreditEntries([
      { role: "producer", name: "  Co Writer  ", profileId: P_CO },
      { role: "sample", name: "Sample", detail: "Blue Tide — The Harbour Band" },
    ]);
    expect(out[0]!.displayName).toBe("Co Writer");
    expect(out[1]!.detail).toBe("Blue Tide — The Harbour Band");
  });
  it("refuses a sample with no declared source, a duplicate, and a blank name", () => {
    expect(() => validateCreditEntries([{ role: "sample", name: "Sample" }])).toThrowError(/sampled work/);
    expect(() =>
      validateCreditEntries([
        { role: "producer", name: "A" },
        { role: "producer", name: "A" },
      ]),
    ).toThrowError(SongCreditError);
    expect(() => validateCreditEntries([{ role: "producer", name: "  " }])).toThrowError(/needs a name/);
  });
});

describe("buildCanonicalCredits — credits follow the song", () => {
  const parentAnchor = { kind: "song" as const, id: "song-parent" };
  const childAnchor = { kind: "song" as const, id: "song-child" };

  it("a derived song (remix/cover/open-verse build) shows the parent's credits, labelled inherited", () => {
    const built = buildCanonicalCredits({
      anchor: childAnchor,
      songTitle: "Midnight Tide (Remix)",
      version: 0,
      bundles: [
        { anchor: childAnchor, sources: sources({ publishingWriters: [], owner: { userId: CO, profileId: P_CO, profileSlug: "co-artist", displayName: "Co Artist" } }) },
        {
          anchor: parentAnchor,
          sources: sources({
            publishingWriters: [writer(), writer({ writerName: "Co Writer", writerUserId: CO, writerProfileId: P_CO, sharePct: 40 })],
            inheritedFrom: parentAnchor,
          }),
        },
      ],
    });
    const writerCredit = built.credits.find((c) => c.name === "Thy Cheat Code")!;
    expect(writerCredit.roles).toContain("writer");
    expect(writerCredit.inheritedFrom).toEqual(parentAnchor);
    expect(built.inheritedFromAnchors).toEqual([parentAnchor]);
    expect(built.writerSplitsValid).toBe(true);
    expect(built.hasCredits).toBe(true);
  });

  it("a direct credit for the same person wins over the inherited copy — listed once", () => {
    const built = buildCanonicalCredits({
      anchor: childAnchor,
      songTitle: "Midnight Tide (Remix)",
      version: 1,
      bundles: [
        { anchor: childAnchor, sources: sources({ publishingWriters: [writer({ sharePct: 100 })] }) },
        { anchor: parentAnchor, sources: sources({ publishingWriters: [writer()], inheritedFrom: parentAnchor }) },
      ],
    });
    const matches = built.credits.filter((c) => c.name === "Thy Cheat Code");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.inheritedFrom).toBeNull();
    expect(matches[0]!.shares).toEqual([{ source: "publishing", pct: 100 }]);
  });

  it("a legacy song with nothing recorded renders honestly empty", () => {
    const built = buildCanonicalCredits({
      anchor: childAnchor,
      songTitle: "Old Upload",
      version: 0,
      bundles: [{ anchor: childAnchor, sources: sources({ owner: null }) }],
    });
    expect(built.hasCredits).toBe(false);
    expect(built.credits).toEqual([]);
    expect(built.writerSplitsValid).toBeNull();
    expect(buildCreditsSheet(built, new Date("2026-10-26T00:00:00Z"))).toContain(SONG_CREDITS_COPY.empty);
  });

  it("the sheet carries names, roles and per-rail shares for exports", () => {
    const built = buildCanonicalCredits({
      anchor: childAnchor,
      songTitle: "Midnight Tide",
      version: 2,
      bundles: [
        {
          anchor: childAnchor,
          sources: sources({
            publishingWriters: [writer(), writer({ writerName: "Co Writer", writerUserId: CO, writerProfileId: P_CO, sharePct: 40 })],
          }),
        },
      ],
    });
    const sheet = buildCreditsSheet(built, new Date("2026-10-26T00:00:00Z"));
    expect(sheet).toContain("Thy Cheat Code");
    expect(sheet).toContain("60.00% publishing");
    expect(sheet).toContain("Credits version: 2");
  });
});
