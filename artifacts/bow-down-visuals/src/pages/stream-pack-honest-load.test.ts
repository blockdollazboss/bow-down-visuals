/**
 * Stream Pack library — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * The durable library load already carries the honest machine —
 * its comment states the law ("A failed load is an honest error
 * with a retry, never a fake empty shelf"). loadLibrary() records
 * libraryError in its catch, and the render shows the error row
 * (with a retry wired to the real loader), the loading row only
 * while the library is still null with no error, and the empty
 * line only for a loaded, genuinely empty library with no error.
 * What was missing is the PIN; this file pins the shape in source,
 * like the sibling honest-load pins (the FE suite runs in node,
 * no DOM).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./stream-pack.tsx");
const loadAt = page.indexOf("async function loadLibrary() {");
const loader = page.slice(loadAt, page.indexOf("useEffect(() => {", loadAt));

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
const KEYS = ["streamPack.libraryError", "streamPack.libraryLoading", "streamPack.libraryEmpty", "streamPack.retry"];

describe("failure path — a failed library load never reads as an empty shelf", () => {
  it("the loader records the error state in its catch and clears it on success", () => {
    expect(loader).toContain('setLibraryError(t("streamPack.libraryError"));');
    expect(loader).toContain("setLibraryError(null);");
    expect(page).toContain("never a fake empty shelf");
  });

  it("failure renders the error row with a retry wired to the real loader", () => {
    expect(page).toContain("{libraryError && (");
    expect(page).toContain("onClick={() => void loadLibrary()}");
    expect(page).toContain('data-testid="stream-pack-library"');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the loading row shows only while the library is null with no error", () => {
    expect(page).toContain("{library === null && !libraryError && (");
  });

  it("the empty line shows only for a loaded, genuinely empty library with no error", () => {
    expect(page).toContain("{library !== null && library.length === 0 && !libraryError && (");
    expect(page).toContain("{library !== null && library.length > 0 && (");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the stream-pack library keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of KEYS) expect(typeof cat[k] === "string" && cat[k].length > 0).toBe(true);
  });
});
