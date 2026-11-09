/**
 * Beats — honest load states (Stack 400 C-28: the honest-load pin
 * layer completing the "empty lie" audit; census C-28 spot-checked
 * this page honest — per-section failure design — and unpinned).
 *
 * Three list loads, one machine each:
 *  - Browse and Dashboard ride the shared section-state machine
 *    (initialSectionStates / markSectionLoading / settleSection): a
 *    load marks its section "loading"; success settles ok; failure
 *    settles "failed" UNLESS the section already loaded once, in
 *    which case the loaded data stays on screen (the loaded-ref
 *    fallback in the catch). Each section renders loading → failed
 *    panel (data-testid, retry wired to the real loader) → empty.
 *  - The license-templates manager carries its own
 *    "loading" | "ok" | "failed" state with the same ordering.
 * This file pins those shapes in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM). The section
 * failure copy is hardcoded English in the page; the templates copy
 * goes through beats.* keys with defaultValue fallbacks — the keys
 * asserted below exist in en.json and are pinned for all 10
 * catalogs, where non-en catalogs may carry the key or rely on the
 * same defaultValue the page declares (checked per key).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./beats.tsx");

function slice(from: string, to: string): string {
  const a = page.indexOf(from);
  expect(a, `marker ${from}`).toBeGreaterThan(-1);
  return page.slice(a, page.indexOf(to, a));
}

describe("section machine — failure settles failed, never empty", () => {
  it("sections start in the shared machine and loads mark loading first", () => {
    expect(page).toContain("initialSectionStates(BEATS_SECTION_KEYS)");
    expect(page).toContain('setSectionStates((prev) => markSectionLoading(prev, "browse"));');
    expect(page).toContain('setSectionStates((prev) => markSectionLoading(prev, "dashboard"));');
  });

  it("the browse loader throws on non-ok, settles ok on success, and settles by the loaded-ref on failure", () => {
    const loader = slice("const res = await fetch(`/api/beats?${q.toString()}`);", "async function");
    expect(loader).toContain('if (!res.ok) throw new Error("load failed");');
    expect(page).toContain('setSectionStates((prev) => settleSection(prev, "browse", true));');
    expect(page).toContain('setSectionStates((prev) => settleSection(prev, "browse", beatsLoadedRef.current));');
  });

  it("the dashboard loader settles by the same rule", () => {
    expect(page).toContain('setSectionStates((prev) => settleSection(prev, "dashboard", true));');
    expect(page).toContain('setSectionStates((prev) => settleSection(prev, "dashboard", dashLoadedRef.current));');
  });
});

describe("render — loading, then the failure panel, and only then empty", () => {
  it("browse reaches its empty state only after the loading and failed branches", () => {
    const loadingAt = page.indexOf('sectionStates.browse === "loading" ? (');
    const failedAt = page.indexOf('sectionStates.browse === "failed" ? (');
    const emptyAt = page.indexOf(") : beats.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(failedAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(failedAt);
  });

  it("dashboard renders its failure panel before any of its lists' empty states", () => {
    const failedAt = page.indexOf('sectionStates.dashboard === "failed" ? (');
    const emptyAt = page.indexOf("buyerLicenses.length === 0 ? (");
    expect(failedAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(failedAt);
  });

  it("both failure panels carry a testid and a retry wired to the real loader", () => {
    expect(page).toContain('data-testid="beats-browse-failure"');
    expect(page).toContain('data-testid="beats-dashboard-failure"');
    expect(page).toContain("onClick={() => fetchBeats()}");
    expect(page).toContain("onClick={() => fetchDashboard()}");
    expect(page).toContain("Couldn't load beats.");
    expect(page).toContain("Couldn't load your dashboard.");
  });
});

describe("license templates — its own loading | ok | failed machine", () => {
  it("the loader throws on non-ok and settles failed in its catch", () => {
    const loader = slice("async function loadTemplates()", "useEffect(() => { void loadTemplates(); }, []);");
    expect(loader).toContain('setLoadState("loading");');
    expect(loader).toContain('if (!res.ok) throw new Error("load failed");');
    expect(loader).toContain('setLoadState("ok");');
    expect(loader).toContain('setLoadState("failed");');
  });

  it("the empty note renders only after the loading and failed branches", () => {
    const loadingAt = page.indexOf('loadState === "loading" ? (');
    const failedAt = page.indexOf('loadState === "failed" ? (');
    const emptyAt = page.indexOf("templates.length === 0 && !form ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(failedAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(failedAt);
    expect(page).toContain("onClick={() => void loadTemplates()}");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
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
  it.each(LOCALES)("%s carries the beats honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["beats.emptyBrowse", "beats.templatesLoadFailed", "beats.templatesEmpty", "beats.retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
