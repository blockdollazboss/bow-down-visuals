/**
 * station-panel — the pure seam between a station and its panel.
 *
 * Registry v2 pins (NATIVE-PLAN §3.0):
 * (b) resolving ANY station yields guest-pitch / native / custom /
 *     stepthrough — never a page-component mount (the resolution
 *     union has no page variant, and these tests walk all 27);
 * (c) a native resolution's transfer href is the station's exact
 *     former website path (the full table lives in stations.test);
 * (d) customs + the step-through resolve exactly as they did in v1;
 * (e) members-only stations resolve to the guest pitch for guests,
 *     for every kind — and to their real surface for members.
 *
 * Kept working alongside: splitPanelPath (the legacy page-target
 * router's splitter), the editor step-through seeding
 * (newestEditorProjectId / editorStepthroughSearch), and the
 * legacy route table itself (panelRouteFor / PANEL_ROUTE_PATHS —
 * deleted at the plan's Step 8, still serving bare-page targets).
 */
import { describe, it, expect } from "vitest";
import {
  splitPanelPath,
  stationGuestBlocked,
  resolveStationPanel,
  TRANSFER_BUTTON_LABEL,
  newestEditorProjectId,
  editorStepthroughSearch,
  panelRouteFor,
  PANEL_ROUTE_PATHS,
} from "./station-panel";
import { STATION_BY_ID, PALACE_STATIONS } from "./stations";

describe("resolveStationPanel — registry v2 resolution (pins b, d, e)", () => {
  it("no station ever resolves to a page mount, for guests or members (pin b)", () => {
    for (const s of PALACE_STATIONS) {
      for (const isGuest of [false, true]) {
        const r = resolveStationPanel(s, isGuest);
        expect(["guest-pitch", "native", "custom", "stepthrough"], `${s.id} guest=${isGuest}`).toContain(r.type);
        expect(r.type, s.id).not.toBe("page");
        expect(r.station).toBe(s);
      }
    }
  });

  it("every native station resolves native, with its pattern and exact transfer href (pins b, c)", () => {
    for (const s of PALACE_STATIONS) {
      if (s.panel.kind !== "native" || s.membersOnly) continue;
      const r = resolveStationPanel(s, false);
      expect(r.type, s.id).toBe("native");
      if (r.type === "native") {
        expect(r.pattern, s.id).toBe(s.panel.kind === "native" ? s.panel.pattern : null);
        expect(r.websitePath, s.id).toBe(s.websitePath);
        expect(r.websitePath.startsWith("/"), s.id).toBe(true);
      }
    }
    // Members at members-only native desks resolve native too.
    for (const s of PALACE_STATIONS) {
      if (s.panel.kind !== "native") continue;
      const r = resolveStationPanel(s, false);
      expect(r.type, s.id).toBe("native");
    }
  });

  it("the transfer hrefs are the exact former auto-open paths, deep links included (pin c)", () => {
    const href = (id: string) => {
      const r = resolveStationPanel(STATION_BY_ID.get(id)!, false);
      if (r.type !== "native") throw new Error(`${id} did not resolve native`);
      return r.websitePath;
    };
    expect(href("song-desk")).toBe("/create?panel=song");
    expect(href("branding-shop-desk")).toBe("/branding-kit?tab=shop");
    expect(href("branding-kit-desk")).toBe("/branding-kit");
    expect(href("post-office")).toBe("/messages");
    expect(href("get-paid-room")).toBe("/earnings");
  });

  it("customs resolve to their unchanged custom ids (pin d)", () => {
    const expected: Record<string, string> = {
      "kingdom-board": "kingdom-board",
      jukebox: "jukebox",
      "daily-drop": "treasury-daily",
      "shark-drops": "treasury-shark",
      "quest-board": "treasury-quests",
      "front-row-gallery": "front-row",
    };
    for (const [id, customId] of Object.entries(expected)) {
      const r = resolveStationPanel(STATION_BY_ID.get(id)!, false);
      expect(r.type, id).toBe("custom");
      if (r.type === "custom") expect(r.id, id).toBe(customId);
    }
  });

  it("the editor resolves stepthrough with its path, unchanged (pin d)", () => {
    const r = resolveStationPanel(STATION_BY_ID.get("visual-vibes-editor")!, false);
    expect(r.type).toBe("stepthrough");
    if (r.type === "stepthrough") expect(r.path).toBe("/video-editor");
  });

  it("members-only stations produce the guest pitch for guests — every kind (pin e)", () => {
    for (const s of PALACE_STATIONS) {
      if (!s.membersOnly) continue;
      expect(resolveStationPanel(s, true).type, s.id).toBe("guest-pitch");
      // …and their real surface for members.
      expect(resolveStationPanel(s, false).type, s.id).not.toBe("guest-pitch");
    }
    // Named cases: a native desk, a custom rail, the step-through.
    expect(resolveStationPanel(STATION_BY_ID.get("post-office")!, true).type).toBe("guest-pitch");
    expect(resolveStationPanel(STATION_BY_ID.get("daily-drop")!, true).type).toBe("guest-pitch");
    expect(resolveStationPanel(STATION_BY_ID.get("visual-vibes-editor")!, true).type).toBe("guest-pitch");
  });

  it("open stations never pitch a guest (pin e)", () => {
    for (const s of PALACE_STATIONS) {
      if (s.membersOnly) continue;
      expect(resolveStationPanel(s, true).type, s.id).not.toBe("guest-pitch");
    }
    expect(resolveStationPanel(STATION_BY_ID.get("jukebox")!, true).type).toBe("custom");
    expect(resolveStationPanel(STATION_BY_ID.get("charts-desk")!, true).type).toBe("native");
  });

  it("the transfer button label is exact and uniform (owner ruling Q3)", () => {
    expect(TRANSFER_BUTTON_LABEL).toBe("Open on the website ↗");
  });
});

