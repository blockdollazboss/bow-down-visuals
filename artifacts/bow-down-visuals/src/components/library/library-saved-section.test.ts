/**
 * library-saved-section.test.ts — Stack-100 A16.
 *
 * The Library page had no Saved section although the saves rail
 * (GET /api/saves/mine), the /saved page, and the World SavedDesk
 * all read the same store. The Library is the collection home, so
 * the member's bookmarks dock there as a tab, on the same rail.
 *
 * Pinned here:
 *  - ?tab=saved resolves through libraryTabFromParams (pure).
 *  - library.tsx carries the Saved tab (real count badge) and
 *    renders SavedPanel under it.
 *  - The panel reads the SHARED rail builders from
 *    lib/world/saved-desk (SAVES_PATH / saveDeletePath) — never a
 *    second hand-typed copy that can drift.
 *  - Honest states, in order: a malformed payload is validated by
 *    savesOfResponse and lands in the FAILURE state (with Retry);
 *    the EMPTY state (with the Explore door) can only render after
 *    a successful load — the empty-lie family stays dead.
 *  - Unsave reflects: optimistic removal + count update ride the
 *    DELETE rail, and a refusal restores the shelf with a note.
 *  - Rail-shape behaviour the panel relies on, proven against the
 *    shared saved-desk logic itself (savesOfResponse /
 *    saveDeletePath): all four kinds parse, a null embed reads as
 *    "gone", a malformed payload returns null.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { libraryTabFromParams } from "../../lib/library-tab";
import {
  SAVES_PATH,
  saveDeletePath,
  savesOfResponse,
} from "../../lib/world/saved-desk";

const panelSrc = readFileSync(join(__dirname, "SavedPanel.tsx"), "utf8");
const librarySrc = readFileSync(join(__dirname, "../../pages/library.tsx"), "utf8");

describe("Library Saved section — tab resolution", () => {
  it("?tab=saved selects the saved tab", () => {
    expect(libraryTabFromParams(new URLSearchParams("tab=saved"))).toBe("saved");
  });

  it("every Library tab incl. saved is honored", () => {
    for (const tab of ["templates", "presets", "fonts", "wishlist", "saved", "features", "purchases"] as const) {
      expect(libraryTabFromParams(new URLSearchParams(`tab=${tab}`))).toBe(tab);
    }
  });
});

describe("library.tsx wiring", () => {
  it("carries a Saved tab with the Bookmark icon and the live count badge", () => {
    expect(librarySrc).toContain('key: "saved"');
    expect(librarySrc).toContain('t("library.tabSaved", { defaultValue: "Saved" })');
    expect(librarySrc).toContain("icon: Bookmark");
    expect(librarySrc).toContain("count: savedCount");
  });

  it("renders SavedPanel under the saved tab and feeds it the count setter", () => {
    expect(librarySrc).toContain('import SavedPanel from "@/components/library/SavedPanel";');
    expect(librarySrc).toContain('tab === "saved"');
    expect(librarySrc).toContain("<SavedPanel onCountChange={setSavedCount} />");
  });

  it("the badge count reads the member's real saves rail", () => {
    expect(librarySrc).toContain('import { SAVES_PATH } from "@/lib/world/saved-desk";');
    expect(librarySrc).toContain("apiJson<{ saves: unknown[] }>(getAccessToken, SAVES_PATH)");
  });
});

describe("SavedPanel — reads the shared saves rail", () => {
  it("fetches SAVES_PATH through apiJson — the same store /saved and the World desk read", () => {
    expect(SAVES_PATH).toBe("/api/saves/mine");
    expect(panelSrc).toContain("SAVES_PATH, SAVE_KINDS, SAVE_KIND_LABELS, saveDeletePath, savesOfResponse");
    expect(panelSrc).toContain("apiJson<{ saves: RawSave[] }>(getAccessToken, SAVES_PATH)");
    expect(panelSrc).not.toContain('"/api/saves/mine"');
  });

  it("validates the payload with the shared savesOfResponse and treats malformed as failure", () => {
    expect(panelSrc).toContain("const parsed = savesOfResponse(data);");
    expect(panelSrc).toContain('if (!parsed) throw new Error("malformed saves payload");');
  });
});

describe("SavedPanel — honest states, in order", () => {
  it("loading renders before any empty claim (items === null gates the empty state)", () => {
    const loadingAt = panelSrc.indexOf("items === null");
    const emptyAt = panelSrc.indexOf("items.length === 0");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(loadingAt);
    expect(panelSrc).toContain('data-testid="library-saved-loading"');
  });

  it("failure renders before the empty state and carries a working Retry", () => {
    const errorAt = panelSrc.indexOf("if (error) {");
    const emptyAt = panelSrc.indexOf("items.length === 0");
    expect(errorAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(panelSrc).toContain('data-testid="library-saved-error"');
    expect(panelSrc).toContain('t("library.savedRetry", { defaultValue: "Try again" })');
    /* The retry re-runs the load: the effect depends on retryNonce. */
    expect(panelSrc).toContain("}, [user, getAccessToken, retryNonce]);");
  });

  it("the empty state is honest and doors to discovery — never shown for a failed read", () => {
    expect(panelSrc).toContain('data-testid="library-saved-empty"');
    expect(panelSrc).toContain('t("library.savedEmptyTitle", { defaultValue: "Nothing saved yet" })');
    expect(panelSrc).toContain('data-testid="library-saved-explore-door"');
    expect(panelSrc).toContain('href="/explore"');
  });

  it("a save whose thing has gone renders the honest gone row, not a ghost door", () => {
    expect(panelSrc).toContain('t("library.savedGone", {');
    expect(panelSrc).toContain("isn't available anymore");
  });
});

