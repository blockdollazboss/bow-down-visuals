/**
 * WORLD-HONESTY (stack400 lane C-29 + C-30) — the empty-lie pins.
 *
 * C-29: the census premise was STALE at lane time. The desk files
 * it named already carry honest load machinery missed by a literal
 * grep (the trio rides the `@/components/world/native` barrel, and
 * several desks run explicit failed-state machines instead of the
 * trio). The already-wired / honest-idiom desks get SOURCE PINS so
 * a future edit cannot strip the truth silently; no desk needed
 * rewiring in this lane.
 *
 * C-30: the two named dishonest-by-omission loads were REAL, in
 * THREE SongRequests faces (2D panel, World fan panel, World desk
 * queue — one queue, three faces) plus ThemeKitPanel's saved mix:
 * a failed load used to dress up as an empty/absent queue, or the
 * default mix posed as the member's own. These pins hold the fix:
 * failures count up, success resets, and at the limit the surface
 * says the load failed instead of implying "nothing here".
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";


const readNative = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const readSrc = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const LOCALE_FILES = readdirSync(new URL("../../../locales", import.meta.url));

describe("C-29 — already-wired desks stay wired (census premise was stale)", () => {
  it("charts board (boards/) carries the full trio with a real failed state", () => {
    const src = readNative("boards/ChartsBoard.tsx");
    expect(src).toContain("NativeLoadingState");
    expect(src).toContain("NativeEmptyState");
    expect(src).toContain("NativeErrorState");
    expect(src).toContain("failedKey");
    expect(src).toContain("setFailedKey(loadKey)");
  });

  it("studio board fails loudly per surface (failed flags reach NativeErrorState)", () => {
    const src = readNative("boards/StudioBoard.tsx");
    expect(src).toContain("NativeErrorState");
    expect(src).toContain("projectsFailed");
    expect(src).toContain("setProjectsFailed(true)");
  });

  it("earnings board carries a failed flag per money read", () => {
    const src = readNative("boards/EarningsBoard.tsx");
    expect(src).toContain("NativeErrorState");
    expect(src).toContain("earningsFailed");
    expect(src).toContain("ledgerFailed");
    expect(src).toContain("stmtFailed");
    expect(src).toContain("setStmtFailed(true)");
  });

  it("scheduler desk carries the full trio (the join's seam file)", () => {
    const src = readNative("SchedulerDesk.tsx");
    expect(src).toContain("./NativeStates");
    expect(src).toContain("NativeLoadingState");
    expect(src).toContain("NativeEmptyState");
    expect(src).toContain("NativeErrorState");
  });

  it("the seven named native-root desks each import the trio", () => {
    for (const f of [
      "WebsiteBuilderDesk.tsx",
      "CollabsDesk.tsx",
      "ShoutoutsDesk.tsx",
      "IdentitySetsDesk.tsx",
      "StoreGrowthDesk.tsx",
      "TreasuryQuestDepths.tsx",
    ]) {
      const src = readNative(f);
      expect(src, f).toContain("NativeLoadingState");
      expect(src, f).toContain("NativeEmptyState");
      expect(src, f).toContain("NativeErrorState");
    }
  });

  it("succession desk runs its honest failed-flag idiom (no trio, by design)", () => {
    const src = readNative("SuccessionDesk.tsx");
    expect(src).toContain("stateFailed");
    expect(src).toContain("contactFailed");
    expect(src).toContain('data-testid="world-succession-retry"');
    expect(src).toContain('data-testid="world-legacy-contact-retry"');
    /* A failed load sets the flag and renders the retry line — the
       desk never blanks or dresses failure as emptiness. */
    expect(src).toContain("} catch { setStateFailed(true); }");
  });

  it("song desk tabs are action benches whose every action sets a visible error", () => {
    const src = readNative("SongDeskTabs.tsx");
    expect(src).toContain("setError(plainErrorText(err, t(\"worldAudioDesk.inspoAnalyzeFailed\")))");
    expect(src).toContain("inspoAnalyzeFailed");
  });
});

