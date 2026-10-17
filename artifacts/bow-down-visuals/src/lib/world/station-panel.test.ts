import { describe, it, expect } from "vitest";
import { splitPanelPath, stationGuestBlocked } from "./station-panel";
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
