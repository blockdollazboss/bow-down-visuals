/**
 * catalog-desk — the Catalog Import desk's pure logic seam
 * (stack1500 world parity wave #3, census item 11).
 *
 * THE FEATURE (website): Catalog Import (pages/catalog-import
 * .tsx) — bring your existing catalog home: scan a connected
 * Instagram / Facebook account for your own posts, bring the
 * files home, let the rebuild restore what re-uploading loses
 * (title, description, tags, captions, chapters, series), and
 * approve each piece onto your profile. Uploads join the same
 * pipeline. Followers do NOT transfer and nothing pretends
 * otherwise (the rail's own honesty lines ride the state and
 * the desk renders them verbatim).
 *
 * THE RAILS (routes/catalog-import.ts, all requireAuth, all
 * FREE — the scan path carries a registry row at cost 0):
 *   GET  /api/catalog-import → { accounts, items, honesty }
 *   POST /api/catalog-import/scan { accountId } → state
 *   POST /api/catalog-import/fetch { itemIds } → state
 *   POST /api/catalog-import/uploads { files: [{ key, filename,
 *        kind, contentType }] } → { items } — keys come from
 *        POST /api/r2/presign-upload + a PUT, the page's flow,
 *        under the caller's own prefix.
 *   POST /api/catalog-import/items/:id/fetch | /rebuild |
 *        /approve { title?, description?, tags?, series? } |
 *        /dismiss → { item }
 *   POST /api/catalog-import/approve { itemIds } →
 *        { results: [...] }
 *
 * ITEM LIFECYCLE (the schema's statuses): listed (on the
 * platform) → fetching → here (home, needs its details) →
 * ready (draft ready for your word) → approved (home);
 * blocked (the platform won't hand it over — statusNote says
 * why, in plain words), failed (bring-in didn't land — retry),
 * dismissed.
 *
 * DRIFT DISCIPLINE: items missing their id/title or carrying a
 * status outside the lifecycle are dropped; a state body that
 * isn't the state reads as failure. Draft rows render only the
 * fields the draft itself carries.
 */
import { getCreditCost } from "../credit-costs";

export const CATALOG_PATH = "/api/catalog-import";
export const CATALOG_SCAN_PATH = "/api/catalog-import/scan";
export const CATALOG_FETCH_PATH = "/api/catalog-import/fetch";
export const CATALOG_UPLOADS_PATH = "/api/catalog-import/uploads";
export const CATALOG_APPROVE_BATCH_PATH = "/api/catalog-import/approve";
export const CATALOG_PRESIGN_PATH = "/api/r2/presign-upload";

export function catalogItemPath(id: string, action: "fetch" | "rebuild" | "approve" | "dismiss"): string {
  return `${CATALOG_PATH}/items/${encodeURIComponent(id)}/${action}`;
}

/** Free — the scan rail's registry row, pinned at 0. */
export const CATALOG_SCAN_COST = getCreditCost(CATALOG_SCAN_PATH)?.cost ?? -1;

export const CATALOG_STATUSES = [
  "listed",
  "fetching",
  "here",
  "ready",
  "approved",
  "blocked",
  "failed",
  "dismissed",
] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

/** The website's own status words (en catalogImport.status*). */
export const CATALOG_STATUS_LABELS: Record<CatalogStatus, string> = {
  listed: "On the platform",
  fetching: "Bringing in…",
  here: "Home — needs its details",
  ready: "Draft ready for your word",
  approved: "Home",
  blocked: "Platform won't hand it over",
  failed: "Bring-in didn't land",
  dismissed: "Dismissed",
};

export const CATALOG_PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
};

export interface CatalogAccount {
  accountId: string | null;
  platform: string;
  username: string | null;
  state: "ready" | "blocked" | "link-only";
  note: string | null;
  itemCount: number;
}

export interface CatalogDraft {
  title: string;
  description: string;
  tags: string[];
  captions: string | null;
  chapters: Array<{ atSec: number; label: string }>;
  series: { name: string; season: number; episode: number } | null;
  source: "ai" | "assembled";
}

export interface CatalogItem {
  id: string;
  sourceKind: "connected" | "upload";
  platform: string | null;
  kind: "video" | "audio";
  title: string;
  originalUrl: string | null;
  durationSec: number | null;
  status: CatalogStatus;
  statusNote: string | null;
  draft: CatalogDraft | null;
  targetKind: "profile_video" | "song" | null;
}

