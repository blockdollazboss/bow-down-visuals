/**
 * saved-desk — the Saved desk's pure logic seam
 * (stack1500 world parity wave #3, census item 30).
 *
 * THE FEATURE (website): Saved (pages/saved.tsx) — everything a
 * member bookmarked across the site: posts, tracks, videos and
 * profiles, newest first, with the thing itself embedded so the
 * shelf shows what was saved, not just that something was.
 *
 * THE RAILS (routes/social.ts, requireAuth, FREE — no registry
 * rows exist for these paths because nothing is charged):
 *   GET    /api/saves/mine → { saves: [{ kind, target_id,
 *          saved_at, post? | profile? | track? | video? }] }
 *          (≤100, newest first; the embedded thing is null when
 *          it has gone or become invisible since the save — a
 *          close-friends post leaves the shelf the moment the
 *          saver leaves the circle, by design on the rail)
 *   POST   /api/saves { kind, target_id } — saving happens at
 *          the thing itself (its own desk / page); the shelf's
 *          job is keeping and clearing.
 *   DELETE /api/saves/:kind/:targetId → { ok: true }
 *
 * Kinds are the schema's enum: post | track | video | profile.
 *
 * DRIFT DISCIPLINE: a row with a kind outside the enum or no
 * target id is dropped; a row whose embedded thing is null is
 * NOT dropped and NOT dressed up — it renders as "gone since
 * you saved it" with its Unsave still working, so the shelf can
 * always be cleaned.
 */
export const SAVES_PATH = "/api/saves/mine";
export const SAVES_BASE_PATH = "/api/saves";

export const SAVE_KINDS = ["post", "track", "video", "profile"] as const;
export type SaveKind = (typeof SAVE_KINDS)[number];

export const SAVE_KIND_LABELS: Record<SaveKind, string> = {
  post: "Posts",
  track: "Tracks",
  video: "Videos",
  profile: "Profiles",
};

export const SAVE_KIND_SINGULAR: Record<SaveKind, string> = {
  post: "post",
  track: "track",
  video: "video",
  profile: "profile",
};

export function saveDeletePath(kind: SaveKind, targetId: string): string {
  return `${SAVES_BASE_PATH}/${encodeURIComponent(kind)}/${encodeURIComponent(targetId)}`;
}

export function buildSavePayload(kind: SaveKind, targetId: string) {
  return { kind, target_id: targetId };
}

export interface SavedItem {
  kind: SaveKind;
  targetId: string;
  savedAt: string;
  /** The thing's own name/title — null when it has gone. */
  label: string | null;
  /** A supporting line (author, handle) — null when unknown. */
  sublabel: string | null;
  /** True when the rail says the thing itself is gone/invisible. */
  gone: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function itemOf(raw: unknown): SavedItem | null {
  if (!isRecord(raw)) return null;
  const kind = str(raw["kind"]);
  const targetId = str(raw["target_id"]);
  if (!(SAVE_KINDS as readonly string[]).includes(kind) || !targetId) return null;
  const k = kind as SaveKind;
  let label: string | null = null;
  let sublabel: string | null = null;
  if (k === "track" && isRecord(raw["track"])) {
    label = str(raw["track"]["title"]) || null;
  } else if (k === "video" && isRecord(raw["video"])) {
    label = str(raw["video"]["title"]) || null;
  } else if (k === "profile" && isRecord(raw["profile"])) {
    label = str(raw["profile"]["display_name"]) || null;
    const slug = str(raw["profile"]["slug"]);
    sublabel = slug ? `@${slug}` : null;
  } else if (k === "post" && isRecord(raw["post"])) {
    const body = str(raw["post"]["body"]);
    label = body ? (body.length > 140 ? `${body.slice(0, 140)}…` : body) : null;
    if (isRecord(raw["post"]["author"])) {
      sublabel = str(raw["post"]["author"]["display_name"]) || null;
    }
  }
  return {
    kind: k,
    targetId,
    savedAt: str(raw["saved_at"]),
    label,
    sublabel,
    gone: label === null,
  };
}

export function savesOfResponse(data: unknown): SavedItem[] | null {
  if (!isRecord(data) || !Array.isArray(data["saves"])) return null;
  const out: SavedItem[] = [];
  for (const row of data["saves"]) {
    const item = itemOf(row);
    if (item) out.push(item);
  }
  return out;
}

export type SavedTab = "all" | SaveKind;

export function savesForTab(items: readonly SavedItem[], tab: SavedTab): SavedItem[] {
  return tab === "all" ? [...items] : items.filter((i) => i.kind === tab);
}

export function saveCounts(items: readonly SavedItem[]): Record<SaveKind, number> {
  const counts: Record<SaveKind, number> = { post: 0, track: 0, video: 0, profile: 0 };
  for (const item of items) counts[item.kind] += 1;
  return counts;
}

export function withoutSave(items: readonly SavedItem[], kind: SaveKind, targetId: string): SavedItem[] {
  return items.filter((i) => !(i.kind === kind && i.targetId === targetId));
}
