/**
 * Audio Studio (/audio-studio) — honest load states (Stack-400 pin
 * batch, the "empty lie" family). The page's own panels are job
 * tools (upload → start → poll a single job; each surfaces its own
 * error state) — the page has NO page-level list load. Its one
 * network-loaded collection is the song library, and its honesty
 * lives in the child component LibrarySongPicker
 * (src/components/audio-studio/LibrarySongPicker.tsx), used by the
 * cleanup, master, mix and quick-master panels; this pin reads the
 * child and its lib loader (lib/song-library fetchLibrarySongs)
 * alongside the page's wiring.
 *
 * C-25 wrap note: this page is wrapped in SectionBoundary panels on
 * the banked branch stack1600/s400-resilience-editors @ 582404e4c.
 * A diff of that version against this one shows ONLY the
 * SectionBoundary import and wrappers — no loader or render string
 * differs — so every string asserted here (all in the shared child,
 * the shared lib, and the page's picker usages) is present in BOTH
 * versions, and the assertions are loader-level + gating only.
 *
 * The picker carries a songs-null machine: songs === null is the
 * not-yet-loaded state (renders the loading line, never the empty
 * copy); fetchLibrarySongs throws on !res.ok and the picker's catch
 * records the error — resetting songs to null — and renders the
 * error row with a retry wired to the real load; the empty copy
 * renders only when songs is a loaded array of length zero. The
 * copy goes through audioStudio.library.* keys that carry in-source
 * defaultValue English and are NOT present in any of the 10 locale
 * catalogs (verified), so this pin asserts the full t() calls —
 * defaultValue included — and carries no catalog block.
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./audio-studio.tsx");
const picker = read("../components/audio-studio/LibrarySongPicker.tsx");
const lib = read("../lib/song-library.ts");
const loadAt = picker.indexOf("async function load() {");
const loader = picker.slice(loadAt, picker.indexOf("async function toggle()", loadAt));

describe("the page wires the picker child that carries the honest machine", () => {
  it("the page imports LibrarySongPicker and mounts it in its panels", () => {
    expect(page).toContain('import { LibrarySongPicker } from "@/components/audio-studio/LibrarySongPicker";');
    expect(page).toContain('testId="cleanup-library-picker"');
    expect(page).toContain('testId="master-library-picker"');
    expect(page).toContain('testId="quick-master-library-picker"');
  });
});

describe("failure path — a failed library load never reads as an empty library", () => {
  it("the lib loader throws on a non-ok response", () => {
    expect(lib).toContain("if (!res.ok) throw new Error(`song library failed: ${res.status}`);");
  });

  it("the picker records the error and resets to the not-loaded state in its catch", () => {
    expect(loader).toContain("setSongs(await fetchLibrarySongs(getAccessToken));");
    expect(loader).toContain("setSongs(null);");
    expect(loader).toContain('setError(t("audioStudio.library.loadFailed", { defaultValue: "Couldn\'t load your song library — try again." }));');
  });

  it("failure renders the error row with a retry wired to the real load", () => {
    expect(picker).toContain("onClick={() => void load()}");
    expect(picker).toContain('t("audioStudio.library.retry", { defaultValue: "Retry" })');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the not-loaded state renders the loading line, gated on no error and songs === null", () => {
    expect(picker).toContain("{!error && songs === null && (");
    expect(picker).toContain('t("audioStudio.library.loading", { defaultValue: "Loading your library…" })');
  });

  it("the empty copy renders only for a loaded array of length zero, after the error and loading branches", () => {
    expect(picker).toContain("{songs !== null && songs.length === 0 && (");
    expect(picker).toContain('t("audioStudio.library.empty", { defaultValue: "No songs in your library yet — finished studio work and generated songs land here." })');
    const errAt = picker.indexOf("{error && (");
    const loadAt2 = picker.indexOf("{!error && songs === null && (");
    const emptyAt = picker.indexOf("{songs !== null && songs.length === 0 && (");
    expect(errAt).toBeGreaterThan(-1);
    expect(loadAt2).toBeGreaterThan(errAt);
    expect(emptyAt).toBeGreaterThan(loadAt2);
  });
});