export interface CatalogState {
  accounts: CatalogAccount[];
  items: CatalogItem[];
  honesty: { movesLine: string; tiktokBlocked: string; linkOnly: string; noFileUrl: string };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function draftOf(raw: unknown): CatalogDraft | null {
  if (!isRecord(raw)) return null;
  const chapters: CatalogDraft["chapters"] = [];
  if (Array.isArray(raw["chapters"])) {
    for (const c of raw["chapters"]) {
      if (!isRecord(c)) continue;
      const atSec = numOrNull(c["atSec"]);
      const label = str(c["label"]);
      if (atSec === null || !label) continue;
      chapters.push({ atSec, label });
    }
  }
  let series: CatalogDraft["series"] = null;
  if (isRecord(raw["series"])) {
    const name = str(raw["series"]["name"]);
    const season = numOrNull(raw["series"]["season"]);
    const episode = numOrNull(raw["series"]["episode"]);
    if (name && season !== null && episode !== null) series = { name, season, episode };
  }
  return {
    title: str(raw["title"]),
    description: str(raw["description"]),
    tags: Array.isArray(raw["tags"]) ? raw["tags"].filter((t): t is string => typeof t === "string") : [],
    captions: strOrNull(raw["captions"]),
    chapters,
    series,
    source: raw["source"] === "ai" ? "ai" : "assembled",
  };
}

export function catalogItemOf(raw: unknown): CatalogItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw["id"]);
  const title = str(raw["title"]);
  const status = str(raw["status"]);
  if (!id || !title || !(CATALOG_STATUSES as readonly string[]).includes(status)) return null;
  return {
    id,
    sourceKind: raw["sourceKind"] === "upload" ? "upload" : "connected",
    platform: strOrNull(raw["platform"]),
    kind: raw["kind"] === "audio" ? "audio" : "video",
    title,
    originalUrl: strOrNull(raw["originalUrl"]),
    durationSec: numOrNull(raw["durationSec"]),
    status: status as CatalogStatus,
    statusNote: strOrNull(raw["statusNote"]),
    draft: draftOf(raw["draft"]),
    targetKind:
      raw["targetKind"] === "profile_video" || raw["targetKind"] === "song"
        ? raw["targetKind"]
        : null,
  };
}

export function catalogStateOf(data: unknown): CatalogState | null {
  if (!isRecord(data) || !Array.isArray(data["accounts"]) || !Array.isArray(data["items"])) {
    return null;
  }
  const accounts: CatalogAccount[] = [];
  for (const row of data["accounts"]) {
    if (!isRecord(row)) continue;
    const platform = str(row["platform"]);
    if (!platform) continue;
    accounts.push({
      accountId: strOrNull(row["accountId"]),
      platform,
      username: strOrNull(row["username"]),
      state: row["state"] === "blocked" || row["state"] === "link-only" ? row["state"] : "ready",
      note: strOrNull(row["note"]),
      itemCount: numOrNull(row["itemCount"]) ?? 0,
    });
  }
  const items: CatalogItem[] = [];
  for (const row of data["items"]) {
    const item = catalogItemOf(row);
    if (item) items.push(item);
  }
  const honesty = isRecord(data["honesty"]) ? data["honesty"] : {};
  return {
    accounts,
    items,
    honesty: {
      movesLine: str(honesty["movesLine"]),
      tiktokBlocked: str(honesty["tiktokBlocked"]),
      linkOnly: str(honesty["linkOnly"]),
      noFileUrl: str(honesty["noFileUrl"]),
    },
  };
}

/* ── Groups + actions (the page's own arrangement) ────────────────── */

export function listedItems(state: CatalogState): CatalogItem[] {
  return state.items.filter((i) => i.status === "listed" || i.status === "failed");
}

/** Everything still on the platform side of the journey —
 *  including in-flight and blocked rows, which must stay visible
 *  with their status notes rather than vanishing. */
export function platformItems(state: CatalogState): CatalogItem[] {
  return state.items.filter(
    (i) => i.status === "listed" || i.status === "failed" || i.status === "blocked" || i.status === "fetching",
  );
}

export function waitingItems(state: CatalogState): CatalogItem[] {
  return state.items.filter((i) => i.status === "here" || i.status === "ready");
}

export function approvedItems(state: CatalogState): CatalogItem[] {
  return state.items.filter((i) => i.status === "approved");
}

export function readyItems(state: CatalogState): CatalogItem[] {
  return state.items.filter((i) => i.status === "ready");
}

/* ── Payloads ─────────────────────────────────────────────────────── */

export function buildScanPayload(accountId: string) {
  return { accountId };
}

export function buildFetchPayload(itemIds: readonly string[]) {
  return { itemIds: [...itemIds] };
}

export interface CatalogApproveEdits {
  title: string;
  description: string;
  tagsInput: string;
}

/** The approve body from the edit fields (the page's split: tags
 *  ride comma-separated in the form, a clean array on the wire).
 *  An untouched draft approves with {} — the rail takes the
 *  draft as-is. */
export function buildApprovePayload(edits: CatalogApproveEdits | null) {
  if (!edits) return {};
  return {
    title: edits.title.trim(),
    description: edits.description,
    tags: edits.tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8),
  };
}

export function editsFromDraft(draft: CatalogDraft): CatalogApproveEdits {
  return { title: draft.title, description: draft.description, tagsInput: draft.tags.join(", ") };
}

export interface CatalogUploadFile {
  key: string;
  filename: string;
  kind: "video" | "audio";
  contentType: string;
}

export function buildUploadsPayload(files: readonly CatalogUploadFile[]) {
  return { files: files.map((f) => ({ ...f })) };
}

/** The upload key under the caller's own prefix (the page's
 *  construction — the rail refuses keys outside it). */
export function catalogUploadKey(userId: string, uuid: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80);
  return `${userId}/catalog-import/${uuid}-${safe}`;
}

export function catalogUploadKind(fileType: string): "video" | "audio" {
  return fileType.startsWith("audio/") ? "audio" : "video";
}

/** Count the ok rows in a batch-approve answer. */
export function batchApprovedCount(data: unknown): number | null {
  if (!isRecord(data) || !Array.isArray(data["results"])) return null;
  return data["results"].filter((r) => isRecord(r) && r["ok"] === true).length;
}
