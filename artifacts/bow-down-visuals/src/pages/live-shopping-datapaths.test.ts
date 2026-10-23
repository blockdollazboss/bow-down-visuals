/**
 * live-shopping-datapaths.test.ts — S27-27: catalog / streams /
 * dashboard settle per source (dashboard per-section pattern).
 *
 * The defect: one Promise.all + a combined ok-check threw before ANY
 * state was applied, so one failing source blanked all three tabs.
 * The contract pinned here:
 *  (a) each source has its own loader that applies its own state and
 *      records its own error flag;
 *  (b) the page-level error is set only when all three sources fail;
 *  (c) each tab renders its section error card with a retry that
 *      refetches only that source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./live-shopping.tsx", import.meta.url), "utf8");

describe("live shopping — per-source settle", () => {
  it("each source carries its own error state and loader", () => {
    expect(page).toContain("const [catalogError, setCatalogError] = useState(false)");
    expect(page).toContain("const [streamsError, setStreamsError] = useState(false)");
    expect(page).toContain("const [dashboardError, setDashboardError] = useState(false)");
    expect(page).toContain("loadCatalogSection");
    expect(page).toContain("loadStreamsSection");
    expect(page).toContain("loadDashboardSection");
  });

  it("the old throw-before-set combined check is gone", () => {
    expect(page).not.toContain("!catRes.ok || !streamRes.ok || !dashRes.ok");
  });

  it("the page-level error fires only on a total failure", () => {
    expect(page).toContain('if (!catOk && !streamOk && !dashOk) setError(t("liveShopping.errLoad"));');
  });

  it("each tab renders its own section error card with a per-source retry", () => {
    expect(page).toContain("sectionErrorCard(() => void loadCatalogSection())");
    expect(page).toContain("sectionErrorCard(() => void loadStreamsSection())");
    expect(page).toContain("sectionErrorCard(() => void loadDashboardSection())");
  });
});
