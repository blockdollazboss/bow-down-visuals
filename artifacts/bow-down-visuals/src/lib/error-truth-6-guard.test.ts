/**
 * error-truth-6-guard.test.ts — the error-truth guard, round 6 (stack1300).
 *
 * Rounds 1–5 pinned mutation truth and failure-vs-empty on the newest
 * surfaces. This round closes the LOAD family — the named remainder of
 * rounds 4–5: a collection loader whose catch swallowed the failure
 * left the EMPTY state standing, so a broken load dressed as "you have
 * nothing here." The discipline, mirrored from label-pitch's own
 * loadTracker: the loader throws on a not-ok answer, the catch sets a
 * failure state, the render shows that failure (plain sentence +
 * working Retry) INSTEAD of the empty line, and the empty line renders
 * only after a successful empty load. A failed RELOAD never blanks
 * rows already on screen — the failure blocks are gated on the list
 * still being empty.
 *
 * Same harness constraint as rounds 1–5 (vitest node environment, no
 * DOM): the pins assert the source shapes that produce the truthful
 * renders. Non-English strings added this round are agent-drafted —
 * UNREVIEWED.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/* BeatsDesk's failure/reading lines resolve through worldAudioDesk
   (Stack-100 unit 39) — the en values are asserted where the pins
   below used to find the literals in the source. */
const AUDIO = (JSON.parse(read("locales/en.json")) as { worldAudioDesk: Record<string, string> }).worldAudioDesk;

/** Slice of a source file between two markers (start inclusive). */
function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a, `start marker not found: ${start}`).toBeGreaterThan(-1);
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b === -1 ? undefined : b);
}

describe("SyncTab — the four loaders separate failure from empty", () => {
  const src = read("components/sync-pitch/SyncTab.tsx");
  const sheets = between(src, "async function loadSheets()", "async function loadBriefs()");
  const briefs = between(src, "async function loadBriefs()", "async function loadTracker()");
  const tracker = between(src, "async function loadTracker()", "async function generateSheet()");
  const matches = between(src, "async function loadMatches(briefId: string)", "async function addPitch()");

  it("each loader throws on a not-ok answer and sets its failure state", () => {
    for (const [slice, setter] of [
      [sheets, "setSheetsError(true)"],
      [briefs, "setBriefsError(true)"],
      [tracker, "setTrackerError(true)"],
      [matches, "setMatchesError(true)"],
    ] as const) {
      expect(slice).toMatch(/if \(!res\.ok\) throw new Error\(\)/);
      expect(slice).toContain(setter);
      expect(slice).not.toMatch(/non-fatal/);
    }
  });

  it("the matches catch no longer wipes the rows (the clear at load start is the brief switch, not the failure)", () => {
    const catchBlock = matches.slice(matches.indexOf("} catch {"), matches.indexOf("finally"));
    expect(catchBlock).toContain("setMatchesError(true)");
    expect(catchBlock).not.toMatch(/setMatches\(\[\]\)/);
  });

  it("each failure renders its own line plus a working Retry, and the empty line is gated on no failure", () => {
    for (const [flag, emptyFlag, titleKey, testid] of [
      ["sheetsError", "!sheetsError", "syncPitch.sheetsLoadError", "btn-retry-sheets"],
      ["briefsError", "!briefsError", "syncPitch.briefsLoadError", "btn-retry-briefs"],
      ["trackerError", "!trackerError", "syncPitch.trackerLoadError", "btn-retry-sync-tracker"],
      ["matchesError", "!matchesError", "syncPitch.matchesLoadError", "btn-retry-matches"],
    ] as const) {
      expect(src, flag).toContain(`t("${titleKey}")`);
      expect(src, testid).toContain(`data-testid="${testid}"`);
      expect(src, emptyFlag).toContain(emptyFlag);
    }
  });
});

