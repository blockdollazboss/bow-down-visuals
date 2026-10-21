/**
 * catalog-import.ts — the Back-Catalog Migration Assistant (0200).
 *
 * A creator arriving from the socials has a body of work stranded there.
 * This assistant brings the WORK home — never the audience, because no
 * platform on earth lets anyone take followers with them, and this code
 * never claims otherwise. Two honest doors in:
 *
 *   1. CONNECTED accounts (the creator's own social_accounts rows only):
 *      Instagram and Facebook Pages granted scopes that can read the
 *      account's own catalog, so we list it and the creator picks what
 *      to fetch. TikTok's granted scopes (user.info.basic, video.upload)
 *      cannot read a catalog — TikTok parks with the reason stated, and
 *      NO TikTok rows are ever created. YouTube/X/Twitch are hand-typed
 *      display links with no OAuth at all — link-only, stated as such.
 *      When a platform lists an item but won't hand over the file, the
 *      item parks 'blocked' with the reason in plain words. Nothing is
 *      ever scraped around a platform's answer.
 *   2. BULK UPLOAD of the creator's own files (browser → R2 under their
 *      own key prefix, then registered here) — the door that always
 *      works, for every platform including TikTok and YouTube.
 *
 * Once a file is here, the AI REBUILD proposes what re-uploading used
 * to lose — title, description, tags, captions (Scribe rail), chapters,
 * a thumbnail note, and a series-grouping suggestion — as a DRAFT.
 * Nothing is live until the creator approves; approve is the only door
 * that creates the library row (profile video, published / song in the
 * library). Every skipped part of a rebuild says why, in the draft.
 *
 * The flow is FREE — no credits code is imported here, and a source
 * test pins that. All heavy rails (Graph, download, R2, Scribe, AI)
 * sit behind the deps seam so tests drive fakes.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  catalogImportItemsTable,
  socialAccountsTable,
  creatorProfilesTable,
  profileVideosTable,
  playlistsTable,
  songsTable,
  type CatalogImportDraft,
  type CatalogImportDraftNote,
  type CatalogImportItem,
} from "@workspace/db";
import { decryptToken } from "./social-crypto";
import {
  listInstagramMedia,
  listFacebookPageVideos,
  CatalogProviderError,
  type FetchImpl,
} from "./social-catalog";
import { r2Upload, r2PublicUrl } from "./r2-client";
import { transcribeAudioTimed, type TimedTranscription } from "./transcription";
import { getOpenAI, getTextModel } from "./ai-clients";
import { logger } from "./logger";
import type { ServerLocale } from "./server-i18n";
import { catalogImportCopyFor } from "./catalog-import-i18n";

/* ── Errors ──────────────────────────────────────────────────────────── */

export class CatalogImportError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CatalogImportError";
    this.status = status;
    this.code = code;
  }
}

const notFound = () => new CatalogImportError(404, "NOT_FOUND", "That item isn't on your import list.");

/* ── Honest capability copy (the UI renders these verbatim) ───────────
   The English block, derived from the en entry of the server catalog
   (lib/catalog-import-i18n) — the single source for this copy in all
   ten locales. Reads in another locale render from the same catalog
   (getCatalogState); notes stored on items keep the language of the
   call that composed them. */

export const CATALOG_HONESTY = catalogImportCopyFor("en").honesty;

export type CatalogAccountState = "ready" | "blocked" | "link-only";

export interface CatalogAccountView {
  /** social_accounts row id, or null for link-only display entries. */
  accountId: string | null;
  platform: string;
  username: string | null;
  state: CatalogAccountState;
  /** Plain-language reason when state isn't 'ready'. */
  note: string | null;
  itemCount: number;
}

export interface CatalogState {
  accounts: CatalogAccountView[];
  items: CatalogImportItem[];
  honesty: typeof CATALOG_HONESTY;
}

/* ── Deps seam (tests patch these) ───────────────────────────────────── */

