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
  hubProjectDeleteRequest,
  hubProjectTypeLabel,
  hubProjectsListCapped,
  isCurrentHubProject,
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

  it("the current row — and only it — gets the badge and the Hub door", () => {
    expect(section).toContain("isCurrentHubProject(index)");
    expect(section).toContain('href="/hub"');
    expect(section).toContain('t("myProjects.hubProjectsCurrent")');
  });

  it("is docked inside the My Projects projects tab, not a standalone page", () => {
    const tabAt = page.indexOf('tab === "projects"');
    const sectionAt = page.indexOf("<HubProjectsSection />");
    expect(tabAt).toBeGreaterThan(-1);
    expect(sectionAt).toBeGreaterThan(tabAt);
    expect(page).toContain('from "@/components/HubProjectsSection"');
  });
});
