/**
 * Email List Builder (/email-list) — honest load states (Stack 400
 * C-28: the honest-load pin layer completing the "empty lie" audit).
 *
 * Both collection loads already carry the honest machine — the
 * page's own comments state the law ("Lists-load failures are NOT
 * 'no lists yet'"; "Subscriber-load failures are NOT 'no
 * subscribers yet'"). loadLists() throws on a non-ok answer and its
 * catch sets loadError (guarded by listsLoadedRef so a failed
 * reload never blanks lists already on screen); the dashboard
 * render reaches the genuine no-lists panel only after the loading
 * and loadError branches, and the error box's retry bumps
 * retryNonce to re-run the real loader. loadSubscribers() mirrors
 * it with subsLoadError / subsRetryNonce, scoped to the dashboard
 * section. This file pins that shape in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM). The error
 * box copy is hardcoded English in the page and pinned as literals;
 * the empty panel's copy rides an i18n key, which gets the catalog
 * block below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./email-list.tsx");
const listsAt = page.indexOf("const loadLists = useCallback(async () => {");
const listsLoader = page.slice(listsAt, page.indexOf("const loadSubscribers = useCallback", listsAt));
const subsAt = page.indexOf("const loadSubscribers = useCallback(async (listId: string) => {");
const subsLoader = page.slice(subsAt, page.indexOf("useEffect(() => {", subsAt));

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

describe("failure path — a failed lists load never reads as no lists yet", () => {
  it("the lists loader throws on a non-ok response and records the error state in its catch", () => {
    expect(listsLoader).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn\'t load your lists."));');
    expect(listsLoader).toContain("if (!listsLoadedRef.current) setLoadError(true);");
  });

  it("a successful lists load records the lists and always clears loading", () => {
    expect(listsLoader).toContain("setLists(data.lists ?? []);");
    expect(listsLoader).toContain("listsLoadedRef.current = true;");
    expect(listsLoader).toContain("setLoading(false);");
  });

  it("the page starts loading with a distinct lists error state", () => {
    expect(page).toContain("const [loading, setLoading] = useState(true);");
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("failure renders the error box with a retry wired to the real loader", () => {
    expect(page).toContain("Couldn't load your lists.");
    expect(page).toContain("your lists and subscribers are safe, this page just couldn't load them.");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(page).toContain("Try again");
  });

  it("the subscribers loader mirrors it with its own scoped error state and retry", () => {
    expect(subsLoader).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn\'t load subscribers."));');
    expect(subsLoader).toContain("setSubscribers(data.subscribers ?? []);");
    expect(subsLoader).toContain("if (subsLoadedForRef.current !== listId) setSubsLoadError(true);");
    expect(page).toContain("Couldn't load your subscribers.");
    expect(page).toContain("onClick={() => setSubsRetryNonce((n) => n + 1)}");
    expect(page).toContain("{subsLoadError ? (");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the no-lists panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : loadError ? (");
    const emptyAt = page.indexOf(") : !activeList ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("email-list.no_lists_yet")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the email-list honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["email-list.no_lists_yet"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