const MAX_FETCH_BYTES = 800 * 1024 * 1024; // server-side copy limit
const MAX_TRANSCRIBE_BYTES = 200 * 1024 * 1024; // one-pass Scribe limit

async function defaultDownloadBuffer(fetchImpl: FetchImpl, url: string): Promise<Buffer> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_FETCH_BYTES) {
    throw new CatalogImportError(413, "FILE_TOO_LARGE", catalogImportCopyFor("en").fileTooLarge);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FETCH_BYTES) {
    throw new CatalogImportError(413, "FILE_TOO_LARGE", catalogImportCopyFor("en").fileTooLarge);
  }
  return buf;
}

interface AiDraftWords {
  title: string;
  description: string;
  tags: string[];
}

async function defaultAiText(input: {
  originalTitle: string;
  caption: string;
  transcriptExcerpt: string;
  kind: "video" | "audio";
}): Promise<AiDraftWords | null> {
  try {
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: getTextModel(),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are Thy Cheat Code, the host of Bow Down Visuals, rebuilding the catalog entry for a creator's OWN existing work that they are moving to their Bow Down home. STRICT RULES: use only facts in the input; never invent awards, sales, followers, dates, or collaborators; never claim an audience moved — only the work did. Return JSON: {title: string (<= 120 chars, the creator's real title tightened, not clickbait), description: string (<= 1200 chars, built from their caption and transcript), tags: string[] (<= 8 short tags from the content itself)}.",
        },
        {
          role: "user",
          content: JSON.stringify(input),
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as Partial<AiDraftWords>;
    if (typeof parsed.title !== "string" || typeof parsed.description !== "string") return null;
    return {
      title: parsed.title.slice(0, 200),
      description: parsed.description.slice(0, 2000),
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === "string").slice(0, 8) : [],
    };
  } catch {
    return null; // AI rail off/unavailable — the assembled draft stands.
  }
}

export interface CatalogImportDeps {
  fetchImpl: FetchImpl;
  downloadBuffer: (url: string) => Promise<Buffer>;
  uploadObject: (key: string, body: Buffer, contentType: string) => Promise<string>;
  publicUrl: (key: string) => string;
  transcribe: typeof transcribeAudioTimed;
  aiText: typeof defaultAiText;
}

export const catalogImportDeps: CatalogImportDeps = {
  fetchImpl: (url, init) => fetch(url, init),
  downloadBuffer: (url) => defaultDownloadBuffer(catalogImportDeps.fetchImpl, url),
  uploadObject: (key, body, contentType) => r2Upload(key, body, contentType),
  publicUrl: (key) => r2PublicUrl(key),
  transcribe: transcribeAudioTimed,
  aiText: defaultAiText,
};

export function setCatalogImportDeps(patch: Partial<CatalogImportDeps>): void {
  Object.assign(catalogImportDeps, patch);
}

/* ── Small pure helpers (exported for tests) ─────────────────────────── */

const SERIES_PATTERNS: Array<{ re: RegExp; season: (m: RegExpMatchArray) => number; episode: (m: RegExpMatchArray) => number }> = [
  // "Show Name S2E3" / "Show Name s02e03"
  { re: /^(.+?)[\s\-–—]*[Ss](\d{1,2})[Ee](\d{1,3})\b/, season: (m) => Number(m[2]), episode: (m) => Number(m[3]) },
  // "Show Name — Ep. 4" / "Episode 4" / "#4" / "Part 4"
  { re: /^(.+?)[\s\-–—]*(?:ep\.?|episode|part|#)\s*(\d{1,3})\b/i, season: () => 1, episode: (m) => Number(m[2]) },
];

/** Deterministic series suggestion from a title — a suggestion only;
    the creator sees it in the draft and approve applies it. */
export function parseSeriesSuggestion(title: string): { name: string; season: number; episode: number } | null {
  for (const p of SERIES_PATTERNS) {
    const m = title.match(p.re);
    if (m && m[1]!.trim().length >= 2) {
      return { name: m[1]!.trim(), season: p.season(m), episode: p.episode(m) };
    }
  }
  return null;
}

export function hashtagsOf(text: string): string[] {
  const found = (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(1));
  return [...new Set(found)].slice(0, 8);
}

function cleanTitle(raw: string, locale: ServerLocale = "en"): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 200) || catalogImportCopyFor(locale).untitledFallback;
}

