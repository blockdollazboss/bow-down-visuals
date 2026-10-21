/* ─── Hub projects list seam ────────────────────────────────────────────────
   The account-level hub project list (GET /api/hub/projects), its
   per-project delete (DELETE /api/hub/project?id=), and the by-id
   payload read (GET /api/hub/projects/:id) that opens any row in the
   Hub. Until the list seam landed, the only frontend consumer of the
   hub rails was the HubProjectProvider, which reads the SINGLE most
   recent project (GET /api/hub/project) — every older synced project
   was invisible in the UI even though the list rail has existed
   since 0142.

   DTO discipline: the shapes below mirror the routes' payloads
   field-for-field (routes/hub-projects.ts). The parsers only normalize
   what the wire actually sends — missing fields degrade to honest
   defaults, never invented values, and the server's order (newest
   first) is preserved exactly: the UI renders what the rail returns. */

import { PROJECT_WORKFLOWS } from "./hub-workflows";
import type { HubAsset } from "./hub-project";

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

/** The by-id read that opens a project: GET /api/hub/projects/:id —
    the full payload of ONE of the caller's own projects (the route
    404s another member's id, so a row the list showed can still
    honestly fail to open if it was deleted elsewhere meanwhile). */
export function hubProjectByIdRequest(id: string): { url: string; method: "GET" } {
  return { url: `/api/hub/projects/${encodeURIComponent(id)}`, method: "GET" };
}

/** The full payload of GET /api/hub/projects/:id — the same shape
    GET /api/hub/project returns for the most recent project. */
export interface HubProjectPayload {
  /** The server row id. */
  id: string;
  /** The client ref the row saves under (null on a pre-0142 legacy row). */
  clientRef: string | null;
  name: string;
  type: string;
  assets: HubAsset[];
  concept: string;
  templateKey: string | null;
  attribution: boolean;
  artistVaultId: string | null;
  /** Epoch ms of the last save (0 when the row carried no timestamp). */
  updatedAt: number;
}

/** One asset off the wire. An entry without a usable id or url is not
    an asset the Hub can hold — it is dropped, never repaired with an
    invented placeholder; the remaining fields degrade honestly. */
function parseHubAsset(raw: unknown): HubAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a["id"] !== "string" || !a["id"]) return null;
  if (typeof a["url"] !== "string" || !a["url"]) return null;
  const meta: Record<string, string> = {};
  if (a["meta"] && typeof a["meta"] === "object" && !Array.isArray(a["meta"])) {
    for (const [k, v] of Object.entries(a["meta"] as Record<string, unknown>)) {
      if (typeof v === "string") meta[k] = v;
    }
  }
  return {
    id: a["id"],
    kind: (typeof a["kind"] === "string" && a["kind"] ? a["kind"] : "other") as HubAsset["kind"],
    url: a["url"],
    label: typeof a["label"] === "string" ? a["label"] : "",
    ...(typeof a["detail"] === "string" ? { detail: a["detail"] } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
    createdAt:
      typeof a["createdAt"] === "number" && Number.isFinite(a["createdAt"]) ? a["createdAt"] : 0,
  };
}

/** Parse the by-id route's payload. A missing/null project, or one
    without a usable id or name, reads as null — the caller treats
    that as a failed open and keeps the project it already has; a
    half-parsed project must never replace it. */
export function parseHubProjectPayload(payload: unknown): HubProjectPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const project = (payload as { project?: unknown }).project;
  if (!project || typeof project !== "object") return null;
  const p = project as Record<string, unknown>;
  if (typeof p["id"] !== "string" || !p["id"]) return null;
  if (typeof p["name"] !== "string" || !p["name"]) return null;
  return {
    id: p["id"],
    clientRef: typeof p["clientRef"] === "string" && p["clientRef"] ? p["clientRef"] : null,
    name: p["name"],
    type: typeof p["type"] === "string" ? p["type"] : "",
    assets: Array.isArray(p["assets"])
      ? p["assets"].map(parseHubAsset).filter((a): a is HubAsset => a !== null)
      : [],
    concept: typeof p["concept"] === "string" ? p["concept"] : "",
    templateKey: typeof p["templateKey"] === "string" ? p["templateKey"] : null,
    attribution: typeof p["attribution"] === "boolean" ? p["attribution"] : true,
    artistVaultId: typeof p["artistVaultId"] === "string" ? p["artistVaultId"] : null,
    updatedAt:
      typeof p["updatedAt"] === "number" && Number.isFinite(p["updatedAt"]) ? p["updatedAt"] : 0,
  };
}
