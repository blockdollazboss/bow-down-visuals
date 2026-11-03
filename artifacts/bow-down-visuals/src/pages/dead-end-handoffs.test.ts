/**
 * dead-end-handoffs.test.ts — org wave (stack1400), audit §1d pins.
 *
 * Company law (ONE-WEBSITE FEEL / NOTHING DIFFICULT): a page that ends
 * a workflow must hand off to its real next step. The Nov 2 tightening
 * audit named two dead-end clusters in scope here (the ~20-page SEO
 * island cluster is explicitly a later lane):
 *
 *   (a) Earnings — the MONEY step. Its zero state already handed back
 *       at $0 (pinned in dead-end-doors.test.ts), but a creator WITH
 *       earnings had no door onward to the managers behind the
 *       numbers.
 *   (b) Tour / Setlist — Tour's only doors were the hero setlist link
 *       and checklist scheduler links (dates-gated, expandable);
 *       Setlist's only doors were "back to dashboard" and a modal link.
 *
 * Each fix is pinned the same way as dead-end-doors.test.ts: the
 * hand-off section exists, every door inside it points at a route
 * that exists in App.tsx, and the door elements themselves are
 * unconditional (the themed container may branch on isLight — the
 * doors do not, so both themes get them).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const app = read("App.tsx");
const earnings = read("pages/earnings.tsx");
const tour = read("pages/tour.tsx");
const setlist = read("pages/setlist.tsx");

/** The block of `src` starting at `marker`. */
function blockAfter(src: string, marker: string, span = 3200): string {
  const i = src.indexOf(marker);
  expect(i, `marker not found: ${marker}`).toBeGreaterThanOrEqual(0);
  return src.slice(i, i + span);
}

/** One door element, from its testid to the end of its Link. */
function door(src: string, testid: string): string {
  const block = blockAfter(src, `data-testid="${testid}"`, 700);
  return block.slice(0, block.indexOf("</Link>"));
}

describe("hand-off targets are real routes", () => {
  for (const route of [
    "/tips",
    "/memberships",
    "/my-shop",
    "/store/dashboard",
    "/setlist",
    "/shows",
    "/go-live",
    "/promote",
    "/tour",
  ]) {
    it(`${route} exists in App.tsx`, () => {
      expect(app).toContain(`path="${route}"`);
    });
  }
});

describe("Earnings — always-on onward hand-offs (not just at $0)", () => {
  it("the next-steps section renders after the money picture, past the zero state", () => {
    expect(earnings.indexOf('data-testid="earnings-next-steps"')).toBeGreaterThan(
      earnings.indexOf('data-testid="earnings-zero-next-steps"'),
    );
    expect(earnings.indexOf('data-testid="earnings-next-steps"')).toBeGreaterThan(
      earnings.indexOf("<ConnectPayoutCard"),
    );
  });

  it("carries doors to the managers behind the numbers", () => {
    const block = blockAfter(earnings, 'data-testid="earnings-next-steps"');
    expect(block).toContain('href="/tips"');
    expect(block).toContain('href="/memberships"');
    expect(block).toContain('href="/my-shop"');
    expect(block).toContain('href="/store/dashboard"');
  });

  it("each door is one unconditional element (both themes reach it)", () => {
    for (const testid of [
      "earnings-handoff-tips",
      "earnings-handoff-memberships",
      "earnings-handoff-my-shop",
      "earnings-handoff-store-dashboard",
    ]) {
      expect(door(earnings, testid)).not.toContain("isLight");
    }
  });
});

describe("Tour — onward hand-offs at the end of the planner", () => {
  it("the next-steps section exists, after the promo checklist", () => {
    expect(tour.indexOf('data-testid="tour-next-steps"')).toBeGreaterThan(
      tour.indexOf('data-testid="btn-retry-dates"'),
    );
  });

  it("carries doors to setlist, shows, go-live and promote", () => {
    const block = blockAfter(tour, 'data-testid="tour-next-steps"');
    expect(block).toContain('href="/setlist"');
    expect(block).toContain('href="/shows"');
    expect(block).toContain('href="/go-live"');
    expect(block).toContain('href="/promote"');
  });

  it("each door is one unconditional element (both themes reach it)", () => {
    for (const testid of [
      "tour-handoff-setlist",
      "tour-handoff-shows",
      "tour-handoff-go-live",
      "tour-handoff-promote",
    ]) {
      expect(door(tour, testid)).not.toContain("isLight");
    }
  });

  it("the pre-existing hero setlist link and checklist scheduler doors are untouched", () => {
    expect(tour).toContain('href="/setlist"');
    expect(tour).toContain("buildPromoChecklist");
  });
});

describe("Setlist — onward hand-offs after the setlist", () => {
  it("the next-steps section exists and stays off the printed setlist", () => {
    const block = blockAfter(setlist, 'data-testid="setlist-next-steps"', 400);
    expect(block).toContain("no-print");
  });

  it("carries doors to tour, shows, go-live and promote", () => {
    const block = blockAfter(setlist, 'data-testid="setlist-next-steps"');
    expect(block).toContain('href="/tour"');
    expect(block).toContain('href="/shows"');
    expect(block).toContain('href="/go-live"');
    expect(block).toContain('href="/promote"');
  });

  it("each door is one unconditional element (both themes reach it)", () => {
    for (const testid of [
      "setlist-handoff-tour",
      "setlist-handoff-shows",
      "setlist-handoff-go-live",
      "setlist-handoff-promote",
    ]) {
      expect(door(setlist, testid)).not.toContain("isLight");
    }
  });

  it("the pre-existing dashboard back-link is untouched", () => {
    expect(setlist).toContain('href="/dashboard"');
  });
});
