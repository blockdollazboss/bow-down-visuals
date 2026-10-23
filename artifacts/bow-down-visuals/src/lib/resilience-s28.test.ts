import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-28 §III — Dashboard-law resilience (board items 23–34, audit A3).
 *
 * The law: one bad section must never sink a page, a failed load is
 * never a fake empty / fake zero / fake "not found", and a section's
 * failure leaves the rest of the page alive. These suites pin each
 * item the way dashboard-sections.test.ts pins the dashboard: pure
 * helpers are unit-tested, and the page wiring is source-pinned
 * (render order matters — the failed branch must be gated BEFORE the
 * empty/not-found branch it used to fall into).
 */

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("#23 analytics-hub: failed overview ≠ 'not connected' (A3-F1)", () => {
  const page = src("../pages/analytics-hub.tsx");
  it("overview starts in flight so the first paint is never the Connect cards", () => {
    expect(page).toContain("const [loading, setLoading] = useState(true)");
  });
  it("loading with no overview renders skeletons, not the platform grid", () => {
    expect(page).toContain('data-testid="analytics-overview-loading"');
    const loadingAt = page.indexOf('data-testid="analytics-overview-loading"');
    const gridAt = page.indexOf("CONN_ALL_PLATFORMS.map((key)");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(gridAt).toBeGreaterThan(loadingAt);
  });
  it("failure with no overview renders ONE scoped error card with retry instead of the grid", () => {
    expect(page).toContain('data-testid="analytics-overview-error"');
    expect(page).toContain("overview === null && error");
    expect(page).toContain("overview === null && loading");
  });
  it("the Connect (not-connected) branch is only reachable inside the loaded-overview grid", () => {
    const gridAt = page.indexOf("CONN_ALL_PLATFORMS.map((key)");
    const connectAt = page.indexOf('p.status === "not_connected"');
    expect(connectAt).toBeGreaterThan(gridAt);
  });
  it("a refresh failure with data already loaded keeps the data (banner only, grid stays)", () => {
    expect(page).toContain("{error && overview && (");
  });
});
