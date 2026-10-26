/**
 * Song credits (Stack-200 N1) — client contract.
 * Pins: per-rail share labels are never blended; whole percentages
 * render without a trailing .0; frozen co-release shares say
 * "(agreed)"; the honest empty state is what renders for a song with
 * nothing recorded; older payloads without a credits object render
 * nothing (no crash, no invented block).
 */
import { describe, expect, it } from "vitest";
import {
  formatCreditLine,
  formatCreditShares,
  shouldShowCredits,
  SONG_CREDITS_EMPTY,
  type PublicSongCredits,
  type SongCreditPerson,
} from "./song-credits";

const person = (over: Partial<SongCreditPerson> = {}): SongCreditPerson => ({
  name: "Co Writer",
  profile_id: "prof-co",
  profile_slug: "co-writer",
  profile_path: "/artist/co-writer",
  roles: ["writer", "producer"],
  role_labels: ["Songwriter", "Producer"],
  shares: [{ source: "publishing", pct: 40 }],
  writer_status: "pending",
  detail: null,
  sources: ["publishing", "credit_entry"],
  inherited: false,
  ...over,
});

describe("formatCreditShares — per-rail, never blended", () => {
  it("labels each rail and marks frozen co-release shares as agreed", () => {
    expect(
      formatCreditShares([
        { source: "publishing", pct: 60 },
        { source: "master", pct: 70 },
        { source: "co_release", pct: 50, frozen: true },
      ]),
    ).toBe("60% publishing · 70% master · 50% co-release (agreed)");
  });
  it("keeps two decimals where the split needs them", () => {
    expect(formatCreditShares([{ source: "publishing", pct: 33.33 }])).toBe("33.33% publishing");
  });
  it("no shares is an empty string, not a fake 0%", () => {
    expect(formatCreditShares([])).toBe("");
  });
});

describe("formatCreditLine", () => {
  it("name — roles — shares — detail on one line", () => {
    expect(formatCreditLine(person())).toBe("Co Writer — Songwriter, Producer — 40% publishing");
    expect(
      formatCreditLine(person({ roles: ["sample"], role_labels: ["Sample"], shares: [], detail: "Blue Tide — The Harbour Band" })),
    ).toBe("Co Writer — Sample — Blue Tide — The Harbour Band");
  });
});

describe("shouldShowCredits", () => {
  const empty: PublicSongCredits = {
    song_kind: "song",
    song_id: "s1",
    song_title: "Old Upload",
    has_credits: false,
    empty_message: SONG_CREDITS_EMPTY,
    credits: [],
    writer_splits_valid: null,
    version: 0,
    follows_song: "",
  };
  it("an honest empty credits object still renders (the block says so)", () => {
    expect(shouldShowCredits(empty)).toBe(true);
    expect(empty.empty_message).toBe("No credits recorded yet.");
  });
  it("missing credits (older payloads) render nothing", () => {
    expect(shouldShowCredits(null)).toBe(false);
    expect(shouldShowCredits(undefined)).toBe(false);
  });
});
