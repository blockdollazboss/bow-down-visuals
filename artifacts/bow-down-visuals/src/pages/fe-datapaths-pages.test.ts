/**
 * fe-datapaths-pages.test.ts — S27-31/32/36/37/47: per-source settle
 * (dashboard per-section pattern) across the remaining pages.
 *
 * The shared defect shape: several sources loaded in one all-or-
 * nothing block, so any single failure replaced data that had loaded
 * fine with a page/section-wide error (or an ErrorBox over a loaded
 * grid). The contract pinned per page:
 *  - memberships: tiers/dashboard/members settle via allSettled; the
 *    page-wide loadError fires only when all three fail; each source
 *    carries its own section error.
 *  - dj-set-prep: library and crates settle independently; a crates
 *    failure never hides the library (and vice versa).
 *  - shoutouts: creator-tab settings/requests/revenue settle per
 *    source, each with its own panel error; the full-tab card is
 *    reserved for all three failing before anything ever loaded.
 *  - groups: the auxiliary member-badge query fails soft (inline
 *    note) — it never ErrorBoxes the loaded grid.
 *  - nfc-cards: profiles and orders are separate lists with separate
 *    loaders and error states; the combined card fires only when
 *    both fail before either ever loaded.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const memberships = readFileSync(new URL("./memberships.tsx", import.meta.url), "utf8");
const dj = readFileSync(new URL("./songs/dj-set-prep.tsx", import.meta.url), "utf8");
const shoutouts = readFileSync(new URL("./shoutouts.tsx", import.meta.url), "utf8");
const groups = readFileSync(new URL("./groups.tsx", import.meta.url), "utf8");
const nfc = readFileSync(new URL("./nfc-cards.tsx", import.meta.url), "utf8");

describe("memberships — tiers/dashboard/members settle per source (S27-31)", () => {
  it("loads via allSettled with per-source error states", () => {
    expect(memberships).toContain("Promise.allSettled([");
    expect(memberships).toContain("const [tiersError, setTiersError] = useState(false)");
    expect(memberships).toContain("const [dashboardError, setDashboardError] = useState(false)");
    expect(memberships).toContain("const [membersError, setMembersError] = useState(false)");
  });

  it("applies each source that succeeded and reserves loadError for a total failure", () => {
    expect(memberships).toContain("if (tOk) setTiers(");
    expect(memberships).toContain("if (dOk) setDashboard(");
    expect(memberships).toContain("if (mOk) setMembers(");
    expect(memberships).toContain("if (!tOk && !dOk && !mOk) {");
    expect(memberships).not.toContain("Nothing is applied on failure");
  });

  it("the members empty state gates on the members error, not the page error", () => {
    expect(memberships).toContain(") : !membersError ? (");
  });
});

describe("dj set prep — library and crates settle independently (S27-32)", () => {
  it("each source has its own loader and error state", () => {
    expect(dj).toContain("const [libError, setLibError] = useState(false)");
    expect(dj).toContain("const [cratesError, setCratesError] = useState(false)");
    expect(dj).toContain("loadLibrarySection");
    expect(dj).toContain("loadCratesSection");
  });

  it("the throw-before-set combined check is gone; the page error needs both down", () => {
    expect(dj).not.toContain("if (!libRes.ok) throw new Error(lib.error || t(\"djSets.errorLoad\"));\n      if (!crateRes.ok)");
    expect(dj).toContain('if (!libOk && !cratesOk) setError(t("djSets.errorLoad"));');
  });
});

describe("shoutouts — creator tab settles per source (S27-36)", () => {
  it("settings, requests and revenue have their own loaders and error states", () => {
    expect(shoutouts).toContain("async function fetchSettingsSection(): Promise<boolean>");
    expect(shoutouts).toContain("async function fetchRequestsSection(): Promise<boolean>");
    expect(shoutouts).toContain("async function fetchRevenueSection(): Promise<boolean>");
    expect(shoutouts).toContain("const [settingsError, setSettingsError] = useState(false)");
    expect(shoutouts).toContain("const [requestsError, setRequestsError] = useState(false)");
    expect(shoutouts).toContain("const [revenueError, setRevenueError] = useState(false)");
  });

  it("the parse-all-before-set combined check is gone", () => {
    expect(shoutouts).not.toContain("if (!sRes.ok || !rRes.ok || !vRes.ok) throw new Error(\"load failed\");");
  });

  it("the full-tab card fires only when all three fail before anything loaded", () => {
    expect(shoutouts).toContain("if (!sOk && !rOk && !vOk && !creatorLoadedRef.current) setCreatorLoadError(true);");
  });

  it("each panel renders its own error note with its own retry", () => {
    expect(shoutouts).toContain("sectionErrorNote(() => void fetchSettingsSection())");
    expect(shoutouts).toContain("sectionErrorNote(() => void fetchRequestsSection())");
    expect(shoutouts).toContain("sectionErrorNote(() => void fetchRevenueSection())");
  });
});

describe("groups — auxiliary member query fails soft (S27-37)", () => {
  it("the member query runs after the grid is applied, in its own try", () => {
    const gridSet = groups.indexOf("setGroups(d.groups);");
    const memberFetch = groups.indexOf("?member=${user.id}");
    expect(gridSet).toBeGreaterThan(-1);
    expect(memberFetch).toBeGreaterThan(gridSet);
    expect(groups).toContain("const [myIdsError, setMyIdsError] = useState(false)");
    expect(groups).toContain("setMyIdsError(true);");
  });

  it("the grid's ErrorBox is driven only by the main load error, badges degrade to an inline note", () => {
    expect(groups).toContain("myIdsError && user");
    expect(groups).toContain("crew badges couldn't load just now");
  });
});

describe("nfc cards — profiles and orders are separate lists (S27-47)", () => {
  it("each list has its own loader and error state", () => {
    expect(nfc).toContain("const loadProfilesList = async (): Promise<boolean>");
    expect(nfc).toContain("const loadOrdersList = async (): Promise<boolean>");
    expect(nfc).toContain("const [profilesError, setProfilesError] = useState(false)");
    expect(nfc).toContain("const [ordersError, setOrdersError] = useState(false)");
  });

  it("the parse-both-before-set combined check is gone", () => {
    expect(nfc).not.toContain("if (!pRes.ok || !pj.ok || !oRes.ok || !oj.ok) throw new Error(\"load failed\");");
  });

  it("the combined error card fires only when both lists fail before either loaded", () => {
    expect(nfc).toContain("if (!pOk && !oOk && !profilesLoadedRef.current && !ordersLoadedRef.current) setLoadError(true);");
  });

  it("each list renders its own error card with its own retry", () => {
    expect(nfc).toContain("onClick={() => void loadProfilesList()}");
    expect(nfc).toContain("onClick={() => void loadOrdersList()}");
    expect(nfc).toContain("Couldn't load your orders.");
  });
});
