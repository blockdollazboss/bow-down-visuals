/**
 * Charts (/charts) — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * All four tabs (Charts / Breaking / Earners / For Brands) ride one
 * effect whose payloads come from getJson(), which returns null
 * ONLY on failure (non-ok or network) — the page's own comment
 * states the law ("Null must land in loadError, never be coerced
 * to an empty state"). The shared LoadErrorBox renders in every
 * tab with a retry bumping retryNonce to re-run the real effect,
 * and each tab's EmptyState renders only after its loading and
 * error branches. This file pins that shape in source, like the
 * sibling honest-load pins (the FE suite runs in node, no DOM).
 * The error/empty copy is hardcoded English in the page, so the
 * literals are pinned and there is no catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./charts.tsx");
const helper = page.slice(page.indexOf("async function getJson"), page.indexOf("function VerticalSwitcher"));
const loadAt = page.indexOf("getJson returns null ONLY on failure");
const loader = page.slice(loadAt, page.indexOf("const creatorIds", loadAt));

describe("failure path — a failed charts load never reads as an empty chart", () => {
  it("the fetch helper returns null on a non-ok response", () => {
    expect(helper).toContain("if (!r.ok) return null;");
  });

  it("every tab's loader records the error state on failure and data on success", () => {
    expect(loader).toContain("if (!d) { setLoadError(true); } else {");
    expect(loader).toContain("setRising(d.rising ?? []);");
    expect(loader).toContain("setEarners(d.earners ?? []);");
    expect(loader).toContain("setBrands(d.creators ?? []);");
    expect(loader).toContain("setLoading(false);");
  });

  it("the state machine starts loading with a distinct error state", () => {
    expect(page).toContain("const [loading, setLoading] = useState(true);");
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("failure renders the shared error box with a retry wired to the real load", () => {
    expect(page).toContain("Couldn't load the charts.");
    expect(page).toContain("this isn't an empty chart, it's a failed load.");
    expect(page).toContain("<LoadErrorBox onRetry={() => setRetryNonce((n) => n + 1)} />");
    expect(page).toContain("Try again");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the charts tab's empty state renders only after the error and loading branches", () => {
    const errorAt = page.indexOf("<LoadErrorBox onRetry={() => setRetryNonce((n) => n + 1)} />");
    const loadingAt = page.indexOf("loading || !data", errorAt);
    const emptyAt = page.indexOf('title="No chart-toppers here yet"', errorAt);
    expect(errorAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(errorAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
  });

  it("every other tab's empty state also renders after an error branch", () => {
    const errorAt = page.indexOf("<LoadErrorBox onRetry={() => setRetryNonce((n) => n + 1)} />");
    for (const title of [
      'title="Nothing breaking right this second"',
      'title="No earners on the board yet"',
      'title="No creators to scout here yet"',
    ]) {
      expect(page.indexOf(title)).toBeGreaterThan(errorAt);
    }
  });
});