/** The draft when the AI rail is off: the creator's own words, cleaned —
    labeled 'assembled', never dressed up as AI work. Note reasons are
    catalog template text, composed in the locale of the call that
    built the draft and then stored with it. */
export function assembleDraft(
  input: {
    title: string;
    caption: string;
    transcript: TimedTranscription | null;
    transcriptSkipReason?: string;
    hasThumbnail: boolean;
    ai: AiDraftWords | null;
  },
  locale: ServerLocale = "en",
): CatalogImportDraft {
  const copy = catalogImportCopyFor(locale);
  const notes: CatalogImportDraftNote[] = [];
  const title = cleanTitle(input.ai?.title ?? input.title, locale);
  notes.push({ part: "title", state: "done" });
  const description = (input.ai?.description ?? input.caption ?? "").slice(0, 2000);
  notes.push({ part: "description", state: "done" });
  const tags = input.ai?.tags?.length ? input.ai.tags : hashtagsOf(input.caption ?? "");

  let captions: string | null = null;
  let chapters: CatalogImportDraft["chapters"] = [];
  if (input.transcript) {
    captions = input.transcript.text.slice(0, 20000);
    notes.push({ part: "captions", state: "done" });
    const segs = input.transcript.segments ?? [];
    chapters = segs.slice(0, 12).map((s) => ({
      atSec: Math.max(0, Math.floor(s.start)),
      label: s.text.trim().split(/\s+/).slice(0, 6).join(" ") || copy.chapterFallback,
    }));
    notes.push(
      chapters.length > 0
        ? { part: "chapters", state: "done" }
        : { part: "chapters", state: "skipped", reason: copy.draftNotes.chaptersNoTimedSections },
    );
  } else {
    notes.push({
      part: "captions",
      state: "skipped",
      reason: input.transcriptSkipReason || copy.draftNotes.captionsUnavailable,
    });
    notes.push({
      part: "chapters",
      state: "skipped",
      reason: copy.draftNotes.chaptersNeedTranscript,
    });
  }

  notes.push(
    input.hasThumbnail
      ? { part: "thumbnail", state: "done" }
      : { part: "thumbnail", state: "skipped", reason: copy.draftNotes.thumbnailMissing },
  );

  const series = parseSeriesSuggestion(input.title);
  notes.push(
    series
      ? { part: "series", state: "done" }
      : { part: "series", state: "skipped", reason: copy.draftNotes.seriesNoMarker },
  );

  return {
    title,
    description,
    tags,
    captions,
    chapters,
    series,
    notes,
    source: input.ai ? "ai" : "assembled",
  };
}

function extFor(kind: "video" | "audio", contentType: string | null, url: string): string {
  const fromUrl = url.split("?")[0]!.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (fromUrl) return `.${fromUrl.toLowerCase()}`;
  if (contentType?.includes("mp4")) return ".mp4";
  if (contentType?.includes("quicktime")) return ".mov";
  if (contentType?.includes("mpeg")) return ".mp3";
  if (contentType?.includes("wav")) return ".wav";
  return kind === "audio" ? ".mp3" : ".mp4";
}

function contentTypeFor(kind: "video" | "audio", ext: string): string {
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  return kind === "audio" ? "audio/mpeg" : "video/mp4";
}

/* ── State ───────────────────────────────────────────────────────────── */

async function ownAccount(userId: string, accountId: string) {
  const [account] = await db
    .select()
    .from(socialAccountsTable)
    .where(and(eq(socialAccountsTable.id, accountId), eq(socialAccountsTable.user_id, userId)))
    .limit(1);
  return account ?? null;
}

