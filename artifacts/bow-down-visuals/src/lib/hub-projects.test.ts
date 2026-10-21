/**
 * hub-projects — the My Projects hub list seam pins.
 *
 * The DTO shapes below are the list route's own payload
 * (routes/hub-projects.ts: GET /hub/projects returns summaries
 * newest-first under a hard LIMIT 100; DELETE /hub/project?id=
 * removes one, the bare DELETE removes ALL). The parser must render
 * exactly what the rail returns — order included — and the delete
 * builder must never produce the bare clear-all shape.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  HUB_PROJECTS_LIST_CAP,
  hubProjectByIdRequest,
  hubProjectDeleteRequest,
  hubProjectTypeLabel,
  hubProjectsListCapped,
  isCurrentHubProject,
  parseHubProjectPayload,
  parseHubProjectsList,
  type HubProjectSummary,
} from "./hub-projects";

function row(partial: Partial<HubProjectSummary> & { id: string }): HubProjectSummary {
  return {
    name: "Project",
    type: "song",
    artistVaultId: null,
    updatedAt: 0,
    ...partial,
  };
}

describe("parseHubProjectsList — renders the rail's rows, in the rail's order", () => {
  it("round-trips the real DTO shape field-for-field", () => {
    const payload = {
      projects: [
        { id: "p-new", name: "Midnight Run", type: "song", artistVaultId: "vault-1", updatedAt: 1792400000000 },
        { id: "p-old", name: "First Cut", type: "video", artistVaultId: null, updatedAt: 1791000000000 },
      ],
    };
    expect(parseHubProjectsList(payload)).toEqual([
      { id: "p-new", name: "Midnight Run", type: "song", artistVaultId: "vault-1", updatedAt: 1792400000000 },
      { id: "p-old", name: "First Cut", type: "video", artistVaultId: null, updatedAt: 1791000000000 },
    ]);
  });

  it("preserves server order exactly — never re-sorts by timestamp", () => {
    const payload = {
      projects: [
        { id: "a", name: "A", type: "song", artistVaultId: null, updatedAt: 100 },
        { id: "b", name: "B", type: "song", artistVaultId: null, updatedAt: 999 },
        { id: "c", name: "C", type: "song", artistVaultId: null, updatedAt: 50 },
      ],
    };
    expect(parseHubProjectsList(payload).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("degrades malformed payloads to an empty list, never phantom rows", () => {
    expect(parseHubProjectsList(null)).toEqual([]);
    expect(parseHubProjectsList(undefined)).toEqual([]);
    expect(parseHubProjectsList({})).toEqual([]);
    expect(parseHubProjectsList({ projects: "nope" })).toEqual([]);
    expect(parseHubProjectsList({ projects: [null, 42, "x"] })).toEqual([]);
  });

  it("drops rows without a usable id or name; defaults the rest honestly", () => {
    const payload = {
      projects: [
        { id: "", name: "No id", type: "song", artistVaultId: null, updatedAt: 5 },
        { id: "x", name: "", type: "song", artistVaultId: null, updatedAt: 5 },
        { id: "kept", name: "Kept", type: 7, artistVaultId: 9, updatedAt: "soon" },
      ],
    };
    expect(parseHubProjectsList(payload)).toEqual([
      { id: "kept", name: "Kept", type: "", artistVaultId: null, updatedAt: 0 },
    ]);
  });
});

describe("hubProjectDeleteRequest — always the id-scoped delete", () => {
  it("carries ?id= and the DELETE method", () => {
    const req = hubProjectDeleteRequest("abc-123");
    expect(req.method).toBe("DELETE");
    expect(req.url).toBe("/api/hub/project?id=abc-123");
  });

  it("never produces the bare clear-all URL, and encodes the id", () => {
    const req = hubProjectDeleteRequest("a b/c?d");
    expect(req.url).not.toBe("/api/hub/project");
    expect(req.url).toBe("/api/hub/project?id=a%20b%2Fc%3Fd");
  });
});

describe("hubProjectByIdRequest — the open-by-id read", () => {
  it("targets the by-id route with a GET", () => {
    const req = hubProjectByIdRequest("abc-123");
    expect(req.method).toBe("GET");
    expect(req.url).toBe("/api/hub/projects/abc-123");
  });

  it("encodes the id as a single path segment", () => {
    expect(hubProjectByIdRequest("a b/c?d").url).toBe("/api/hub/projects/a%20b%2Fc%3Fd");
  });
});

describe("parseHubProjectPayload — the by-id payload, normalized honestly", () => {
  const wire = {
    project: {
      id: "row-1",
      clientRef: "proj-local-1",
      name: "Midnight Run",
      type: "song",
      assets: [
        {
          id: "asset-1", kind: "song", url: "https://example.com/song.mp3",
          label: "Song One", detail: "the single", meta: { genre: "trap" }, createdAt: 123,
        },
      ],
      concept: "a brief",
      templateKey: "song-starter",
      attribution: false,
      artistVaultId: "vault-1",
      updatedAt: 1792400000000,
    },
  };

  it("round-trips the real DTO shape field-for-field", () => {
    expect(parseHubProjectPayload(wire)).toEqual({
      id: "row-1",
      clientRef: "proj-local-1",
      name: "Midnight Run",
      type: "song",
      assets: [
        {
          id: "asset-1", kind: "song", url: "https://example.com/song.mp3",
          label: "Song One", detail: "the single", meta: { genre: "trap" }, createdAt: 123,
        },
      ],
      concept: "a brief",
      templateKey: "song-starter",
      attribution: false,
      artistVaultId: "vault-1",
      updatedAt: 1792400000000,
    });
  });

  it("a null or missing project reads as null — a failed open, not an empty project", () => {
    expect(parseHubProjectPayload({ project: null })).toBeNull();
    expect(parseHubProjectPayload({})).toBeNull();
    expect(parseHubProjectPayload(null)).toBeNull();
    expect(parseHubProjectPayload("nope")).toBeNull();
  });

  it("a project without a usable id or name reads as null", () => {
    expect(parseHubProjectPayload({ project: { name: "No id" } })).toBeNull();
    expect(parseHubProjectPayload({ project: { id: "", name: "No id" } })).toBeNull();
    expect(parseHubProjectPayload({ project: { id: "row-1", name: "" } })).toBeNull();
    expect(parseHubProjectPayload({ project: { id: "row-1" } })).toBeNull();
  });

  it("defaults the rest honestly — legacy rows carry no clientRef, no concept", () => {
    expect(parseHubProjectPayload({ project: { id: "row-9", name: "Legacy" } })).toEqual({
      id: "row-9",
      clientRef: null,
      name: "Legacy",
      type: "",
      assets: [],
      concept: "",
      templateKey: null,
      attribution: true,
      artistVaultId: null,
      updatedAt: 0,
    });
  });

  it("drops assets the Hub cannot hold (no id or url); coerces the rest", () => {
    const parsed = parseHubProjectPayload({
      project: {
        id: "row-1",
        name: "Mixed Bag",
        assets: [
          null,
          42,
          { url: "https://example.com/no-id.mp3", label: "No id" },
          { id: "asset-x", label: "No url" },
          { id: "asset-ok", url: "https://example.com/ok.mp3", kind: 7, createdAt: "soon", meta: { bpm: 120, genre: "trap" } },
        ],
      },
    });
    expect(parsed?.assets).toEqual([
      { id: "asset-ok", url: "https://example.com/ok.mp3", kind: "other", label: "", meta: { genre: "trap" }, createdAt: 0 },
    ]);
  });
});

describe("cap + current-row + labels", () => {
  it("the cap is the rail's own LIMIT 100", () => {
    expect(HUB_PROJECTS_LIST_CAP).toBe(100);
    const full = Array.from({ length: 100 }, (_, i) => row({ id: `p${i}` }));
    const almost = Array.from({ length: 99 }, (_, i) => row({ id: `p${i}` }));
    expect(hubProjectsListCapped(full)).toBe(true);
    expect(hubProjectsListCapped(almost)).toBe(false);
    expect(hubProjectsListCapped([])).toBe(false);
  });

  it("only the first (newest) row is the current hub project", () => {
    expect(isCurrentHubProject(0)).toBe(true);
    expect(isCurrentHubProject(1)).toBe(false);
    expect(isCurrentHubProject(99)).toBe(false);
  });

  it("type labels come from the workflow registry; unknown types stay raw", () => {
    expect(hubProjectTypeLabel("song")).toBe("Song");
    expect(hubProjectTypeLabel("ai-influencer")).toBe("AI Influencer");
    expect(hubProjectTypeLabel("some-future-type")).toBe("some-future-type");
    expect(hubProjectTypeLabel("")).toBe("");
  });
});

describe("HubProjectsSection wiring — the honesty rules are in the source", () => {
  const section = readFileSync(
    new URL("../components/HubProjectsSection.tsx", import.meta.url),
    "utf8",
  );
  const page = readFileSync(new URL("../pages/my-projects.tsx", import.meta.url), "utf8");
  const provider = readFileSync(new URL("./hub-project.tsx", import.meta.url), "utf8");

  it("loads from the real list rail and parses through the seam", () => {
    expect(section).toContain('fetch("/api/hub/projects"');
    expect(section).toContain("parseHubProjectsList(await res.json())");
  });

  it("a failed load is an error state with a retry — never a fake-empty list", () => {
    expect(section).toContain("setLoadError");
    expect(section).toContain('t("myProjects.tryAgain")');
    expect(section).toContain("loadError ? (");
  });

  it("delete confirms first, calls the id-scoped rail, and removes the row only on success", () => {
    const confirmAt = section.indexOf("confirm(");
    const requestAt = section.indexOf("hubProjectDeleteRequest(row.id)");
    const okCheckAt = section.indexOf("if (!res.ok) throw", requestAt);
    const removeAt = section.indexOf("setRows((prev) => prev.filter", requestAt);
    expect(confirmAt).toBeGreaterThan(-1);
    expect(requestAt).toBeGreaterThan(confirmAt);
    expect(okCheckAt).toBeGreaterThan(requestAt);
    expect(removeAt).toBeGreaterThan(okCheckAt);
    expect(section).toContain("setDeleteError");
  });

  it("the badge stays current-row-only, but EVERY row gets the Hub door", () => {
    expect(section).toContain("isCurrentHubProject(index)");
    expect(section).toContain('t("myProjects.hubProjectsCurrent")');
    /* The current row links straight to the Hub… */
    expect(section).toContain('href="/hub"');
    /* …and every other row opens through the by-id rail. */
    expect(section).toContain("hubProjectByIdRequest(row.id)");
    expect(section).toContain('t("myProjects.hubProjectsOpenInHub")');
  });

  it("an open is server-confirmed: fetch, parse, adopt — navigate only after all three", () => {
    const requestAt = section.indexOf("hubProjectByIdRequest(row.id)");
    const okCheckAt = section.indexOf("if (!res.ok) throw", requestAt);
    const parseAt = section.indexOf("parseHubProjectPayload(await res.json())", requestAt);
    const adoptAt = section.indexOf("adoptProject(payload)", requestAt);
    const navigateAt = section.indexOf('setLocation("/hub")', requestAt);
    expect(requestAt).toBeGreaterThan(-1);
    expect(okCheckAt).toBeGreaterThan(requestAt);
    expect(parseAt).toBeGreaterThan(okCheckAt);
    expect(adoptAt).toBeGreaterThan(parseAt);
    expect(navigateAt).toBeGreaterThan(adoptAt);
    /* A failed open surfaces and stays put. */
    expect(section).toContain("setOpenError");
    expect(section).toContain('t("myProjects.failedOpenHubProject")');
  });

  it("the provider adopts under the row's own identity, marked synced before the swap", () => {
    expect(provider).toContain("adoptProject");
    /* Saves after an open must land on the OPENED row: its client ref
       becomes the local id; a legacy row adopts under its server id. */
    expect(provider).toContain("id: payload.clientRef ?? payload.id");
    /* The adopted state is the server's state — it is marked synced
       BEFORE the state swap so the debounced push cannot echo it back. */
    const markAt = provider.indexOf("lastSyncedJson.current = JSON.stringify(adopted)");
    const swapAt = provider.indexOf("setProject(adopted)", markAt);
    expect(markAt).toBeGreaterThan(-1);
    expect(swapAt).toBeGreaterThan(markAt);
  });

  it("is docked inside the My Projects projects tab, not a standalone page", () => {
    const tabAt = page.indexOf('tab === "projects"');
    const sectionAt = page.indexOf("<HubProjectsSection />");
    expect(tabAt).toBeGreaterThan(-1);
    expect(sectionAt).toBeGreaterThan(tabAt);
    expect(page).toContain('from "@/components/HubProjectsSection"');
  });
});