describe("C-30 (1) — the queue loads: failure counts, outage says so, success heals", () => {
  const twoD = readSrc("components/live/SongRequests.tsx");
  const desk = readNative("LiveDesk.tsx");

  it("2D fan panel: the load counts consecutive failures and a success resets", () => {
    expect(twoD).toContain("const QUEUE_LOAD_FAILURE_LIMIT = 3");
    expect(twoD).toContain("setQueueLoadFailures(0)");
    expect(twoD).toContain("setQueueLoadFailures((n) => n + 1)");
    /* The queue load itself counts a non-OK answer as a failure now —
       the fan load's body must not carry the old silent return (the
       creator desk's separate history/songs loaders in the same file
       keep their own shape; the queue load is what C-30 named). */
    const loadBody = twoD.slice(
      twoD.indexOf("const load = useCallback"),
      twoD.indexOf("}, [streamId]);"),
    );
    expect(loadBody).not.toContain("if (!res.ok) return;");
    expect(loadBody).toContain('throw new Error("queue load")');
  });

  it("2D fan panel: sustained failure renders a failure shell, never null-forever", () => {
    expect(twoD).toContain("if (!data && queueLoadFailures >= QUEUE_LOAD_FAILURE_LIMIT)");
    expect(twoD).toContain("The request queue couldn't load");
    expect(twoD).toContain("stale queue on screen");
    expect(twoD).toContain("The request queue stopped updating");
  });

  it("World faces: the shared failure limit and the resetting counter exist per face", () => {
    expect(desk).toContain("const SONG_REQUEST_QUEUE_FAILURE_LIMIT = 3");
    expect(desk.match(/setQueueLoadFailures\(0\)/g)?.length).toBe(2);
    expect(desk.match(/setQueueLoadFailures\(\(n\) => n \+ 1\)/g)?.length).toBe(2);
  });

  it("World fan panel: nothing-loaded + outage renders the load-failed line", () => {
    expect(desk).toContain("if (!view && queueLoadFailures >= SONG_REQUEST_QUEUE_FAILURE_LIMIT)");
    expect(desk).toContain('t("worldDeskRemainder.liveSrQueueLoadFailed")');
    expect(desk).toContain("queueStaleNote");
    expect(desk).toContain('t("worldDeskRemainder.liveSrQueueStale")');
  });

  it("World desk queue: an outage replaces the empty-queue rows instead of dressing as them", () => {
    expect(desk).toContain("queueView === null");
    /* The rows only render when the load is not in sustained failure. */
    expect(desk).toContain("queueLoadFailures >= SONG_REQUEST_QUEUE_FAILURE_LIMIT ? (");
  });

  it("the new queue honesty strings exist in all ten catalogs", () => {
    for (const loc of LOCALE_FILES) {
      const cat = JSON.parse(readSrc(`locales/${loc}`)) as Record<string, Record<string, string>>;
      expect(cat.worldDeskRemainder.liveSrQueueLoadFailed, loc).toBeTruthy();
      expect(cat.worldDeskRemainder.liveSrQueueStale, loc).toBeTruthy();
    }
  });
});

describe("C-30 (2) — ThemeKitPanel's saved mix: a failed read is no longer silent", () => {
  const panel = readSrc("components/theme-packs/ThemeKitPanel.tsx");

  it("tracks the failed read apart from the download error state", () => {
    expect(panel).toContain("const [savedMixLoadFailed, setSavedMixLoadFailed] = useState(false)");
    expect(panel).toContain("if (saved === null) {");
    expect(panel).toContain("setSavedMixLoadFailed(true)");
    expect(panel).toContain("setSavedMixLoadFailed(false)");
  });

  it("the download's fallback stays but is flagged, never silent", () => {
    expect(panel).toContain("const savedMix = saved ?? mix;");
  });

  it("renders the notice in the panel's error idiom with its catalog key", () => {
    expect(panel).toContain("{savedMixLoadFailed ? (");
    expect(panel).toContain('t("themeKitPanel.kitSavedMixLoadFailed"');
  });

  it("the notice string exists in all ten catalogs", () => {
    for (const loc of LOCALE_FILES) {
      const cat = JSON.parse(readSrc(`locales/${loc}`)) as Record<string, Record<string, string>>;
      expect(cat.themeKitPanel.kitSavedMixLoadFailed, loc).toBeTruthy();
    }
  });
});
