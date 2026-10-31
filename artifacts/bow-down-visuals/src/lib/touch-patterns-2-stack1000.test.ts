/**
 * Stack1000 M4 — touch patterns, round 2: the two frontiers
 * stack900's audits named and left.
 *
 *  1. The sub-44 PATTERNS of the 2D site (K2 phone-truth §4):
 *     uniform house shapes drawn at caption density — ShareMenu
 *     pills ≈28px, feed-card icon actions ≈32–36px, standalone
 *     secondary text links at 16–20px. Each now carries the K2
 *     negative-margin pattern sized to land exactly on a 44px
 *     hit area while the layout footprint (and so every page's
 *     spacing and density) is unchanged. Inline-in-sentence
 *     links stay exempt under the WCAG rule — the pins below
 *     cover standalone controls only.
 *
 *  2. The World SWITCH HITBOX (E2's frontier): TailDesks'
 *     settings switches are drawn h-6 w-11 — 44 wide, 24 tall —
 *     and the min-height utilities would stretch the pill and
 *     strand the knob. The third bdv-touch shape keeps the
 *     track's exact box and gives it an invisible ::after halo
 *     (10px above and below) inside the same coarse-pointer
 *     block: hit area 44×44 on touch, drawn size untouched,
 *     fine pointers pixel-identical.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const css = read("../index.css");
const shareMenu = read("../components/ShareMenu.tsx");
const postCard = read("../components/social/PostCard.tsx");
const reportButton = read("../components/social/ReportButton.tsx");
const tailDesks = read("../components/world/native/TailDesks.tsx");
const home = read("../pages/home.tsx");
const challenge = read("../pages/challenge.tsx");
const hashtag = read("../pages/hashtag.tsx");
const post = read("../pages/post.tsx");
const premiere = read("../pages/premiere.tsx");
const charts = read("../pages/discovery/charts.tsx");

const count = (src: string, needle: string) => src.split(needle).length - 1;

describe("touch patterns 2: ShareMenu pill row (28 → 44 hit, 28 footprint)", () => {
  it("the shared pill string carries the pattern — every ShareMenu surface rides it", () => {
    expect(shareMenu).toContain("bg-white/10 px-3 py-3.5 -my-2 text-xs font-bold");
    expect(shareMenu).not.toContain("bg-white/10 px-3 py-1.5");
  });

  it("the gold native-share pill — the row's primary — matches", () => {
    expect(shareMenu).toContain("bg-primary px-3 py-3.5 -my-2 text-xs font-black");
    expect(shareMenu).not.toContain("bg-primary px-3 py-1.5");
  });

  it("the compact card-row trigger grows from a 28px box to a 44px hit", () => {
    expect(shareMenu).toContain("bg-white/5 p-3.5 -m-2 text-white/60");
    expect(shareMenu).not.toContain("bg-white/5 p-1.5");
  });
});

describe("touch patterns 2: feed-card icon actions (32–36 → 44 hit, same density)", () => {
  it("Like (36, the 24px sticker + py-1.5) lands exactly on 44", () => {
    expect(postCard).toContain("px-2 py-[10px] -my-1 text-sm text-neutral-400 transition");
  });

  it("Reply and Repost (32, text-line + py-1.5) land exactly on 44", () => {
    expect(count(postCard, "px-2 py-3 -my-1.5 text-sm")).toBe(2);
  });

  it("the reaction picker (36, 28px sticker + p-1) lands exactly on 44", () => {
    expect(postCard).toContain("rounded-full p-2 -m-1 transition hover:scale-110");
  });

  it("the p-2 icon buttons (34) land exactly on 44 — Quote, analytics, Save, Share, Delete ×2", () => {
    expect(count(postCard, "p-[13px] -m-[5px]")).toBe(6);
    expect(postCard).not.toContain('aria-label="Quote" className="rounded-full p-2 ');
    expect(postCard).not.toContain('aria-label="Delete post" className="rounded-full p-2 ');
  });

  it("the ReportButton icon default that renders in the same row (32) lands on 44", () => {
    expect(reportButton).toContain('className ?? "rounded-full p-[14px] -m-[6px] text-neutral-400');
  });
});

describe("touch patterns 2: standalone secondary text links (16–20 → 44 hit)", () => {
  it("Browse all templates (home section header)", () => {
    expect(home).toContain("gap-1.5 py-3 -my-3 text-sm font-semibold text-primary");
  });

  it("Back to Shorts (challenge + hashtag page heads, margins rebalanced, spacing identical)", () => {
    for (const page of [challenge, hashtag]) {
      expect(page).toContain("py-3 -mt-3 mb-3 inline-flex items-center gap-2 text-sm");
      expect(page).not.toContain("mb-6 inline-flex items-center gap-2 text-sm");
    }
  });

  it("Back to your timeline (post page head)", () => {
    expect(post).toContain("py-3 -mt-3 mb-1 inline-flex items-center gap-1.5 text-sm font-semibold");
  });

  it("Back to the feed (premiere not-found)", () => {
    expect(premiere).toContain('className="py-3 -my-3 text-sm text-[#e8c86a] underline"');
  });

  it("All scenes (charts section header, 16px text-xs)", () => {
    expect(charts).toContain("gap-0.5 py-3.5 -my-3.5 text-xs font-bold");
  });

  it("the charts Browse row — verticals, genres, search (standalone nav row, not a sentence)", () => {
    expect(count(charts, "py-3 -my-3 font-bold text-[#e8c86a] hover:underline")).toBe(3);
  });

  it("PostCard's View-replies toggle (16px, margins split so its slot is unchanged)", () => {
    expect(postCard).toContain('className="py-3.5 -mt-1.5 -mb-3.5 text-xs font-semibold text-[#d4af37] hover:underline"');
  });
});

describe("touch patterns 2: the switch hitbox — third bdv-touch shape", () => {
  it("defines the switch utility exactly once, inside the coarse block", () => {
    expect(count(css, "\n  .bdv-touch-switch {")).toBe(1);
    expect(count(css, "\n  .bdv-touch-switch::after {")).toBe(1);
    const mediaIdx = css.indexOf("@media (pointer: coarse)");
    expect(css.indexOf(".bdv-touch-switch {")).toBeGreaterThan(mediaIdx);
    expect(css.indexOf(".bdv-touch-switch::after {")).toBeGreaterThan(mediaIdx);
    /* The first two shapes are untouched and still exactly once. */
    expect(count(css, "\n  .bdv-touch-target {")).toBe(1);
    expect(count(css, "\n  .bdv-touch-box {")).toBe(1);
  });

  it("the halo is 10px above and below — 24 + 10 + 10 = a 44px hit height", () => {
    const i = css.indexOf(".bdv-touch-switch::after {");
    const rule = css.slice(i, i + 160);
    expect(rule).toContain('content: ""');
    expect(rule).toContain("inset: -10px 0");
  });

  it("the switch rules paint nothing — no background, no colour, no border", () => {
    const i = css.indexOf(".bdv-touch-switch {");
    const rules = css.slice(i, css.indexOf("\n  }\n", css.indexOf(".bdv-touch-switch::after {")) + 4);
    expect(rules).not.toContain("background");
    expect(rules).not.toContain("color:");
    expect(rules).not.toContain("border");
  });

  it("TailDesks' shared track wears the halo and keeps its drawn box", () => {
    expect(tailDesks).toContain("bdv-touch-switch relative h-6 w-11 shrink-0 rounded-full");
    /* The knob is unmoved: still top-0.5, still h-5 w-5. */
    expect(tailDesks).toContain("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow");
    /* Both AccountDesk switch lists ride the one shared track. */
    expect(tailDesks).toContain('testidPrefix="world-account-pref"');
    expect(tailDesks).toContain('testidPrefix="world-account-delight"');
  });
});
