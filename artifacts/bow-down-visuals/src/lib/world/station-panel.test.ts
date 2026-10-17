import { describe, it, expect } from "vitest";
import {
  splitPanelPath,
  stationGuestBlocked,
  newestEditorProjectId,
  editorStepthroughSearch,
} from "./station-panel";
import { STATION_BY_ID } from "./stations";

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