describe("label-pitch — the five list loaders separate failure from empty", () => {
  const src = read("pages/label-pitch.tsx");
  const labels = between(src, "async function loadLabels(g: string, t: string)", "async function loadTracker()");
  const curators = between(src, "async function loadCurators(g: string)", "async function loadTracker()");
  const releases = between(src, "async function loadReleases()", "async function loadPacket(releaseId: string)");
  const packet = between(src, "async function loadPacket(releaseId: string)", "async function loadDeadlines()");
  const deadlines = between(src, "async function loadDeadlines()", "async function addDeadline()");

  it("each loader throws on a not-ok answer and sets its failure state", () => {
    for (const [slice, setter] of [
      [labels, "setLabelsError(true)"],
      [curators, "setCuratorsError(true)"],
      [releases, "setReleasesError(true)"],
      [packet, "setPacketError(true)"],
      [deadlines, "setDeadlinesError(true)"],
    ] as const) {
      expect(slice).toMatch(/if \(!res\.ok\) throw new Error\(\)/);
      expect(slice).toContain(setter);
      expect(slice).not.toMatch(/non-fatal/);
    }
  });

  it("the empty lines render only when the matching load did not fail", () => {
    expect(src).toContain("{!labelsLoading && !labelsError && labels.length === 0 && (");
    expect(src).toContain("{!curatorsLoading && !curatorsError && curators.length === 0 && (");
    expect(src).toContain("{!deadlinesLoading && !deadlinesError && deadlines.length === 0 && (");
    expect(src).toContain("{!packetLoading && !packetError && !packet && (");
  });

  it("each failure carries a working Retry", () => {
    for (const testid of ["btn-retry-labels", "btn-retry-curators", "btn-retry-releases", "btn-retry-packet", "btn-retry-deadlines"]) {
      expect(src, testid).toContain(`data-testid="${testid}"`);
    }
    expect(src).toContain('t("labelPitch.labelsLoadError")');
    expect(src).toContain('t("playlistPitch.curatorsLoadError")');
    expect(src).toContain('t("playlistPitch.releasesLoadError")');
    expect(src).toContain('t("playlistPitch.deadlinesLoadError")');
    expect(src).toContain('t("playlistPitch.packetLoadError")');
  });
});

describe("LutImportSection — loadAll speaks its failure, and a landed save is never misreported", () => {
  const src = read("components/editor/sections/LutImportSection.tsx");
  const loadAll = between(src, "const loadAll = useCallback(async () => {", "useEffect(() => {");
  const save = between(src, "async function handleSaveUpload() {", "async function handleDeleteSaved(id: string) {");

  it("either leg failing lands in the failure state", () => {
    expect(loadAll).toContain("setLoadFailed(failed)");
    expect(loadAll).toMatch(/else failed = true;/);
    expect(loadAll).not.toMatch(/non-fatal/);
  });

  it("the failure line renders with a working Retry", () => {
    expect(src).toContain("{loadFailed && (");
    expect(src).toContain('data-testid="btn-retry-luts"');
  });

  it("the post-save re-read is best-effort — its failure cannot reach the save's error line", () => {
    const rereadAt = save.indexOf("const savedRes = await confirmedFetch");
    const catchAt = save.indexOf('setError("Couldn\'t save that LUT.")');
    expect(rereadAt).toBeGreaterThan(-1);
    expect(save.slice(0, catchAt)).toContain("} catch { /* the save stands;");
    expect(save).toContain("await loadAll();");
  });
});

describe("PhotoCanvasEditor — a failed preset load is not 'No presets saved yet'", () => {
  const src = read("components/photo/PhotoCanvasEditor.tsx");
  const load = between(src, "const loadPresets = useCallback(async () => {", "useEffect(() => { void loadPresets(); }, [loadPresets]);");

  it("the loader throws on a not-ok answer and sets the failure state", () => {
    expect(load).toMatch(/if \(!res\?\.ok\) throw new Error\("presets load failed"\)/);
    expect(load).toContain("setPresetsFailed(true)");
    expect(load).not.toMatch(/non-fatal/);
  });

  it("the failure branch renders before the empty line, with a working Retry", () => {
    expect(src).toContain("{presetsFailed ? (");
    expect(src).toContain('data-testid="btn-retry-presets"');
    expect(src.indexOf("{presetsFailed ? (")).toBeLessThan(src.indexOf("No presets saved yet."));
  });
});

