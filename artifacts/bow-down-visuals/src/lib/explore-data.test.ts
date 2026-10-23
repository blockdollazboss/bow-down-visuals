import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  exploreFailedSections,
  exploreSectionOrEmpty,
  isExploreTotalFailure,
  normalizeExploreData,
} from "./explore-data";

const exploreSource = readFileSync(
  new URL("../pages/explore.tsx", import.meta.url),
  "utf8",
);

interface Item {
  id: string;
}

const emptyExplore = {
  shorts: [],
  creators: [],
  posts: [],
  events: [],
  groups: [],
};

describe("Explore payload guards", () => {
  it("normalizes an empty or missing payload to every section's empty state", () => {
    expect(normalizeExploreData<Item, Item, Item, Item, Item>({})).toEqual(
      emptyExplore,
    );
    expect(normalizeExploreData<Item, Item, Item, Item, Item>(null)).toEqual(
      emptyExplore,
    );
  });

  it("preserves supplied sections while emptying missing sections", () => {
    const shorts = [{ id: "short-1" }];
    const groups = [{ id: "group-1" }];

    expect(
      normalizeExploreData<Item, Item, Item, Item, Item>({ shorts, groups }),
    ).toEqual({
      shorts,
      creators: [],
      posts: [],
      events: [],
      groups,
    });
  });

  it("empties mistyped section fields and guards render collections", () => {
    expect(
      normalizeExploreData<Item, Item, Item, Item, Item>({
        shorts: "not-an-array",
        creators: 42,
        posts: { id: "post-1" },
      }),
    ).toEqual(emptyExplore);
    expect(exploreSectionOrEmpty<Item>(undefined)).toEqual([]);
    expect(exploreSectionOrEmpty<Item>([{ id: "event-1" }])).toEqual([
      { id: "event-1" },
    ]);
  });

  it("wires normalization into Explore's load and render paths", () => {
    expect(exploreSource).toContain("normalizeExploreData<Short, Creator, HotPost, Evt, Grp>");
    expect(exploreSource).toContain("exploreSectionOrEmpty(data.shorts)");
    expect(exploreSource).not.toContain("{data.shorts");
    expect(exploreSource).not.toContain("{data.creators");
    expect(exploreSource).not.toContain("{data.posts");
    expect(exploreSource).not.toContain("{data.events");
    expect(exploreSource).not.toContain("{data.groups");
  });
});

describe("Explore failed sections (S27-29)", () => {
  it("reads the API's failed_sections, keeping only known section names", () => {
    expect(
      exploreFailedSections({
        failed_sections: ["creators", "groups", "nope", 42, null],
      }),
    ).toEqual(["creators", "groups"]);
    expect(exploreFailedSections({})).toEqual([]);
    expect(exploreFailedSections(null)).toEqual([]);
    expect(exploreFailedSections({ failed_sections: "creators" })).toEqual([]);
  });

  it("total failure is exactly every section failing", () => {
    expect(
      isExploreTotalFailure({
        failed_sections: ["shorts", "creators", "posts", "events", "groups"],
      }),
    ).toBe(true);
    expect(isExploreTotalFailure({ failed_sections: ["shorts"] })).toBe(false);
    expect(isExploreTotalFailure({ failed_sections: [] })).toBe(false);
    expect(isExploreTotalFailure(null)).toBe(false);
  });

  it("wires per-section failure states into Explore's render path", () => {
    expect(exploreSource).toContain("exploreFailedSections(raw)");
    expect(exploreSource).toContain("isExploreTotalFailure(raw)");
    expect(exploreSource).toContain('failedSections.includes("shorts")');
    expect(exploreSource).toContain('failedSections.includes("creators")');
    expect(exploreSource).toContain('failedSections.includes("posts")');
    expect(exploreSource).toContain('failedSections.includes("events")');
    expect(exploreSource).toContain('failedSections.includes("groups")');
  });
});
