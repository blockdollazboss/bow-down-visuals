/**
 * Song Mashup library picker — honest load state (Stack-200 hardening
 * D2, census section A item 21: the "empty lie" family).
 *
 * Before: loadSongs set the library only `if (res.ok)` and the catch
 * was "library is optional — uploads still work" — the A/B selects
 * showed only the placeholder, identical for a failed library read
 * and a genuinely empty library. After: failure raises songsError
 * and a "Your library couldn't load — try again" note renders above
 * the pickers (uploads genuinely do still work); a successful load
 * clears the flag.
 *
 * The FE suite runs in node (no DOM), so — like the sibling honest-load
 * pins — these tests pin the state machine in source: which setter each
 * load outcome calls, and which render branch each state reaches. The
 * new copy keys are English in en.json; the other nine catalogs carry
 * the English verbatim as UNREVIEWED placeholders.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const mashup = read("./SongMashup.tsx");
const loadAt = mashup.indexOf("const loadSongs = useCallback(async () => {");
const loader = mashup.slice(loadAt, mashup.indexOf("}, [getAccessToken]);", loadAt));

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

describe("failure path — a failed library read is a note, not an empty-looking picker", () => {
  it("the loader throws on a non-ok response and records the failure in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error("songs load failed");');
    expect(loader).toContain("setSongsError(true)");
    expect(loader).not.toContain("if (res.ok) setSongs(");
  });

  it("a successful load clears the failed flag", () => {
    expect(loader).toContain("setSongsError(false)");
  });

  it("failure renders the note with a retry wired to the real load, above the pickers", () => {
    expect(mashup).toContain('data-testid="mashup-songs-load-error"');
    expect(mashup).toContain('t("mashup.songsLoadError")');
    expect(mashup).toContain('t("mashup.songsRetry")');
    expect(mashup).toContain("void loadSongs()");
    const noteAt = mashup.indexOf('data-testid="mashup-songs-load-error"');
    const pickersAt = mashup.indexOf('<SongPicker side="A" />');
    expect(noteAt).toBeGreaterThan(-1);
    expect(pickersAt).toBeGreaterThan(noteAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the mashup honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["mashup.songsLoadError", "mashup.songsRetry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
