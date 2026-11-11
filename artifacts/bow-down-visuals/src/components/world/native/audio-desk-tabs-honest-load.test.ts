/**
 * AudioDeskTabs (SoundPacksTab / LibraryTab / StemsTab /
 * StemRemixPanel) — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 3).
 *
 * The two list-bearing tabs receive the library read as props from
 * AudioDesk (pinned in tranche 2) and render the full machine in
 * source order: failed (line + retry) → loading → list. The stems
 * tab's empty line lives inside the loaded branch only. This pin
 * records those machines plus the writes:
 *
 * - CATALOG (sound packs): a progressive-enhancement read, labeled
 *   as such in the file header's own terms — a slip keeps the
 *   builder standing on the standard set (genre/key fall back to
 *   the picked values, the types row simply doesn't render). It is
 *   pinned AS the documented enhancement, not as a list load.
 * - GENERATE (paid, confirmed rail priced by pack size): decline
 *   runs nothing; 402 gets its own out-of-credits line; non-ok
 *   throws the server's message; an ok-but-empty build throws
 *   instead of claiming a pack.
 * - ZIP: throws the server's message on non-ok before any download.
 * - STEMS: the source fetch, the job POST and a missing job id all
 *   throw into the error line; the poll's transient errors keep
 *   polling by design (the hub panels' own pattern) but a terminal
 *   read always settles busy — done → finishWith, and finishWith's
 *   failure branch shows the read's own error.
 * - REMIX: non-ok AND a URL-less ok both throw; the panel renders
 *   the download only from a real returned URL.
 *
 * NO FIX in this lane — the tabs already meet the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const tabs = read("./AudioDeskTabs.tsx");
const library = tabs.slice(tabs.indexOf("export function LibraryTab("), tabs.indexOf("/* ─── Stem splitter"));
const stems = tabs.slice(tabs.indexOf("export function StemsTab("));

describe("library + stems tabs: failed, loading, empty, list — in that order", () => {
  it("library: the failed branch (with retry) precedes loading, which precedes the list", () => {
    const failIdx = library.indexOf("if (failed) {");
    const loadIdx = library.indexOf("if (rows === null) {", failIdx);
    const emptyIdx = library.indexOf("if (rows.length === 0) {", loadIdx);
    expect(failIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(failIdx);
    expect(emptyIdx).toBeGreaterThan(loadIdx);
    const failBlock = library.slice(failIdx, loadIdx);
    expect(failBlock).toContain('t("worldAudioDesk.libraryLoadFailed")');
    expect(failBlock).toContain("onClick={onRetry}");
    expect(library).toContain('t("worldAudioDesk.libraryEmptySongs")');
  });

  it("stems: failed precedes loading; the no-tracks line lives inside the loaded branch", () => {
    const failIdx = stems.indexOf("if (failed) {");
    const loadIdx = stems.indexOf("if (rows === null) {", failIdx);
    expect(failIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(failIdx);
    const failBlock = stems.slice(failIdx, loadIdx);
    expect(failBlock).toContain('t("worldAudioDesk.stemsLoadFailed")');
    expect(failBlock).toContain("onClick={onRetry}");
    expect(stems).toContain('rows.length === 0 ? (\n        <p className={`text-xs ${muted}`}>{t("worldAudioDesk.stemsNoTracks")}</p>');
  });
});

describe("sound packs: the catalog is a labeled enhancement; the writes are checked", () => {
  it("a slipped catalog leaves the builder on the standard set — fallbacks, never a fake list", () => {
    expect(tabs).toContain('if (!res.ok) return;');
    expect(tabs).toContain("const genreOptions = catalog && catalog.genres.length > 0 ? catalog.genres : [genre];");
    expect(tabs).toContain("const keyOptions = catalog && catalog.keys.length > 0 ? catalog.keys : [musicalKey];");
    expect(tabs).toContain("{catalog && catalog.types.length > 0 ? (");
  });

  it("generate: decline / 402 / non-ok / empty-build are four separate honest outcomes", () => {
    const gen = tabs.slice(tabs.indexOf("const generate = async () => {"), tabs.indexOf("const audition ="));
    expect(gen).toContain("overrideCost: cost,");
    expect(gen).toContain("if (!res) return; // the member declined the price — nothing ran");
    expect(gen).toContain("if (res.status === 402) {");
    expect(gen).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, t(\"worldAudioDesk.packGenFailed\")));");
    expect(gen).toContain('if (built.length === 0) throw new Error(t("worldAudioDesk.packEmpty"));');
    expect(gen.indexOf("if (built.length === 0) throw")).toBeLessThan(gen.indexOf("setSamples(built);"));
  });

  it("zip throws the server's message before any blob is downloaded", () => {
    const zipStart = tabs.indexOf("const downloadZip = async () => {");
    const zip = tabs.slice(zipStart, tabs.indexOf("const muted =", zipStart));
    expect(zip).toContain("if (!res.ok) {");
    expect(zip).toContain('throw new Error(apiErrorMessage(data, t("worldAudioDesk.packDownloadFailed")));');
    expect(zip.indexOf("if (!res.ok) {")).toBeLessThan(zip.indexOf("const blob = await res.blob();"));
  });
});

describe("stems run + remix: failures land in the error line; success only from a real read", () => {
  it("the run throws on the source fetch, the POST, and a missing job id", () => {
    const run = stems.slice(stems.indexOf("const run = async () => {"), stems.indexOf("if (failed) {"));
    expect(run).toContain('if (!res.ok) throw new Error(t("worldAudioDesk.splitFetchFailed"));');
    expect(run).toContain('if (!post.ok) throw new Error(apiErrorMessage(data, t("worldAudioDesk.splitDidntStart")));');
    expect(run).toContain('if (!jobId) throw new Error(t("worldAudioDesk.splitDidntStart"));');
    expect(run).toContain("setError(plainErrorText(err, t(\"worldAudioDesk.splitSnag\")));");
  });

  it("a finished-but-failed read shows its error and settles busy; polling stops on done", () => {
    expect(stems).toContain("if (read.failed) {");
    expect(stems).toContain('setError(apiErrorMessage(read, t("worldAudioDesk.splitDidntFinish")));');
    expect(stems).toContain("if (read.done) {");
    expect(stems).toContain("stopPolling();");
    expect(stems).toContain("useEffect(() => stopPolling, []);");
  });

  it("remix claims a download only from a returned URL", () => {
    const remix = tabs.slice(tabs.indexOf("export function StemRemixPanel("), tabs.indexOf("/* ─── Sound packs"));
    expect(remix).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldAudioDesk.remixDidntLand")));');
    expect(remix).toContain('if (!url) throw new Error(t("worldAudioDesk.remixNoAudio"));');
    expect(remix.indexOf("if (!url) throw")).toBeLessThan(remix.indexOf("setRemixUrl(url);"));
    expect(remix).toContain("{remixUrl ? (");
  });
});
