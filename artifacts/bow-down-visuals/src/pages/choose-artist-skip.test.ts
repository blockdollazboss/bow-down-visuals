/**
 * Choose Artist — the "Skip for now" control must be a REAL control.
 *
 * Proven live on staging @ b26d38b87 (Nov 10, 2026): clicking
 * "Skip for now" did nothing for two different signed-in accounts.
 * The handler was the only navigation on the page deferred behind an
 * awaited network call — and that call (fetchMyProfile) sends no
 * auth token, so it takes a 401 from requireAuth and can only
 * complete through the session guard's token-refresh-and-retry
 * detour before setLocation is ever reached. The sibling "Use
 * artist" button navigates synchronously and worked. These pins hold
 * the fixed shape: Skip records the visit's "not now", navigates
 * synchronously to /dashboard, and the one gate that could bounce
 * the user back (the homepage's no-artist redirect) respects the
 * skip. Choosing an artist still works exactly as before.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./choose-artist.tsx");
const home = read("./home.tsx");
const context = read("../contexts/ActiveArtistContext.tsx");

function block(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `marker found: ${startMarker}`).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }", start);
  expect(end, `block closes: ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("skip navigates — synchronously, with no network in the click path", () => {
  const skip = block(page, "function handleContinueWithout()");

  it("lands on /dashboard, the same destination choosing an artist uses", () => {
    expect(skip).toContain('setLocation("/dashboard")');
  });

  it("records the visit's skip and clears any stale pick, in that order", () => {
    expect(skip).toContain("setActiveArtist(null);");
    expect(skip).toContain("skipArtistChoice();");
    expect(skip.indexOf("skipArtistChoice();")).toBeLessThan(skip.indexOf('setLocation("/dashboard")'));
  });

  it("never awaits anything — no fetch can hold the click hostage again", () => {
    expect(skip).not.toContain("await");
    expect(skip).not.toContain("fetchMyProfile");
    expect(skip).not.toContain("fetch(");
  });

  it("the tokenless profile fetch is gone from the page entirely", () => {
    expect(page).not.toContain("fetchMyProfile");
    expect(page).not.toContain('from "@/lib/artist-profiles"');
  });

  it("the button is wired to the handler", () => {
    expect(page).toContain('data-testid="btn-continue-without"');
    expect(page).toContain("onClick={handleContinueWithout}");
    expect(page).toContain('t("chooseArtist.skipForNow")');
  });

  it("the page takes the skip recorder from the active-artist context", () => {
    expect(page).toContain("const { activeArtist, setActiveArtist, skipArtistChoice } = useActiveArtist();");
  });
});

describe("skip does not bounce back — the homepage gate respects it", () => {
  it("the redirect only fires when the pick is neither made nor skipped", () => {
    expect(home).toContain("if (!authLoading && user && !activeArtist && !artistChoiceSkipped) {");
    expect(home).toContain('setLocation("/choose-artist");');
  });

  it("the no-flash guard matches: a skipped user sees the homepage", () => {
    expect(home).toContain("if (authLoading || (user && !activeArtist && !artistChoiceSkipped)) return null;");
  });

  it("the homepage reads the skip state from the same context", () => {
    expect(home).toContain("const { activeArtist, artistChoiceSkipped } = useActiveArtist();");
  });
});

describe("the skip state itself — context wiring", () => {
  it("skipArtistChoice records the skip durably for the visit", () => {
    const skipFn = block(context, "function skipArtistChoice()");
    expect(skipFn).toContain("writeArtistChoiceSkipped(true);");
    expect(skipFn).toContain("setArtistChoiceSkippedState(true);");
  });

  it("the provider seeds from storage and exposes both halves", () => {
    expect(context).toContain("() => readArtistChoiceSkipped(),");
    expect(context).toContain("artistChoiceSkipped, skipArtistChoice,");
  });

  it("choosing an artist clears the skip — the question is answered", () => {
    const setFn = block(context, "function setActiveArtist(artist: ArtistVault | null) {");
    expect(setFn).toContain("if (artist) {");
    expect(setFn).toContain("writeArtistChoiceSkipped(false);");
    expect(setFn).toContain("setArtistChoiceSkippedState(false);");
  });
});

describe("choosing an artist still works as before", () => {
  const use = block(page, "function handleUseArtist()");

  it("still sets the picked vault and goes to /dashboard", () => {
    expect(use).toContain("setActiveArtist(vault);");
    expect(use).toContain('setLocation("/dashboard")');
  });

  it("the Use button stays gated on a selection", () => {
    expect(page).toContain('data-testid="btn-use-artist"');
    expect(page).toContain("disabled={!selectedId}");
    expect(page).toContain("onClick={handleUseArtist}");
  });
});
