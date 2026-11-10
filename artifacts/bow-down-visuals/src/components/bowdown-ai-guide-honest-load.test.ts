/**
 * BowDownAIGuide (its PlaylistTracks panel) — honest load states
 * (Stack-400 C-28 components residual, deep-pins tranche 2). The
 * guide body carries no collection load; the file's one list is
 * the owner's playlist, and its admin probe is the AppSidebar
 * fail-closed shape (controls appear only on an ok response whose
 * body says isAdmin === true).
 *
 * FINDING + FIX IN THIS LANE: PlaylistTracks.refresh() recorded
 * tracks only on ok — good — but its finally set loaded=true on
 * EVERY outcome, and the catch commented "keep the previous list"
 * even when there was no previous list: a failed FIRST load left
 * tracks empty + loaded true, and the render painted the genuine
 * empty copy ("No tracks yet — the owner can upload songs here")
 * for a playlist that might be full. The load now throws on a
 * non-ok response into a loadError flag (cleared on success); the
 * render runs spinner → failed-with-retry (btn-retry-playlist,
 * only when there is no list to show) → genuine empty → list, and
 * a failed REFRESH with a list on screen keeps that list, as
 * before.
 *
 * The writes were already honest and are pinned unchanged: the
 * upload throws the server's message on non-ok before refreshing,
 * the delete throws on non-ok before stopping playback or
 * refreshing, and a failed track play sets its error line.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const guide = read("./BowDownAIGuide.tsx");

const refresh = guide.slice(guide.indexOf("const refresh = useCallback"), guide.indexOf("useEffect(() => {\n    void refresh();"));

describe("the playlist load: a failed first load is not an empty playlist (fixed in this lane)", () => {
  it("a non-ok response throws before any body is trusted; success records + clears the flag", () => {
    expect(refresh).toContain('const res = await fetch("/api/playlist");');
    expect(refresh).toContain('if (!res.ok) throw new Error("playlist load failed");');
    expect(refresh.indexOf('throw new Error("playlist load failed")')).toBeLessThan(refresh.indexOf("setTracks("));
    expect(refresh).toContain("setLoadError(false);");
  });

  it("failure sets the flag while keeping any previous list", () => {
    expect(refresh).toContain("setLoadError(true);");
    expect(refresh).toContain("a failed load is NOT an empty");
  });

  it("render order: spinner, failed + retry, genuine empty, list", () => {
    const spinIdx = guide.indexOf("{!loaded ? (");
    const errIdx = guide.indexOf(") : tracks.length === 0 && loadError ? (");
    const emptyIdx = guide.indexOf("No tracks yet — the owner can upload songs here.");
    expect(spinIdx).toBeGreaterThan(-1);
    expect(errIdx).toBeGreaterThan(spinIdx);
    expect(emptyIdx).toBeGreaterThan(errIdx);
  });

  it("the retry re-runs the real loader", () => {
    expect(guide).toContain('data-testid="btn-retry-playlist"');
    expect(guide).toContain("onClick={() => void refresh()}");
    expect(guide).toContain("Couldn&rsquo;t load the playlist.");
  });
});

describe("the admin probe is fail-closed — unchanged", () => {
  it("owner controls appear only on an ok response whose body says isAdmin === true", () => {
    expect(guide).toContain("if (!cancelled) setIsAdmin(res.ok && data.isAdmin === true);");
    expect(guide).toContain("/* not the owner — controls stay hidden */");
  });
});

describe("the playlist writes check their answers — unchanged", () => {
  it("the upload throws the server's message on non-ok before refreshing", () => {
    const upload = guide.slice(guide.indexOf("const handleFile = useCallback"), guide.indexOf("const handleDelete = useCallback"));
    expect(upload).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Upload failed."));');
    expect(upload.indexOf('throw new Error(apiErrorMessage(data, "Upload failed."))')).toBeLessThan(upload.indexOf("await refresh();"));
  });

  it("the delete throws on non-ok before stopping playback or refreshing", () => {
    const del = guide.slice(guide.indexOf("const handleDelete = useCallback"), guide.indexOf("return (\n    <div className=\"space-y-2\">"));
    expect(del).toContain('if (!res.ok) throw new Error("Delete failed.");');
    expect(del.indexOf('throw new Error("Delete failed.")')).toBeLessThan(del.indexOf("await refresh();"));
  });

  it("a failed play sets its error line instead of showing playing", () => {
    expect(guide).toContain('.catch(() => setError("Couldn\'t play that track."));');
  });
});