export async function getCatalogState(
  userId: string,
  locale: ServerLocale = "en",
): Promise<CatalogState> {
  const copy = catalogImportCopyFor(locale);
  const [accounts, items, profiles] = await Promise.all([
    db.select().from(socialAccountsTable).where(eq(socialAccountsTable.user_id, userId)).orderBy(asc(socialAccountsTable.created_at)),
    db.select().from(catalogImportItemsTable).where(eq(catalogImportItemsTable.userId, userId)).orderBy(asc(catalogImportItemsTable.createdAt)),
    db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.userId, userId)).limit(1),
  ]);
  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.socialAccountId) counts.set(it.socialAccountId, (counts.get(it.socialAccountId) ?? 0) + 1);
  }
  const views: CatalogAccountView[] = accounts.map((a) => {
    const base = {
      accountId: a.id,
      platform: a.platform,
      username: a.username ?? a.page_name ?? null,
      itemCount: counts.get(a.id) ?? 0,
    };
    if (a.platform === "instagram") {
      return { ...base, state: "ready" as const, note: null };
    }
    if (a.platform === "facebook") {
      return a.page_id
        ? { ...base, state: "ready" as const, note: null }
        : { ...base, state: "blocked" as const, note: copy.facebookNoPage };
    }
    if (a.platform === "tiktok") {
      return { ...base, state: "blocked" as const, note: copy.honesty.tiktokBlocked };
    }
    return { ...base, state: "blocked" as const, note: copy.honesty.linkOnly };
  });
  /* Display-only links typed onto the profile (YouTube/X/Twitch and any
     other social_links keys) are stated as link-only — they are not
     connections and no catalog can be read from them. */
  const linkedPlatforms = new Set(accounts.map((a) => a.platform));
  const links = (profiles[0]?.socialLinks ?? {}) as Record<string, string>;
  for (const key of Object.keys(links)) {
    if (!links[key] || linkedPlatforms.has(key.toLowerCase())) continue;
    views.push({
      accountId: null,
      platform: key,
      username: null,
      state: "link-only",
      note: copy.honesty.linkOnly,
      itemCount: 0,
    });
  }
  return { accounts: views, items, honesty: copy.honesty };
}

/* ── Scan: list what isn't home yet ──────────────────────────────────── */

export interface ScanResult {
  accountId: string;
  platform: string;
  listed: number;
  alreadyKnown: number;
  skippedNonVideo: number;
  items: CatalogImportItem[];
}

