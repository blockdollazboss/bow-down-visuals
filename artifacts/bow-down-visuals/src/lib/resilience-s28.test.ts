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

describe("#24 referrals: no infinite spinner, own data not waterfall-blocked (A3-F2)", () => {
  const page = src("../pages/referrals.tsx");
  it("the primary /api/referrals/me fetch sits inside the guarded load (not bare in the effect)", () => {
    expect(page).toContain("Promise.allSettled([contestP, meP])");
    expect(page).toContain('authFetch("/api/referrals/me")');
  });
  it("loading always settles: setLoading(false) is in a finally", () => {
    expect(page).toContain("} finally {\n        if (!cancelled) setLoading(false);");
  });
  it("contest and own data start concurrently — neither awaits the other first", () => {
    const contestAt = page.indexOf("const contestP");
    const meAt = page.indexOf("const meP");
    const settledAt = page.indexOf("Promise.allSettled([contestP, meP])");
    expect(contestAt).toBeGreaterThan(-1);
    expect(meAt).toBeGreaterThan(contestAt);
    expect(settledAt).toBeGreaterThan(meAt);
    expect(page).not.toContain('const cres = await fetch("/api/referrals/contest");\n        const cdata = await cres.json();\n        if (cres.ok) setContest(cdata);\n      } catch { /* non-fatal */ }\n      if (!user)');
  });
  it("the error state carries its own retry (rest of page — hero + contest — stays alive above it)", () => {
    expect(page).toContain("setRetryNonce((n) => n + 1)");
    const contestAt = page.indexOf("{contest && <ContestSection");
    const errorAt = page.lastIndexOf("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(contestAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(contestAt);
  });
});

describe("#25 sponsor-dashboard: banner never paints fake zeros (A3-F3)", () => {
  const page = src("../pages/sponsor-dashboard.tsx");
  it("totalEarned starts null — there is no 0 to paint before the load lands", () => {
    expect(page).toContain("useState<number | null>(null)");
    expect(page).not.toContain("setTotalEarnedCents] = useState(0)");
  });
  it("every banner number is gated on a successful load (loading/error → placeholder)", () => {
    expect(page).toContain('loading || error || totalEarnedCents === null ? "—" : moneyCents(totalEarnedCents)');
    expect(page).toContain('loading || error ? "—" : postedDeals.length');
    expect(page).toContain('loading || error ? "—" : applications.length');
  });
  it("failure shows an error note in the banner, and the tab body's error+retry stays alive below it", () => {
    expect(page).toContain("Couldn't load your earnings — try again below.");
    expect(page).toContain("setRetryNonce((n) => n + 1)");
  });
});

describe("#26 broadcast: channels and inbox settle independently (A3-F4)", () => {
  const page = src("../pages/broadcast.tsx");
  it("no coupled Promise.all and no single page loadState remain", () => {
    expect(page).not.toContain("Promise.all([reachApi.broadcastChannels");
    expect(page).not.toContain("loadState");
    expect(page).toContain("Promise.allSettled([loadChannels(), loadInbox()])");
  });
  it("each source carries its own state and its own error card + retry", () => {
    expect(page).toContain('data-testid="broadcast-channels-error"');
    expect(page).toContain('data-testid="broadcast-inbox-error"');
    expect(page).toContain("onClick={() => void loadChannels()}");
    expect(page).toContain("onClick={() => void loadInbox()}");
  });
  it("the create form is reachable whenever channels are not loading — inbox state never gates it", () => {
    expect(page).toContain('!mine && channelsState !== "loading"');
    const formAt = page.indexOf("Open your broadcast channel");
    const inboxErrorAt = page.indexOf('data-testid="broadcast-inbox-error"');
    expect(formAt).toBeGreaterThan(-1);
    expect(inboxErrorAt).toBeGreaterThan(formAt);
  });
  it("there is no full-page spinner gate anymore", () => {
    expect(page).not.toContain('loadState === "loading"');
  });
});

describe("#27 artist-setup: failed load ≠ brand-new creator (A3-F5)", () => {
  const page = src("../pages/artist-setup.tsx");
  it("the load catch sets a load-error state — it never constructs an emptyProfile", () => {
    const catchAt = page.indexOf("} catch {\n        if (!cancelled) setLoadError(true);");
    expect(catchAt).toBeGreaterThan(-1);
    expect(page).not.toContain("setProfile(emptyProfile())");
  });
  it("the genuine no-profile branch still builds the prefilled new-creator profile", () => {
    expect(page).toContain("setProfile(emptyProfile({ display_name: preName, avatar_url: preAvatar }))");
  });
  it("the error state renders before the editor/lightning branches, with a retry that reloads", () => {
    const errAt = page.indexOf('data-testid="artist-setup-load-error"');
    const lightningAt = page.indexOf("if (!exists && lightning)");
    expect(errAt).toBeGreaterThan(-1);
    expect(lightningAt).toBeGreaterThan(errAt);
    expect(page).toContain("setRetryNonce((n) => n + 1)");
    expect(page).toContain("}, [retryNonce]);");
  });
});
