/**
 * dead-end-doors.test.ts — Lane J3 (stack900) dead-end audit pins.
 *
 * Company law (NOTHING DIFFICULT): an empty state, an error state, or a
 * success moment that names its next step but offers no door to it is a
 * defect. The audit found five live instances; each fix is pinned here:
 * the door exists, it sits INSIDE the state it rescues (after the state
 * marker in source order), it points at a route that exists in App.tsx,
 * and it renders unconditionally within the state block — the themed
 * container branches on isLight, the door does not, so both themes get it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const app = read("App.tsx");
const myMusic = read("pages/my-music.tsx");
const earnings = read("pages/earnings.tsx");
const memberships = read("pages/memberships.tsx");
const saved = read("pages/saved.tsx");

/** The block of `src` starting at `marker` — used to prove a door lives
 *  inside the state it belongs to, not somewhere else on the page. */
function blockAfter(src: string, marker: string, span = 2400): string {
  const i = src.indexOf(marker);
  expect(i, `marker not found: ${marker}`).toBeGreaterThanOrEqual(0);
  return src.slice(i, i + span);
}

describe("dead-end doors — targets are real routes", () => {
  for (const route of ["/storefronts", "/explore", "/brand-deals", "/my-shop", "/promote"]) {
    it(`${route} exists in App.tsx`, () => {
      expect(app).toContain(`path="${route}"`);
    });
  }
});

describe("My Music — empty library door", () => {
  it("the empty state carries a door to /storefronts", () => {
    const block = blockAfter(myMusic, "Nothing here yet");
    expect(block).toContain('data-testid="my-music-browse-drops"');
    expect(block).toContain('href="/storefronts"');
    expect(block).toContain("Browse the drops");
  });

  it("the door is one unconditional element (both themes reach it)", () => {
    const block = blockAfter(myMusic, 'data-testid="my-music-browse-drops"', 400);
    const doorOnly = block.slice(0, block.indexOf("</Link>"));
    expect(doorOnly).not.toContain("isLight");
    expect(doorOnly).toContain("Browse the drops");
  });
});

describe("Earnings — every failure surface has a working retry", () => {
  it("one shared reload backs the page", () => {
    expect(earnings).toContain("const reload = () => { setFailed(false); setData(null); setReloadKey((k) => k + 1); };");
    expect(earnings).toContain("onClick={reload}");
  });

  it("all four source cards receive the retry", () => {
    expect(earnings.match(/onRetry=\{reload\}/g)).toHaveLength(4);
    const block = blockAfter(earnings, 'data-testid="earnings-source-retry"', 500);
    expect(block).toContain("Try again");
    expect(earnings).toContain("onClick={onRetry}");
  });

  it("the tips card error carries its own retry button", () => {
    const block = blockAfter(earnings, 'sources.tips.status === "error"', 900);
    expect(block).toContain('data-testid="earnings-tips-retry"');
    expect(block).toContain("onClick={reload}");
  });

  it("the pending-payout card re-runs its own fetch on retry", () => {
    expect(earnings).toContain('data-testid="earnings-payout-retry"');
    expect(earnings).toContain("}, [getToken, reloadKey]);");
  });
});

describe("Earnings — zero state hands back to the surfaces that fill it", () => {
  it("renders only on a complete honest zero (never over a partial load)", () => {
    expect(earnings).toContain('data-testid="earnings-zero-next-steps"');
    expect(earnings).toContain("data.totalCents === 0 && !data.partial");
  });

  it("carries the three doors: sell, deals, promote", () => {
    const block = blockAfter(earnings, 'data-testid="earnings-zero-next-steps"', 2600);
    expect(block).toContain('href="/my-shop"');
    expect(block).toContain('href="/brand-deals"');
    expect(block).toContain('href="/promote"');
  });
});

describe("Memberships — 'Your memberships' empty door", () => {
  it("the empty fan-club card carries a door to /explore", () => {
    const block = blockAfter(memberships, "You're not a member of any fan club yet");
    expect(block).toContain('data-testid="memberships-find-creators"');
    expect(block).toContain('href="/explore"');
    expect(block).toContain("Find creators to join");
  });
});

describe("Saved — empty bookmarks door", () => {
  it("the empty state carries a door to /explore", () => {
    const block = blockAfter(saved, "Nothing saved here yet");
    expect(block).toContain('data-testid="saved-explore-door"');
    expect(block).toContain('href="/explore"');
    expect(block).toContain("Explore what's out there");
  });

  it("the pre-existing error retry is untouched", () => {
    expect(saved).toContain("setRetryNonce((n) => n + 1)");
  });
});
