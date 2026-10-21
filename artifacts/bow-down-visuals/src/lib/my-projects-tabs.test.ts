import { describe, it, expect } from "vitest";
import {
  MY_PROJECTS_TABS,
  isMyProjectsTab,
  parseMyProjectsTab,
} from "./my-projects-tabs";

/* The ?tab= deep-link contract: shipped redirects land on this page
   with a tab promised in the URL — /generations → ?tab=history,
   /my-clips → ?tab=myclips, /songs → ?tab=songs (App.tsx,
   lib/public-routes.ts). Every real tab id must parse back to
   itself; anything else lands on the default Projects tab instead
   of stranding the user on a tab that doesn't exist. */

describe("parseMyProjectsTab", () => {
  it("honors every one of the seven tab ids", () => {
    for (const tab of MY_PROJECTS_TABS) {
      expect(parseMyProjectsTab(`?tab=${tab}`)).toBe(tab);
    }
  });

  it("honors the shipped /generations redirect target (?tab=history)", () => {
    expect(parseMyProjectsTab("?tab=history")).toBe("history");
  });

  it("keeps the tab when other params ride along (songs deep links carry song=/addToAlbum=)", () => {
    expect(parseMyProjectsTab("?tab=songs&song=abc&addToAlbum=1")).toBe("songs");
    expect(parseMyProjectsTab("?song=abc&tab=drafts")).toBe("drafts");
  });

  it("defaults to projects when the param is absent", () => {
    expect(parseMyProjectsTab("")).toBe("projects");
    expect(parseMyProjectsTab("?song=abc")).toBe("projects");
  });

  it("defaults to projects for unknown or malformed values", () => {
    expect(parseMyProjectsTab("?tab=nope")).toBe("projects");
    expect(parseMyProjectsTab("?tab=")).toBe("projects");
    expect(parseMyProjectsTab("?tab=HISTORY")).toBe("projects");
    expect(parseMyProjectsTab("not a query string")).toBe("projects");
  });
});

describe("isMyProjectsTab", () => {
  it("accepts exactly the seven ids", () => {
    expect(MY_PROJECTS_TABS).toHaveLength(7);
    for (const tab of MY_PROJECTS_TABS) expect(isMyProjectsTab(tab)).toBe(true);
    expect(isMyProjectsTab("Projects")).toBe(false);
    expect(isMyProjectsTab("")).toBe(false);
    expect(isMyProjectsTab(null)).toBe(false);
    expect(isMyProjectsTab(undefined)).toBe(false);
  });
});