describe("SavedPanel — unsave reflects", () => {
  it("unsaves through the shared DELETE path builder", () => {
    expect(saveDeletePath("track", "t1")).toBe("/api/saves/track/t1");
    expect(panelSrc).toContain("saveDeletePath(item.kind as SaveKind, item.target_id)");
    expect(panelSrc).toContain('method: "DELETE"');
  });

  it("removes the row optimistically and updates the tab count before the rail answers", () => {
    const unsaveAt = panelSrc.indexOf("async function unsave");
    const removeAt = panelSrc.indexOf("x.target_id === item.target_id", unsaveAt);
    const countAt = panelSrc.indexOf("onCountChange?.(next.length)", unsaveAt);
    const fetchAt = panelSrc.indexOf("apiFetch(getAccessToken, saveDeletePath", unsaveAt);
    expect(removeAt).toBeGreaterThan(unsaveAt);
    expect(countAt).toBeGreaterThan(removeAt);
    expect(fetchAt).toBeGreaterThan(countAt);
  });

  it("a refused unsave restores the shelf (reload) and says so", () => {
    expect(panelSrc).toContain('t("library.savedUnsaveFailed", {');
    expect(panelSrc).toContain("the item is back on your shelf");
    const noteAt = panelSrc.indexOf("library.savedUnsaveFailed");
    const reloadAt = panelSrc.indexOf("setRetryNonce((n) => n + 1)", noteAt);
    expect(reloadAt).toBeGreaterThan(noteAt);
  });

  it("rows door to the thing itself for every kind", () => {
    expect(panelSrc).toContain("href={`/post/${item.post.id}`}");
    expect(panelSrc).toContain("href={`/artist/${item.profile.slug}`}");
    expect(panelSrc).toContain("href={`/track/${item.track.id}`}");
    expect(panelSrc).toContain("href={`/watch/${item.video.id}`}");
  });

  it("renders in light AND dark (theme hook + light card surface)", () => {
    expect(panelSrc).toContain("useIsLightTheme");
    expect(panelSrc).toContain("bg-[#FCF7EA]");
    expect(panelSrc).toContain("bg-black/40");
  });
});

describe("rail shape the panel relies on (shared saved-desk logic)", () => {
  const payload = {
    saves: [
      { kind: "post", target_id: "p1", saved_at: "2026-11-01T00:00:00Z", post: { body: "hello world", author: { display_name: "Thy Cheat Code" } } },
      { kind: "track", target_id: "t1", saved_at: "2026-11-01T00:00:00Z", track: { title: "Crown Heavy" } },
      { kind: "video", target_id: "v1", saved_at: "2026-11-01T00:00:00Z", video: { title: "Palace Tour" } },
      { kind: "profile", target_id: "u1", saved_at: "2026-11-01T00:00:00Z", profile: { display_name: "Thy Cheat Code", slug: "thycheatcode" } },
      { kind: "track", target_id: "t2", saved_at: "2026-11-01T00:00:00Z", track: null },
      { kind: "mystery", target_id: "x1", saved_at: "2026-11-01T00:00:00Z" },
    ],
  };

  it("parses all four kinds and drops rows outside the enum", () => {
    const items = savesOfResponse(payload);
    expect(items).not.toBeNull();
    expect(items!.map((i) => i.kind)).toEqual(["post", "track", "video", "profile", "track"]);
  });

  it("a null embed reads as gone — the row the panel renders honestly", () => {
    const items = savesOfResponse(payload)!;
    expect(items.find((i) => i.targetId === "t2")!.gone).toBe(true);
    expect(items.find((i) => i.targetId === "t1")!.gone).toBe(false);
  });

  it("a malformed payload returns null — the panel's failure trigger", () => {
    expect(savesOfResponse({})).toBeNull();
    expect(savesOfResponse(null)).toBeNull();
    expect(savesOfResponse({ saves: "nope" })).toBeNull();
  });
});