describe("splitPanelPath", () => {
  it("splits the Create house's panel deep links", () => {
    expect(splitPanelPath("/create?panel=song")).toEqual({
      pathname: "/create",
      search: "panel=song",
    });
  });
  it("splits the branding shop's tab link", () => {
    expect(splitPanelPath("/branding-kit?tab=shop")).toEqual({
      pathname: "/branding-kit",
      search: "tab=shop",
    });
  });
  it("leaves a bare path whole", () => {
    expect(splitPanelPath("/arcade")).toEqual({ pathname: "/arcade", search: "" });
  });
});

describe("newestEditorProjectId", () => {
  it("no projects → no deep link (the step-through opens fresh)", () => {
    expect(newestEditorProjectId([])).toBeNull();
  });
  it("picks the greatest created_at, whatever the list order", () => {
    expect(
      newestEditorProjectId([
        { id: "old", created_at: "2026-09-01T10:00:00Z" },
        { id: "newest", created_at: "2026-10-15T10:00:00Z" },
        { id: "mid", created_at: "2026-10-02T10:00:00Z" },
      ]),
    ).toBe("newest");
  });
  it("keeps list order on ties and unreadable stamps", () => {
    expect(
      newestEditorProjectId([
        { id: "first", created_at: "not-a-date" },
        { id: "second", created_at: null },
      ]),
    ).toBe("first");
  });
  it("skips rows without a usable id", () => {
    expect(
      newestEditorProjectId([
        { id: "", created_at: "2026-10-15T10:00:00Z" },
        { id: "real", created_at: "2026-09-01T10:00:00Z" },
      ]),
    ).toBe("real");
  });
});

describe("editorStepthroughSearch", () => {
  it("builds the ?project= deep link the editor reads", () => {
    expect(editorStepthroughSearch("proj-123")).toBe("project=proj-123");
  });
  it("escapes the id and stays empty without one", () => {
    expect(editorStepthroughSearch("a b/c")).toBe("project=a%20b%2Fc");
    expect(editorStepthroughSearch(null)).toBe("");
  });
});

describe("panelRouteFor — the legacy page-target router's reach (Step 8 deletes this)", () => {
  it("covers every native station's former website path (now its transfer target)", () => {
    for (const s of PALACE_STATIONS) {
      if (s.panel.kind !== "native" || !s.websitePath) continue;
      const { pathname } = splitPanelPath(s.websitePath);
      expect(panelRouteFor(pathname), s.id).not.toBeNull();
    }
  });

  it("covers the hub destinations the panels' pages link to", () => {
    for (const p of [
      "/dashboard",
      "/my-music",
      "/charts",
      "/community",
      "/promote",
      "/earnings",
      "/memberships",
      "/storefronts",
      "/arcade",
      "/party",
      "/messages",
      "/coach",
      "/my-projects",
      "/credit-history",
      "/distribute",
      "/scheduler",
    ]) {
      expect(panelRouteFor(p), p).toBe(p);
    }
  });

  it("resolves the deep links: a post, a track, a watch page, a shop, a profile", () => {
    expect(panelRouteFor("/post/42")).toBe("/post/:id");
    expect(panelRouteFor("/track/abc-123")).toBe("/track/:id");
    expect(panelRouteFor("/watch/xyz")).toBe("/watch/:id");
    expect(panelRouteFor("/shop/some-handle")).toBe("/shop/:slug");
    expect(panelRouteFor("/artist/thy-cheat-code")).toBe("/artist/:slug");
  });

  it("leaves the deliberately unhung doors to the miss card", () => {
    for (const p of [
      "/login",
      "/signup",
      "/settings",
      "/video-editor",
      "/shorts",
      "/my-shop",
      "/admin",
      "/",
      "/post", // missing its id
      "/post/1/comments", // deeper than the door reaches
      "/shop", // missing its slug
    ]) {
      expect(panelRouteFor(p), p).toBeNull();
    }
  });

  it("the route table has no duplicates", () => {
    expect(new Set(PANEL_ROUTE_PATHS).size).toBe(PANEL_ROUTE_PATHS.length);
  });

  it("the editor station is a step-through, not a panel route", () => {
    const editor = STATION_BY_ID.get("visual-vibes-editor")!;
    expect(editor.panel.kind).toBe("stepthrough");
    expect(panelRouteFor("/video-editor")).toBeNull();
  });
});

describe("stationGuestBlocked", () => {
  it("blocks a guest at a members-only door (the editor)", () => {
    const editor = STATION_BY_ID.get("visual-vibes-editor")!;
    expect(stationGuestBlocked(editor, true)).toBe(true);
    expect(stationGuestBlocked(editor, false)).toBe(false);
  });
  it("never blocks an open door (the jukebox, the gallery)", () => {
    expect(stationGuestBlocked(STATION_BY_ID.get("jukebox")!, true)).toBe(false);
    expect(stationGuestBlocked(STATION_BY_ID.get("front-row-gallery")!, true)).toBe(false);
  });
});