describe("branding-shop — a failed designs load is not an empty store", () => {
  const src = read("components/branding/BrandingShop.tsx");
  const load = between(src, "async function loadStore()", "useEffect(() => {");

  it("the loader throws on a not-ok answer and sets the failure state", () => {
    expect(load).toMatch(/if \(!res\.ok\) throw new Error\(\)/);
    expect(load).toContain("setDesignsError(true)");
    expect(load).not.toMatch(/non-fatal/);
  });

  it("the failure block mirrors the page's own orders block, and the empty block is gated on no failure", () => {
    expect(src).toContain("{!storeLoading && designsError && (");
    expect(src).toContain("{!storeLoading && !designsError && designs.length === 0 && (");
    expect(src).toContain('t("merch.designsLoadError")');
    expect(src).toContain('data-testid="btn-retry-designs"');
  });
});

describe("World BeatsDesk — the templates leg joins its honest siblings", () => {
  const src = read("components/world/native/BeatsDesk.tsx");

  it("the templates leg throws on a not-ok answer and lands in tplLoadFailed", () => {
    const leg = between(src, '"/api/beats/license-templates/mine"', "}, [isGuest]);");
    expect(leg).toMatch(/if \(!res\.ok\) throw new Error\("templates"\)/);
    expect(leg).toContain("setTplLoadFailed(true)");
    expect(leg).toContain("setTplLoadFailed(false)");
  });

  it("the failure branch renders ahead of the eternal 'Reading…' branch, with a working Retry", () => {
    expect(src).toContain("{templates === null && tplLoadFailed ? (");
    /* Both lines resolve through worldAudioDesk since the audio
       locale unit (Stack-100 unit 39) — the en values carry the
       exact sentences. */
    expect(src).toContain('t("worldAudioDesk.templatesLoadFailedText")');
    expect(AUDIO.templatesLoadFailedText).toBe("Couldn't load your custom licenses.");
    expect(src).toContain('data-testid="world-beats-templates-retry"');
    expect(src.indexOf("{templates === null && tplLoadFailed ? (")).toBeLessThan(src.indexOf('t("worldAudioDesk.readingTemplates")'));
    expect(AUDIO.readingTemplates).toBe("Reading your templates…");
  });
});

describe("round-6 locale keys — the failure lines exist in all ten catalogs", () => {
  const KEYS: Record<string, string[]> = {
    syncPitch: ["sheetsLoadError", "sheetsLoadErrorBody", "briefsLoadError", "briefsLoadErrorBody", "trackerLoadError", "trackerLoadErrorBody", "matchesLoadError", "retryLoad"],
    labelPitch: ["labelsLoadError", "labelsLoadErrorBody"],
    playlistPitch: ["curatorsLoadError", "curatorsLoadErrorBody", "releasesLoadError", "releasesLoadErrorBody", "deadlinesLoadError", "deadlinesLoadErrorBody", "packetLoadError", "packetLoadErrorBody"],
    merch: ["designsLoadError", "designsLoadErrorBody", "retryLoad"],
  };
  const get = (obj: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), obj);

  it.each(["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"])("%s carries all 21 round-6 keys as strings", (locale) => {
    const catalog = JSON.parse(readFileSync(join(SRC, "locales", `${locale}.json`), "utf8")) as Record<string, unknown>;
    let count = 0;
    for (const [ns, keys] of Object.entries(KEYS)) {
      for (const key of keys) {
        const value = get(catalog, `${ns}.${key}`);
        expect(typeof value, `${locale} ${ns}.${key}`).toBe("string");
        expect((value as string).length, `${locale} ${ns}.${key}`).toBeGreaterThan(0);
        count++;
      }
    }
    expect(count).toBe(21);
  });
});
