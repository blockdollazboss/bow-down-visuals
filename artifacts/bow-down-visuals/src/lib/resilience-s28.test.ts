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

describe("#28 social-api: shared fetch timeout (A3-F6)", () => {
  it("signalWithTimeout aborts a stalled request after the timeout", async () => {
    const { signalWithTimeout } = await import("./social-api");
    const { signal } = signalWithTimeout(undefined, 25);
    expect(signal!.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(signal!.aborted).toBe(true);
  });
  it("opt-out (null / 0) never installs a timeout — long legitimate calls are documented to use it", async () => {
    const { signalWithTimeout } = await import("./social-api");
    for (const opt of [null, 0] as const) {
      const { signal, cancel } = signalWithTimeout(undefined, opt);
      expect(signal).toBeUndefined();
      cancel();
    }
    const page = src("../lib/social-api.ts");
    expect(page).toContain("timeoutMs: null");
    expect(page).toContain("API_FETCH_TIMEOUT_MS = 15_000");
  });
  it("a caller signal still aborts through the merged signal", async () => {
    const { signalWithTimeout } = await import("./social-api");
    const caller = new AbortController();
    const { signal, cancel } = signalWithTimeout(caller.signal, 60_000);
    caller.abort();
    expect(signal!.aborted).toBe(true);
    cancel();
  });
  it("cancel() disarms the timer — a settled request is not aborted after the fact", async () => {
    const { signalWithTimeout } = await import("./social-api");
    const { signal, cancel } = signalWithTimeout(undefined, 25);
    cancel();
    await new Promise((r) => setTimeout(r, 60));
    expect(signal!.aborted).toBe(false);
  });
  it("apiFetch times out a fetch that only settles on abort (the stalled-connection case)", async () => {
    const { apiFetch } = await import("./social-api");
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    try {
      await expect(
        apiFetch(async () => null, "/api/stalled", undefined, { timeoutMs: 25 }),
      ).rejects.toThrow("aborted");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  it("apiFetch with the documented opt-out lets a slow-but-live call complete", async () => {
    const { apiFetch } = await import("./social-api");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      await new Promise((r) => setTimeout(r, 40));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const res = await apiFetch(async () => null, "/api/slow", undefined, { timeoutMs: null });
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("#29 false-'not found' family: 404-only → not-found, else error+retry (A3-F7)", () => {
  it("publicLoadOutcome: the classifier itself", async () => {
    const { publicLoadOutcome, isNotFoundStatus } = await import("./public-load");
    expect(publicLoadOutcome(404, false)).toBe("not-found");
    expect(publicLoadOutcome(404, true)).toBe("not-found");
    expect(publicLoadOutcome(500, false)).toBe("error");
    expect(publicLoadOutcome(500, true)).toBe("error");
    expect(publicLoadOutcome(null, false)).toBe("error"); // network rejection
    expect(publicLoadOutcome(200, true)).toBe("ok");
    expect(publicLoadOutcome(200, false)).toBe("error"); // malformed 200 ≠ not-found
    expect(isNotFoundStatus(404)).toBe(true);
    expect(isNotFoundStatus(500)).toBe(false);
    expect(isNotFoundStatus(null)).toBe(false);
  });

  const family: Array<[string, string, string, string]> = [
    // [file, status-check spelling, load-error testid, not-found render marker]
    ["../pages/challenge.tsx", "res.status === 404", "challenge-load-error", "if (!data || !challenge)"],
    ["../pages/albums/public.tsx", "r.status === 404", "album-load-error", "if (notFound || !album)"],
    ["../pages/bio-public.tsx", "res.status === 404", "bio-load-error", "if (notFound || !page)"],
    ["../pages/plan-public.tsx", "r.status === 404", "plan-load-error", "if (notFound || !payload || !plan)"],
    ["../pages/press-public.tsx", "res.status === 404", "press-load-error", "if (notFound || !kit)"],
    ["../pages/sync-one-sheet-public.tsx", "res.status === 404", "sync-sheet-load-error", "if (notFound || !sheet)"],
    ["../pages/nfc-card-profile.tsx", "res.status === 404", "nfc-load-error", "if (notFound || !profile)"],
    ["../pages/tip-page.tsx", "res.status === 404", "tip-load-error", "notFound || !data ?"],
  ];
  for (const [file, statusCheck, testid, notFoundMarker] of family) {
    it(`${file}: failure ⇒ error+retry state, not-found only on 404`, () => {
      const page = src(file);
      expect(page).toContain(statusCheck);
      expect(page).toContain(`data-testid="${testid}"`);
      expect(page).toContain("setLoadError(true)");
      expect(page).toContain("setRetryNonce((n) => n + 1)");
      /* the old conflations are gone */
      expect(page).not.toContain(".catch(() => setNotFound(true))");
      expect(page).not.toContain("if (!cancelled) setNotFound(true);\n      } catch");
      /* the error branch is gated BEFORE the not-found render */
      const errAt = page.indexOf(`data-testid="${testid}"`);
      expect(errAt).toBeGreaterThan(-1);
      expect(page.indexOf(notFoundMarker, errAt)).toBeGreaterThan(errAt);
    });
  }
});

describe("#30 group-detail: slow feed no longer blocks the whole page (A3-F9)", () => {
  const page = src("../pages/group-detail.tsx");
  it("load() clears the page spinner on core data and fires the feed un-awaited", () => {
    expect(page).toContain("setLoading(false);\n    void loadFeed();");
    expect(page).not.toContain("await loadFeed();\n    setLoading(false);");
  });
  it("the feed keeps its own scoped error state (the section degrades, the page lives)", () => {
    expect(page).toContain("setFeedError(friendlyLoadError(e, \"the group feed\"))");
    expect(page).toContain('if (loading) return');
  });
});

describe("#31 email-list: four engagement panels load and fail independently (A3-F10)", () => {
  const page = src("../pages/email-list.tsx");
  it("loadEngagement is four independent loaders settled via allSettled — no coupled Promise.all of raw fetches", () => {
    expect(page).toContain("Promise.allSettled([loadTags(), loadSegments(), loadCampaigns(), loadAutomations()])");
    expect(page).not.toContain("const [tagsRes, segRes, campRes, autoRes] = await Promise.all([");
    expect(page).not.toContain("panels stay empty; dashboard is unaffected");
  });
  it("each panel carries its own failed flag", () => {
    for (const key of ["tags", "segments", "campaigns", "automations"]) {
      expect(page).toContain(`setPanelFailed((f) => ({ ...f, ${key}: true }))`);
      expect(page).toContain(`setPanelFailed((f) => ({ ...f, ${key}: false }))`);
    }
  });
  it("a failed panel renders an error note + retry in place of its empty state; healthy panels keep their data", () => {
    expect(page).toContain('data-testid="email-tags-segments-error"');
    expect(page).toContain('data-testid="email-campaigns-error"');
    expect(page).toContain('data-testid="email-automations-error"');
    const campErrAt = page.indexOf('data-testid="email-campaigns-error"');
    const campEmptyAt = page.indexOf('t("email-list.no_campaigns_yet")');
    expect(campEmptyAt).toBeGreaterThan(campErrAt);
  });
});

describe("#32 LoyaltySettingsPanel: defaults never pose as saved rules (A3-F11)", () => {
  const page = src("../components/reach/LoyaltySettingsPanel.tsx");
  it("the panel resolves through explicit loading / no-profile / error phases", () => {
    expect(page).toContain('data-testid="loyalty-loading"');
    expect(page).toContain('data-testid="loyalty-load-error"');
    expect(page).toContain("setNoProfile(true)");
  });
  it("a failed /me lookup is a load error, not 'create your profile first'", () => {
    expect(page).not.toContain('apiJson<{ id?: string }>(getAccessToken, "/api/creator-profiles/me").catch(() => null)');
    expect(page).toContain("A failed /me lookup is a LOAD error, not \"no profile\"");
  });
  it("the settings form renders ONLY from loaded values (loading/error branches gate it first)", () => {
    const loadingAt = page.indexOf('data-testid="loyalty-rules-loading"');
    const errorAt = page.indexOf('data-testid="loyalty-rules-error"');
    const formAt = page.indexOf("<form", errorAt);
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(formAt).toBeGreaterThan(errorAt);
    expect(page).toContain("setForm({\n          enabled: s.enabled,");
  });
  it("the redemption queue settles independently — a loyalty failure leaves it working", () => {
    const queueAt = page.indexOf("reachApi.redemptionQueue");
    const loyaltyAt = page.indexOf("reachApi.loyalty(getAccessToken, pid)", queueAt);
    expect(queueAt).toBeGreaterThan(-1);
    expect(loyaltyAt).toBeGreaterThan(queueAt);
    expect(page).toContain("setQueue(pendingRedemptionsFromPayload(q));");
  });
});

describe("#33 silent-empty batch A — hashtag + party lobby (A3-F8/F12)", () => {
  it("hashtag: failure renders an error+retry, and the count header only prints from loaded data", () => {
    const page = src("../pages/hashtag.tsx");
    expect(page).toContain('data-testid="hashtag-load-error"');
    expect(page).toContain("setLoadError(true)");
    expect(page).toContain('data ? `${fmt(total)} pieces of content tagged`');
    expect(page).not.toContain("if (!cancelled) setData(null);\n      } finally");
    const errAt = page.indexOf('data-testid="hashtag-load-error"');
    const emptyAt = page.indexOf("Nothing tagged #");
    expect(emptyAt).toBeGreaterThan(errAt);
  });
  it("party lobby: the three lists settle independently via allSettled", () => {
    const page = src("../pages/party.tsx");
    expect(page).toContain("await Promise.allSettled([");
    expect(page).not.toContain("const [roomsRes, meRes, boardRes] = await Promise.all([");
    expect(page).toContain('roomsRes.status === "fulfilled" && roomsRes.value.ok');
    expect(page).toContain('boardRes.status === "fulfilled" && boardRes.value.ok');
  });
  it("party lobby: rooms carry their own failed flag + error state, mirroring boardFailed", () => {
    const page = src("../pages/party.tsx");
    expect(page).toContain("const [roomsFailed, setRoomsFailed] = useState(false);");
    expect(page).toContain('data-testid="party-rooms-error"');
    /* a healthy board still renders when rooms fail, and vice versa */
    expect(page).toContain("setBoardFailed(false);");
    expect(page).toContain("setRoomsFailed(false);");
  });
});

describe("#34 silent-empty batch B — ShortsMenu, TrophyShelf, team spending, ReachWatch (A3-F13–F16)", () => {
  it("F13 ShortsMenu: per-tab failed flags replace silent catch-to-empty", () => {
    const page = src("../pages/shorts.tsx");
    expect(page).toContain("const [challengesFailed, setChallengesFailed] = useState(false);");
    expect(page).toContain("const [soundsFailed, setSoundsFailed] = useState(false);");
    expect(page).not.toContain('apiGet("/api/challenges/trending?limit=10").catch(() => ({ challenges: [] }))');
    expect(page).toContain('data-testid="shorts-menu-challenges-error"');
    expect(page).toContain('data-testid="shorts-menu-sounds-error"');
    /* failure branch is gated before the genuine-empty copy */
    expect(page.indexOf('data-testid="shorts-menu-challenges-error"')).toBeLessThan(page.indexOf("No challenges yet"));
  });
  it("F14 TrophyShelf: per-source failed flags; empty-because-failed renders error+retry, genuine empty still hides", () => {
    const page = src("../components/artist/TrophyShelf.tsx");
    expect(page).toContain("const [failed, setFailed] = useState({ achievements: false, wins: false, games: false });");
    expect(page).toContain('data-testid="trophy-shelf-error"');
    expect(page).toContain("if (failed.achievements || failed.wins || failed.games)");
    expect(page).toContain("return null;\n  }");
    /* game-stats: only 5xx/transport flags a failure (a 404 can be the legit opt-out hide) */
    expect(page).toContain("if (res.status >= 500) setFailed((f) => ({ ...f, games: true }))");
  });
  it("F15 team spending: failure shows a section note + retry instead of the section vanishing", () => {
    const page = src("../pages/team.tsx");
    expect(page).toContain("const [spendingFailed, setSpendingFailed] = useState(false);");
    expect(page).toContain("setSpendingFailed(true);");
    expect(page).toContain('data-testid="team-spending-error"');
    const errAt = page.indexOf('data-testid="team-spending-error"');
    const sectionAt = page.indexOf("{spending.length > 0 && (", errAt);
    expect(sectionAt).toBeGreaterThan(errAt);
  });
  it("F16 ReachWatch raid poll: halves settle independently via allSettled", () => {
    const page = src("../components/reach/ReachWatchPanel.tsx");
    expect(page).toContain("await Promise.allSettled([");
    expect(page).not.toContain("const [out, inc] = await Promise.all([");
    expect(page).toContain('if (incR.status === "fulfilled") setIncoming(incR.value.raid);');
    expect(page).toContain('if (outR.status !== "fulfilled") return;');
  });
});
