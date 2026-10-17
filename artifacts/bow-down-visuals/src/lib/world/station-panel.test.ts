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
 * Kept working alongside: the editor step-through seeding
 * (newestEditorProjectId / editorStepthroughSearch). The legacy
 * page-target router table (panelRouteFor / PANEL_ROUTE_PATHS /
 * splitPanelPath) was deleted with the router at the plan's
 * Step 8 — the pins below prove no station can resolve to a page
 * mount, and the deleted names no longer exist to resolve to.
 */
import { describe, it, expect } from "vitest";
import {
  stationGuestBlocked,
  resolveStationPanel,
  TRANSFER_BUTTON_LABEL,
  newestEditorProjectId,
  editorStepthroughSearch,
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

describe("the Treasury — three customs, verified native (Lane 8)", () => {
  const treasury: Record<string, string> = {
    "daily-drop": "treasury-daily",
    "shark-drops": "treasury-shark",
    "quest-board": "treasury-quests",
  };

  it("every Treasury station resolves to its custom panel for members — never a page mount", () => {
    for (const [id, customId] of Object.entries(treasury)) {
      const s = STATION_BY_ID.get(id)!;
      expect(s.roomId, id).toBe("world:treasury");
      const r = resolveStationPanel(s, false);
      expect(r.type, id).toBe("custom");
      if (r.type === "custom") expect(r.id, id).toBe(customId);
    }
  });

  it("no Treasury panel path resolves to a page mount, for guests or members", () => {
    for (const id of Object.keys(treasury)) {
      const s = STATION_BY_ID.get(id)!;
      for (const isGuest of [false, true]) {
        const r = resolveStationPanel(s, isGuest);
        expect(["custom", "guest-pitch"], `${id} guest=${isGuest}`).toContain(r.type);
        expect(r.type, id).not.toBe("page");
        expect(r.type, id).not.toBe("native");
        expect(r.type, id).not.toBe("stepthrough");
      }
    }
  });

  it("the Treasury customs carry no transfer target — they never auto-opened a page", () => {
    for (const id of Object.keys(treasury)) {
      expect(STATION_BY_ID.get(id)!.websitePath, id).toBeNull();
      expect(STATION_BY_ID.get(id)!.membersOnly, id).toBe(true);
    }
  });

  it("guests at the Treasury get the pitch, members the panels (pin e, Treasury cut)", () => {
    for (const id of Object.keys(treasury)) {
      const s = STATION_BY_ID.get(id)!;
      expect(resolveStationPanel(s, true).type, id).toBe("guest-pitch");
      expect(resolveStationPanel(s, false).type, id).toBe("custom");
    }
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

describe("the editor station's shape (the router that once excluded it is gone)", () => {
  it("the editor station is a step-through, never a panel route", () => {
    const editor = STATION_BY_ID.get("visual-vibes-editor")!;
    expect(editor.panel.kind).toBe("stepthrough");
    expect(resolveStationPanel(editor, false).type).toBe("stepthrough");
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
