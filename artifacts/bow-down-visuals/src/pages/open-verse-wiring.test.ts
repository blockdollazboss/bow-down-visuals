/**
 * open-verse-wiring.test.ts — #176 Open Verse source contracts.
 *  - the desk docks INSIDE existing surfaces (Songs = CREATE, Contests =
 *    PROMOTE) and there is NO standalone /open-verse page or route;
 *  - split terms are shown up front (the desk renders the terms block
 *    on the create form AND on every post, before the submit form);
 *  - the desk talks only to the /api/open-verse rail, carries the
 *    Visual Bucs / test-mode / never-cash money law, and uses both
 *    themes (light + dark branches);
 *  - pure helpers: the split preview always sums to 100 on the
 *    creator/winner two-line shape; state labels never claim a winner
 *    before one is picked.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postStateLabel, splitPreview, type OpenVersePostDto } from "@/components/songs/open-verse-desk-helpers";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const desk = read("components/songs/OpenVerseDesk.tsx");
const songs = read("pages/songs.tsx");
const contests = read("pages/contests.tsx");
const app = read("App.tsx");

describe("open verse docking — no standalone page", () => {
  it("mounts the desk on Songs and Contests", () => {
    expect(songs).toContain('import OpenVerseDesk from "@/components/songs/OpenVerseDesk"');
    expect(songs).toContain("<OpenVerseDesk />");
    expect(contests).toContain('import OpenVerseDesk from "@/components/songs/OpenVerseDesk"');
    expect(contests).toContain("<OpenVerseDesk />");
  });

  it("has no standalone route or page", () => {
    expect(app).not.toContain('path="/open-verse"');
    expect(app).not.toContain("pages/open-verse");
  });
});

describe("open verse desk contracts", () => {
  it("talks to the full /api/open-verse rail", () => {
    for (const frag of [
      "/api/open-verse/open",
      "/api/open-verse/mine",
      '"/api/open-verse"',
      "/submit",
      "/close",
      "/cancel",
      "/pick-winner",
      "/withdraw",
    ]) {
      expect(desk).toContain(frag);
    }
  });

  it("shows split terms up front — on the create form and on every post", () => {
    expect(desk).toContain('data-testid="open-verse-split-terms"');
    expect(desk).toContain("<SplitTermsBlock terms={previewTerms} />");
    expect(desk).toContain("<SplitTermsBlock terms={post.split_terms} />");
    expect(desk).toContain("before any verse is submitted");
    // The submit form sits under the terms block in the post card.
    expect(desk.indexOf("<SplitTermsBlock terms={post.split_terms} />")).toBeLessThan(desk.indexOf("Submit your verse"));
  });

  it("carries the money law and both themes, and invents no price", () => {
    expect(desk).toContain("Visual Bucs only, never cash");
    expect(desk).toContain("Test mode");
    expect(desk).toContain("submitting a verse is free");
    expect(desk).toContain("useIsLightTheme");
    expect(desk).toContain("isLight");
    expect(desk).not.toMatch(/\$\d/);
  });

  it("only the creator picks — the pick button is owner-gated", () => {
    expect(desk).toContain('post.is_owner && post.viewer_actions.includes("pick_winner")');
    expect(desk).toContain("Pick as winner");
  });
});

function dto(over: Partial<OpenVersePostDto> = {}): OpenVersePostDto {
  return {
    id: "p1",
    song_kind: "song",
    song_id: "s1",
    song_title: "Midnight Tide",
    brief: "",
    slot_label: "Open verse",
    split_terms: splitPreview(25),
    winner_share_pct: 25,
    currency: "VB",
    money_note: "",
    terms_note: "",
    status: "open",
    state: "open",
    closes_at: null,
    is_owner: false,
    submission_count: 0,
    my_submission_id: null,
    my_submission_status: null,
    winner_submission_id: null,
    is_winner: false,
    viewer_actions: [],
    ...over,
  };
}

describe("open verse helpers", () => {
  it("splitPreview always sums to 100 with the two rail lines", () => {
    for (const share of [1, 25, 33.33, 50, 99]) {
      const terms = splitPreview(share);
      expect(terms).toHaveLength(2);
      expect(terms.reduce((a, t) => a + t.sharePct, 0)).toBeCloseTo(100, 2);
      expect(terms.find((t) => t.role === "winner")?.sharePct).toBe(share);
      expect(terms.map((t) => t.name)).toEqual(["Song creator", "Winning verse creator"]);
    }
  });

  it("state labels are honest about the pick", () => {
    expect(postStateLabel(dto())).toContain("Taking verses");
    expect(postStateLabel(dto({ status: "closed", state: "closed" }))).toContain("awaiting the creator's pick");
    expect(postStateLabel(dto({ status: "winner_picked", state: "winner_picked" }))).toContain("Winner picked");
    expect(postStateLabel(dto({ status: "cancelled", state: "cancelled" }))).toBe("Cancelled");
  });
});