export async function scanAccount(
  userId: string,
  accountId: string,
  locale: ServerLocale = "en",
): Promise<ScanResult> {
  const copy = catalogImportCopyFor(locale);
  const account = await ownAccount(userId, accountId);
  if (!account) throw new CatalogImportError(404, "ACCOUNT_NOT_FOUND", "That account isn't connected to you.");
  if (account.platform === "tiktok") {
    throw new CatalogImportError(422, "PROVIDER_BLOCKED", copy.honesty.tiktokBlocked);
  }
  if (account.platform !== "instagram" && account.platform !== "facebook") {
    throw new CatalogImportError(422, "PROVIDER_BLOCKED", copy.honesty.linkOnly);
  }
  if (account.platform === "facebook" && !account.page_id) {
    throw new CatalogImportError(422, "NO_PAGE", copy.facebookNoPage);
  }
  if (!account.access_token_encrypted) {
    throw new CatalogImportError(422, "RECONNECT", "This connection has no usable token. Reconnect it in Settings, then scan again.");
  }
  let accessToken: string;
  try {
    accessToken = decryptToken(account.access_token_encrypted);
  } catch {
    throw new CatalogImportError(422, "RECONNECT", "This connection's token couldn't be read. Reconnect it in Settings, then scan again.");
  }

  let remote: Awaited<ReturnType<typeof listInstagramMedia>>;
  try {
    remote =
      account.platform === "instagram"
        ? await listInstagramMedia(
            { igUserId: account.ig_user_id ?? account.provider_user_id ?? "", accessToken },
            catalogImportDeps.fetchImpl,
          )
        : await listFacebookPageVideos({ pageId: account.page_id!, accessToken }, catalogImportDeps.fetchImpl);
  } catch (err) {
    if (err instanceof CatalogProviderError) {
      throw new CatalogImportError(err.tokenExpired ? 422 : 502, err.tokenExpired ? "RECONNECT" : "PROVIDER_ERROR", err.message);
    }
    throw err;
  }

  let listed = 0;
  let alreadyKnown = 0;
  for (const r of remote.items) {
    const [existing] = await db
      .select()
      .from(catalogImportItemsTable)
      .where(
        and(
          eq(catalogImportItemsTable.userId, userId),
          eq(catalogImportItemsTable.platform, account.platform as "instagram" | "facebook"),
          eq(catalogImportItemsTable.externalId, r.externalId),
        ),
      )
      .limit(1);
    if (existing) {
      alreadyKnown++;
      /* Refresh the (expiring) file URL on items that haven't come home
         yet — including ones parked blocked for want of a file URL. */
      if (existing.status === "listed" || existing.status === "failed" || (existing.status === "blocked" && !existing.mediaUrl)) {
        await db
          .update(catalogImportItemsTable)
          .set({
            remoteFileUrl: r.fileUrl,
            remoteThumbnailUrl: r.thumbnailUrl,
            ...(existing.status === "blocked" && r.fileUrl
              ? { status: "listed" as const, statusNote: null }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(catalogImportItemsTable.id, existing.id));
      }
      continue;
    }
    await db.insert(catalogImportItemsTable).values({
      userId,
      sourceKind: "connected",
      platform: account.platform as "instagram" | "facebook",
      socialAccountId: account.id,
      externalId: r.externalId,
      kind: r.kind,
      title: r.title,
      originalCaption: r.caption || null,
      originalUrl: r.permalink,
      remoteFileUrl: r.fileUrl,
      remoteThumbnailUrl: r.thumbnailUrl,
      durationSec: r.durationSec,
      status: "listed",
    });
    listed++;
  }
  const items = await db
    .select()
    .from(catalogImportItemsTable)
    .where(and(eq(catalogImportItemsTable.userId, userId), eq(catalogImportItemsTable.socialAccountId, account.id)))
    .orderBy(asc(catalogImportItemsTable.createdAt));
  return { accountId: account.id, platform: account.platform, listed, alreadyKnown, skippedNonVideo: remote.skippedNonVideo, items };
}

/* ── Fetch: bring one listed file home ───────────────────────────────── */

async function ownItem(userId: string, itemId: string): Promise<CatalogImportItem> {
  const [item] = await db
    .select()
    .from(catalogImportItemsTable)
    .where(and(eq(catalogImportItemsTable.id, itemId), eq(catalogImportItemsTable.userId, userId)))
    .limit(1);
  if (!item) throw notFound();
  return item;
}

export async function fetchItem(
  userId: string,
  itemId: string,
  locale: ServerLocale = "en",
): Promise<CatalogImportItem> {
  const copy = catalogImportCopyFor(locale);
  const item = await ownItem(userId, itemId);
  if (item.status === "approved" || item.status === "here" || item.status === "ready") return item;
  if (item.status === "dismissed") throw new CatalogImportError(409, "DISMISSED", "That item was dismissed. Scan again to bring it back.");
  if (!item.remoteFileUrl) {
    const [updated] = await db
      .update(catalogImportItemsTable)
      .set({ status: "blocked", statusNote: copy.honesty.noFileUrl, updatedAt: new Date() })
      .where(eq(catalogImportItemsTable.id, item.id))
      .returning();
    return updated!;
  }
  await db
    .update(catalogImportItemsTable)
    .set({ status: "fetching", statusNote: null, updatedAt: new Date() })
    .where(eq(catalogImportItemsTable.id, item.id));
  try {
    const bytes = await catalogImportDeps.downloadBuffer(item.remoteFileUrl);
    const ext = extFor(item.kind, null, item.remoteFileUrl);
    const key = `${userId}/catalog-import/${item.id}${ext}`;
    const mediaUrl = await catalogImportDeps.uploadObject(key, bytes, contentTypeFor(item.kind, ext));
    let thumbnailUrl: string | null = null;
    if (item.remoteThumbnailUrl) {
      try {
        const thumbBytes = await catalogImportDeps.downloadBuffer(item.remoteThumbnailUrl);
        const thumbKey = `${userId}/catalog-import/${item.id}-thumb.jpg`;
        thumbnailUrl = await catalogImportDeps.uploadObject(thumbKey, thumbBytes, "image/jpeg");
      } catch {
        thumbnailUrl = null; // a missing poster never blocks the work itself
      }
    }
    const [updated] = await db
      .update(catalogImportItemsTable)
      .set({ status: "here", mediaUrl, storageKey: key, thumbnailUrl, statusNote: null, updatedAt: new Date() })
      .where(eq(catalogImportItemsTable.id, item.id))
      .returning();
    return updated!;
  } catch (err) {
    /* The stored note is catalog text in the caller's locale. A
       CatalogImportError's message passes through as-is (provider
       text and the deps-seam errors are the error's own words) —
       except FILE_TOO_LARGE, whose text IS the catalog string. */
    const note =
      err instanceof CatalogImportError
        ? err.code === "FILE_TOO_LARGE"
          ? copy.fileTooLarge
          : err.message
        : copy.fetchFailedNote;
    const [updated] = await db
      .update(catalogImportItemsTable)
      .set({ status: "failed", statusNote: note, updatedAt: new Date() })
      .where(eq(catalogImportItemsTable.id, item.id))
      .returning();
    return updated!;
  }
}

export interface BatchResult {
  results: Array<{ itemId: string; ok: boolean; status: string; note?: string }>;
}

export async function fetchSelected(
  userId: string,
  itemIds: string[],
  locale: ServerLocale = "en",
): Promise<BatchResult> {
  const results: BatchResult["results"] = [];
  for (const id of itemIds.slice(0, 100)) {
    try {
      const item = await fetchItem(userId, id, locale);
      results.push({ itemId: id, ok: item.status === "here" || item.status === "ready" || item.status === "approved", status: item.status, note: item.statusNote ?? undefined });
    } catch (err) {
      results.push({ itemId: id, ok: false, status: "error", note: err instanceof Error ? err.message : "Failed." });
    }
  }
  return { results };
}

/* ── Bulk upload registration ────────────────────────────────────────── */

export interface UploadRegistration {
  key: string;
  filename: string;
  kind: "video" | "audio";
  contentType?: string;
}

export async function registerUploads(
  userId: string,
  files: UploadRegistration[],
  locale: ServerLocale = "en",
): Promise<CatalogImportItem[]> {
  const created: CatalogImportItem[] = [];
  for (const f of files.slice(0, 200)) {
    if (!f.key.startsWith(`${userId}/catalog-import/`) || f.key.includes("..")) {
      throw new CatalogImportError(403, "BAD_KEY", "That upload doesn't sit under your own catalog-import folder.");
    }
    const [row] = await db
      .insert(catalogImportItemsTable)
      .values({
        userId,
        sourceKind: "upload",
        platform: null,
        socialAccountId: null,
        externalId: null,
        kind: f.kind,
        title: cleanTitle(f.filename.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " "), locale),
        mediaUrl: catalogImportDeps.publicUrl(f.key),
        storageKey: f.key,
        status: "here",
      })
      .returning();
    created.push(row!);
  }
  return created;
}

/* ── Rebuild: the AI relocation draft ────────────────────────────────── */

export async function rebuildItem(
  userId: string,
  itemId: string,
  locale: ServerLocale = "en",
): Promise<CatalogImportItem> {
  const copy = catalogImportCopyFor(locale);
  const item = await ownItem(userId, itemId);
  if (item.status !== "here" && item.status !== "ready") {
    throw new CatalogImportError(409, "NOT_HERE", "That work isn't home yet — bring it in first, then rebuild its details.");
  }
  if (!item.mediaUrl || !item.storageKey) {
    throw new CatalogImportError(409, "NOT_HERE", "That work isn't home yet — bring it in first, then rebuild its details.");
  }

  let transcript: TimedTranscription | null = null;
  let transcriptSkipReason: string | undefined;
  try {
    const bytes = await catalogImportDeps.downloadBuffer(item.mediaUrl);
    if (bytes.length > MAX_TRANSCRIBE_BYTES) {
      transcriptSkipReason = copy.transcriptTooLarge;
    } else {
      const ext = extFor(item.kind, null, item.storageKey);
      transcript = await catalogImportDeps.transcribe({
        buffer: bytes,
        filename: `catalog-import${ext}`,
        mimeType: contentTypeFor(item.kind, ext),
      });
      if (typeof transcript.duration === "number" && transcript.duration > 0 && !item.durationSec) {
        await db
          .update(catalogImportItemsTable)
          .set({ durationSec: Math.round(transcript.duration), updatedAt: new Date() })
          .where(eq(catalogImportItemsTable.id, item.id));
      }
    }
  } catch {
    transcriptSkipReason = copy.transcriptUnavailable;
  }

  const caption = item.originalCaption ?? "";
  const ai = await catalogImportDeps.aiText({
    originalTitle: item.title,
    caption,
    transcriptExcerpt: (transcript?.text ?? "").slice(0, 3000),
    kind: item.kind,
  });
  const draft = assembleDraft(
    {
      title: item.title,
      caption,
      transcript,
      transcriptSkipReason,
      hasThumbnail: Boolean(item.thumbnailUrl),
      ai,
    },
    locale,
  );
  const [updated] = await db
    .update(catalogImportItemsTable)
    .set({ status: "ready", draft, statusNote: null, updatedAt: new Date() })
    .where(eq(catalogImportItemsTable.id, item.id))
    .returning();
  return updated!;
}

/* ── Approve: the only door onto the real rails ──────────────────────── */

export interface ApproveOverrides {
  title?: string;
  description?: string;
  tags?: string[];
  series?: { name: string; season: number; episode: number } | null;
}

export async function approveItem(
  userId: string,
  itemId: string,
  overrides?: ApproveOverrides,
  locale: ServerLocale = "en",
): Promise<CatalogImportItem> {
  const item = await ownItem(userId, itemId);
  if (item.status === "approved") return item;
  if (item.status !== "here" && item.status !== "ready") {
    throw new CatalogImportError(409, "NOT_HERE", "That work isn't home yet — bring it in before approving it.");
  }
  if (!item.mediaUrl) throw new CatalogImportError(409, "NOT_HERE", "That work has no file home yet.");
  const draft: CatalogImportDraft =
    item.draft ??
    assembleDraft(
      { title: item.title, caption: item.originalCaption ?? "", transcript: null, transcriptSkipReason: "", hasThumbnail: Boolean(item.thumbnailUrl), ai: null },
      locale,
    );
  const title = cleanTitle(overrides?.title ?? draft.title, locale);
  const description = (overrides?.description ?? draft.description).slice(0, 2000);
  const tags = (overrides?.tags ?? draft.tags).slice(0, 8);
  const series = overrides?.series !== undefined ? overrides.series : draft.series;

  let targetKind: "profile_video" | "song";
  let targetId: string;
  if (item.kind === "audio") {
    const [song] = await db
      .insert(songsTable)
      .values({
        user_id: userId,
        title,
        audio_url: item.mediaUrl,
        audio_path: item.storageKey,
        source: "catalog-import",
        duration_sec: item.durationSec ? String(item.durationSec) : null,
        cover_art_url: item.thumbnailUrl,
      })
      .returning();
    targetKind = "song";
    targetId = song!.id;
  } else {
    const [profile] = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    if (!profile) {
      throw new CatalogImportError(
        409,
        "PROFILE_REQUIRED",
        "Your videos land on your creator profile — and you don't have one yet. Move Home step 1 builds it in a minute; your files stay right here, ready.",
      );
    }
    const [video] = await db
      .insert(profileVideosTable)
      .values({
        profileId: profile.id,
        title,
        videoUrl: item.mediaUrl,
        thumbnailUrl: item.thumbnailUrl,
        description,
        tags,
        durationSec: item.durationSec ?? 0,
        isPublished: true,
        season: series?.season ?? null,
        episode: series?.episode ?? null,
      })
      .returning();
    targetKind = "profile_video";
    targetId = video!.id;

    if (series) {
      /* Series grouping: a kind='series' playlist on the same profile,
         episodes ordered by their numbers. Find-or-create by title. */
      const existing = await db
        .select()
        .from(playlistsTable)
        .where(
          and(
            eq(playlistsTable.ownerProfileId, profile.id),
            eq(playlistsTable.kind, "series"),
            eq(playlistsTable.title, series.name),
          ),
        )
        .limit(1);
      let playlist = existing[0];
      if (!playlist) {
        const [created] = await db
          .insert(playlistsTable)
          .values({ ownerProfileId: profile.id, title: series.name, kind: "series", isPublic: true, items: [] })
          .returning();
        playlist = created!;
      }
      const items = [...(playlist.items ?? [])];
      if (!items.some((e) => e.kind === "video" && e.id === targetId)) {
        items.push({ kind: "video" as const, id: targetId });
        /* Keep episodes in numeric order where numbers are known. */
        const episodeOf = new Map<string, number>();
        const memberVideos = await db
          .select({ id: profileVideosTable.id, episode: profileVideosTable.episode })
          .from(profileVideosTable)
          .where(inArray(profileVideosTable.id, items.filter((e) => e.kind === "video").map((e) => e.id)));
        for (const v of memberVideos) if (v.episode != null) episodeOf.set(v.id, v.episode);
        items.sort((a, b) => (episodeOf.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (episodeOf.get(b.id) ?? Number.MAX_SAFE_INTEGER));
        await db.update(playlistsTable).set({ items }).where(eq(playlistsTable.id, playlist.id));
      }
    }
  }

  const [updated] = await db
    .update(catalogImportItemsTable)
    .set({ status: "approved", targetKind, targetId, statusNote: null, updatedAt: new Date() })
    .where(eq(catalogImportItemsTable.id, item.id))
    .returning();
  logger.info({ itemId: item.id, targetKind, targetId }, "[catalog-import] item approved home");
  return updated!;
}

export async function approveBatch(
  userId: string,
  itemIds: string[],
  locale: ServerLocale = "en",
): Promise<BatchResult> {
  const results: BatchResult["results"] = [];
  for (const id of itemIds.slice(0, 100)) {
    try {
      const item = await approveItem(userId, id, undefined, locale);
      results.push({ itemId: id, ok: item.status === "approved", status: item.status });
    } catch (err) {
      results.push({ itemId: id, ok: false, status: "error", note: err instanceof Error ? err.message : "Failed." });
    }
  }
  return { results };
}

export async function dismissItem(userId: string, itemId: string): Promise<CatalogImportItem> {
  const item = await ownItem(userId, itemId);
  if (item.status !== "listed" && item.status !== "blocked" && item.status !== "failed") {
    throw new CatalogImportError(409, "CANT_DISMISS", "Only items still on the platform list can be dismissed.");
  }
  const [updated] = await db
    .update(catalogImportItemsTable)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(eq(catalogImportItemsTable.id, item.id))
    .returning();
  return updated!;
}
