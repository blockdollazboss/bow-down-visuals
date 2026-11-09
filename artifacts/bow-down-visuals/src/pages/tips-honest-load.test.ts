/**
 * Tips (Tip Jar dashboard) — honest load states (Stack 400 C-28:
 * the honest-load pin layer completing the "empty lie" audit).
 *
 * The dashboard is one payload (the feed and goal history are
 * fields of it), and it already carries the full machine: the load
 * raises loadError on failure, and the render reaches the dashboard
 * content — including the feed's "no tips yet" line — only after
 * the loading and error branches, with the error panel's retry
 * wired to the real loader. What was missing is the PIN; this file
 * pins the shape in source, like the sibling honest-load pins (the
 * FE suite runs in node, no DOM). The error copy is hardcoded
 * English in the page, so the literals are pinned; the feed's empty
 * key rides the catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./tips.tsx");

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
const KEYS = ["tips.noTipsYet"];

describe("failure path — a failed dashboard load never reads as an empty tip jar", () => {
  it("the page carries a dedicated loadError state for the dashboard load", () => {
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
    expect(page).toContain("const [loading, setLoading] = useState(true);");
  });

  it("failure renders its own panel, worded as a failure, with a retry wired to the real loader", () => {
    expect(page).toContain("Couldn't load your Tip Jar.");
    expect(page).toContain("your tip page is safe, this dashboard just couldn't reach it.");
    expect(page).toContain("onClick={() => void load()}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the dashboard content renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : loadError ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
  });

  it("the feed's empty line lives inside the loaded dashboard, downstream of both branches", () => {
    const errorAt = page.indexOf(") : loadError ? (");
    const emptyAt = page.indexOf("{dashboard.feed.length === 0 && (", errorAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the tips empty key", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of KEYS) expect(typeof cat[k] === "string" && cat[k].length > 0).toBe(true);
  });
});
