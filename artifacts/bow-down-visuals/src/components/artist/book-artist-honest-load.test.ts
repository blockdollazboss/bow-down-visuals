/**
 * BookArtistSection — honest load states (Stack-200 hardening D1,
 * census section A item 3: the "empty lie" family).
 *
 * Before: refresh()'s catch did setBookings([]), walking the state
 * null → [] straight onto the "No show bookings yet" copy — a failed
 * load hid escrow bookings, and a failed REFRESH wiped bookings
 * already on screen.
 *
 * After: failure sets only a failed flag. Bookings stay null on a
 * failed first load (error state with retry renders instead of the
 * empty copy) and stay on screen on a failed refresh (error banner
 * above them). The empty copy renders only after a successful load
 * that genuinely returned nothing, with no failure outstanding.
 *
 * The FE suite runs in node (no DOM), so — like the sibling pins —
 * these tests pin the state machine in source. Copy keys are English
 * in en.json; the other nine catalogs carry the English verbatim as
 * UNREVIEWED placeholders.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const section = read("./BookArtistSection.tsx");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("failure path — bookings never read as empty on a failed load", () => {
  it("the refresh catch raises the failed flag and never writes bookings", () => {
    expect(section).toContain("setLoadFailed(true)");
    expect(section).not.toContain("setBookings([])");
    expect(section).not.toMatch(/catch \{\s*setBookings/);
  });

  it("a successful load clears the failed flag", () => {
    expect(section).toContain("setLoadFailed(false)");
  });

  it("failure renders an error state with a retry wired to the real refresh", () => {
    expect(section).toContain('data-testid="book-artist-load-error"');
    expect(section).toContain('t("bookArtist.loadError")');
    expect(section).toContain("onClick={() => void refresh()}");
    expect(section).toContain('t("bookArtist.retry")');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the pending state renders only while loading without a failure", () => {
    expect(section).toContain("user && bookings === null && !loadFailed");
    expect(section).toContain("Loading bookings…");
  });

  it("the empty copy renders only on a successful empty load with no failure outstanding", () => {
    expect(section).toContain("bookings !== null && bookings.length === 0 && !loadFailed");
    expect(section).toContain("No show bookings yet.");
  });

  it("a failed refresh cannot wipe the list: the list branch never checks the failed flag", () => {
    expect(section).toContain("bookings !== null && bookings.length > 0");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the bookArtist honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../../locales/${loc}.json`)));
    for (const k of ["bookArtist.loadError", "bookArtist.retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
