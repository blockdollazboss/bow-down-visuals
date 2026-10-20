/* ─── Hub projects list seam ────────────────────────────────────────────────
   The account-level hub project list (GET /api/hub/projects) and its
   per-project delete (DELETE /api/hub/project?id=). Until now the only
   frontend consumer of the hub rails was the HubProjectProvider, which
   reads the SINGLE most recent project (GET /api/hub/project) — every
   older synced project was invisible in the UI even though the list
   rail has existed since 0142.

   DTO discipline: the shapes below mirror the list route's payload
   field-for-field (routes/hub-projects.ts). The parser only normalizes
   what the wire actually sends — missing fields degrade to honest
   defaults, never invented values, and the server's order (newest
   first) is preserved exactly: the UI renders what the rail returns. */

import { PROJECT_WORKFLOWS } from "./hub-workflows";

/** One row of GET /api/hub/projects — a summary, not the full project. */
export interface HubProjectSummary {
  id: string;
  name: string;
  type: string;
  artistVaultId: string | null;
  /** Epoch ms of the last save (0 when the row carried no timestamp). */
  updatedAt: number;
}

/** The list route's own hard cap (LIMIT 100 in routes/hub-projects.ts).
    When a full page of rows comes back, the UI may honestly say so. */
export const HUB_PROJECTS_LIST_CAP = 100;

export function hubProjectsListCapped(rows: readonly HubProjectSummary[]): boolean {
  return rows.length >= HUB_PROJECTS_LIST_CAP;
}

/** Parse the list route's payload. Tolerates the real wire the way the
    sibling normalizers do: a malformed payload reads as an empty list,
    and a row without a usable id or name is dropped rather than
    rendered as a phantom project. */
export function parseHubProjectsList(payload: unknown): HubProjectSummary[] {
  if (!payload || typeof payload !== "object") return [];
  const list = (payload as { projects?: unknown }).projects;
  if (!Array.isArray(list)) return [];
  const rows: HubProjectSummary[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row["id"] !== "string" || !row["id"]) continue;
    if (typeof row["name"] !== "string" || !row["name"]) continue;
    rows.push({
      id: row["id"],
      name: row["name"],
      type: typeof row["type"] === "string" ? row["type"] : "",
      artistVaultId: typeof row["artistVaultId"] === "string" ? row["artistVaultId"] : null,
      updatedAt:
        typeof row["updatedAt"] === "number" && Number.isFinite(row["updatedAt"])
          ? row["updatedAt"]
          : 0,
    });
  }
  return rows;
}

/** The list is newest-first and GET /api/hub/project's "current"
    project is the same ordering's first row — so row 0 IS the project
    currently open in the Hub, by the server's own definition. */
export function isCurrentHubProject(index: number): boolean {
  return index === 0;
}

/** Display title for a hub project type — the workflow registry's own
    titles (the same words the Hub's type picker shows). An unknown
    type falls back to the raw stored value, never a guessed label. */
export function hubProjectTypeLabel(type: string): string {
  const workflow = PROJECT_WORKFLOWS.find((w) => w.type === type);
  return workflow ? workflow.title : type;
}

/** The ONLY delete shape this seam builds: id-scoped. The bare
    DELETE /api/hub/project (no ?id=) deletes ALL of the caller's
    synced projects — the list UI must never send it. */
export function hubProjectDeleteRequest(id: string): { url: string; method: "DELETE" } {
  return { url: `/api/hub/project?id=${encodeURIComponent(id)}`, method: "DELETE" };
}
