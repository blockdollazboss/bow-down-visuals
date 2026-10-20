import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, or, desc, asc, sql } from "drizzle-orm";
import {
  db, contentIdOptinsTable, contentIdFingerprintsTable, contentIdMatchesTable,
  legacyDesignationsTable, legacyContactsTable, catalogExportJobsTable, chatAutomodRulesTable,
  chatModActionsTable, stageRoomsTable, groupJoinQuestionsTable,
  groupJoinRequestsTable, videoRetentionEventsTable, groupsTable,
  groupMembersTable, groupPostsTable, creatorProfilesTable, followsTable,
  liveChannelModeratorsTable, type ContentIdMatch,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { computeFingerprint, decodePcm16Base64, matchFingerprints } from "../lib/fingerprint";
import { evaluateAutomod } from "../lib/automod";
import { canGroupAction, canAssignRole, normalizeGroupRole } from "../lib/group-roles";
import { evictStageRoom, getOrCreateStageRoom, stageRooms, STAGE_PRESENCE_CAP, STAGE_SPEAKER_CAP } from "../lib/stage-room";
import { liveChatHub } from "./live-chat";
import { RoomHub, verifyAccessToken, type LiveWsGateway, type WsClientSocket } from "../lib/live-ws";
import { PdfBuilder, GOLD, GREY, BLACK, WHITE } from "../lib/pdf";

/* ─── Stack 10 "Trust, safety & the literal end" ─────────────────────────
   #1 Content ID depth: house-computed spectral-peak fingerprints,
      match-on-upload scan, symmetric claims (pending/accepted/
      disputed/resolved). REMAINDER (named, not shipped): continuous
      background scanning of the stored catalog — nothing walks stored
      media; scans happen when audio is submitted to /content-id/scan.
   #2 Succession designations (record + heir accept/decline; activation
      is manual/human-reviewed — no automatic transfer exists here).
      #2b (Stack 3) Legacy contact: name + email of the person to
      contact about the account — record only, owner-only, no transfer,
      payout, or legal effect promised or implied.
   #3 Full-catalog portability export (manifest + per-file links —
      chosen over one giant zip honestly: catalogs hold large video
      originals, so the package is a manifest JSON whose entries carry
      the file URLs plus CSV/JSON metadata; see format field).
   #4 Unified mod console + chat automod (fixed rule menu, every
      action logged with its reason; flagged chatters see the reason).
   #5 Earnings documents (annual statement PDF from recorded data).
   #6 Stage audio rooms (WS presence + voice mesh, REST below + WS
      registration at the bottom of this file).
   #7 Group roles (owner>admin>moderator>member) + join questions /
      requests with answers visible at approval time.
   #8 Retention curves + audience breakdown from recorded events.
   All DTOs camelCase. No money moves anywhere in this router. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
function param(req: Request, name: string): string { const v = req.params[name]; return Array.isArray(v) ? (v[0] ?? "") : (v ?? ""); }
const MAX_AUDIO_B64 = 14_000_000;
/** ISO string for a stored timestamp, or null when the row carries
 *  none — a DTO must never crash (or invent a date) over a missing one. */
const iso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}; // ~10MB of PCM — a reference/scan clip, not a catalog walk

/* ═══ #1 Content ID fingerprints + symmetric claims ═══════════════════ */

const fingerprintBody = z.object({
  optinId: z.string().uuid().optional().nullable(),
  trackTitle: z.string().trim().min(1).max(200),
  audioBase64: z.string().min(100).max(MAX_AUDIO_B64),
  sampleRate: z.number().int().min(4000).max(48000).optional(),
});

router.post("/content-id/fingerprints", requireAuth, async (req, res) => {
  const parsed = fingerprintBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid fingerprint request", details: parsed.error.issues }); return; }
  try {
    if (parsed.data.optinId) {
      const own = await db.select().from(contentIdOptinsTable)
        .where(and(eq(contentIdOptinsTable.id, parsed.data.optinId), eq(contentIdOptinsTable.user_id, req.userId!))).limit(1);
      if (!own[0]) { res.status(400).json({ error: "That opt-in does not belong to you." }); return; }
    }
    const samples = decodePcm16Base64(parsed.data.audioBase64);
    if (samples.length < 4096) { res.status(400).json({ error: "That audio is too short to fingerprint — a few seconds at least." }); return; }
    const fp = computeFingerprint(samples, parsed.data.sampleRate ?? 8000);
    const [row] = await db.insert(contentIdFingerprintsTable).values({
      optin_id: parsed.data.optinId ?? null, user_id: req.userId!, track_title: parsed.data.trackTitle,
      landmarks: fp.landmarks, duration_seconds: fp.durationSeconds, sample_rate: fp.sampleRate,
    }).returning();
    res.status(201).json({ fingerprint: { id: row!.id, trackTitle: row!.track_title, landmarkCount: fp.landmarks.length, durationSeconds: fp.durationSeconds, sampleRate: fp.sampleRate } });
  } catch (err) { logger.error({ err }, "[trust] fingerprint failed"); res.status(500).json({ error: "Could not fingerprint that audio." }); }
});

router.get("/content-id/fingerprints", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(contentIdFingerprintsTable).where(eq(contentIdFingerprintsTable.user_id, req.userId!)).orderBy(desc(contentIdFingerprintsTable.created_at)).limit(500);
    res.json({ fingerprints: rows.map((r) => ({ id: r.id, optinId: r.optin_id, trackTitle: r.track_title, landmarkCount: (r.landmarks ?? []).length, durationSeconds: r.duration_seconds, sampleRate: r.sample_rate, createdAt: iso(r.created_at) })) });
  } catch (err) { logger.error({ err }, "[trust] list fingerprints failed"); res.status(500).json({ error: "Could not load your fingerprints." }); }
});

const scanBody = z.object({
  audioBase64: z.string().min(100).max(MAX_AUDIO_B64),
  sampleRate: z.number().int().min(4000).max(48000).optional(),
  sourceLabel: z.string().trim().max(200).optional(),
});

function claimDto(m: ContentIdMatch, viewerId: string) {
  return {
    id: m.id, fingerprintId: m.fingerprint_id, ownerUserId: m.owner_user_id, uploaderUserId: m.uploader_user_id,
    sourceLabel: m.source_label, offsetSeconds: m.offset_seconds, confidence: m.confidence,
    matchedLandmarks: m.matched_landmarks, totalLandmarks: m.total_landmarks, status: m.status,
    disputeNote: m.dispute_note, resolutionNote: m.resolution_note, resolvedBy: m.resolved_by,
    youAre: m.owner_user_id === viewerId ? "owner" as const : "uploader" as const,
    createdAt: iso(m.created_at), updatedAt: iso(m.updated_at),
  };
}

router.post("/content-id/scan", requireAuth, async (req, res) => {
  const parsed = scanBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid scan request", details: parsed.error.issues }); return; }
  try {
    const samples = decodePcm16Base64(parsed.data.audioBase64);
    if (samples.length < 4096) { res.status(400).json({ error: "That audio is too short to scan — a few seconds at least." }); return; }
    const query = computeFingerprint(samples, parsed.data.sampleRate ?? 8000);
    const refs = await db.select().from(contentIdFingerprintsTable).limit(1000);
    const others = refs.filter((r) => r.user_id !== req.userId);
    const matches = [];
    for (const ref of others) {
      const result = matchFingerprints(query, { landmarks: ref.landmarks ?? [], durationSeconds: ref.duration_seconds, sampleRate: ref.sample_rate });
      if (!result.matched) continue;
      const [row] = await db.insert(contentIdMatchesTable).values({
        fingerprint_id: ref.id, owner_user_id: ref.user_id, uploader_user_id: req.userId!,
        source_label: parsed.data.sourceLabel ?? "", offset_seconds: result.offsetSeconds,
        confidence: result.confidence, matched_landmarks: result.matchedLandmarks, total_landmarks: result.totalLandmarks,
        status: "pending",
      }).returning();
      matches.push({ ...claimDto(row!, req.userId!), trackTitle: ref.track_title });
    }
    res.status(201).json({
      matches, scannedReferences: others.length,
      scanScope: "match-on-upload",
      remainder: "Continuous background scanning of the stored catalog is not running — audio is scanned when it is submitted here.",
    });
  } catch (err) { logger.error({ err }, "[trust] scan failed"); res.status(500).json({ error: "Could not scan that audio." }); }
});

router.get("/content-id/claims", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(contentIdMatchesTable)
      .where(or(eq(contentIdMatchesTable.owner_user_id, req.userId!), eq(contentIdMatchesTable.uploader_user_id, req.userId!)))
      .orderBy(desc(contentIdMatchesTable.created_at)).limit(500);
    res.json({ claims: rows.map((m) => claimDto(m, req.userId!)) });
  } catch (err) { logger.error({ err }, "[trust] list claims failed"); res.status(500).json({ error: "Could not load claims." }); }
});

const claimAction = z.object({ action: z.enum(["accept", "dispute", "resolve"]), note: z.string().trim().max(1000).optional() });

router.patch("/content-id/claims/:id", requireAuth, async (req, res) => {
  const id = param(req, "id");
  if (!isUuid(id)) { res.status(400).json({ error: "Invalid claim id." }); return; }
  const parsed = claimAction.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid claim action", details: parsed.error.issues }); return; }
  try {
    const rows = await db.select().from(contentIdMatchesTable).where(eq(contentIdMatchesTable.id, id)).limit(1);
    const m = rows[0];
    if (!m || (m.owner_user_id !== req.userId && m.uploader_user_id !== req.userId)) { res.status(404).json({ error: "Claim not found." }); return; }
    const isOwner = m.owner_user_id === req.userId;
    const { action, note } = parsed.data;
    // Symmetric state machine — the same states and evidence for both
    // sides; who may move depends on the move, never on catalog size.
    let patch: Record<string, unknown> | null = null;
    if (action === "dispute" && !isOwner && m.status === "pending") patch = { status: "disputed", dispute_note: note ?? "" };
    else if (action === "accept" && isOwner && m.status === "pending") patch = { status: "accepted" };
    else if (action === "resolve" && isOwner && (m.status === "disputed" || m.status === "accepted")) {
      if (!note) { res.status(400).json({ error: "A resolution needs a note recording what was decided — it is the human-reviewable record." }); return; }
      patch = { status: "resolved", resolution_note: note, resolved_by: req.userId! };
    }
    if (!patch) { res.status(409).json({ error: `Can't ${action} a claim in state "${m.status}"${action === "dispute" ? " as the uploader" : " as the owner"} — check who you are in this claim and its current state.` }); return; }
    const [row] = await db.update(contentIdMatchesTable).set({ ...patch, updated_at: new Date() }).where(eq(contentIdMatchesTable.id, id)).returning();
    res.json({ claim: claimDto(row!, req.userId!) });
  } catch (err) { logger.error({ err }, "[trust] claim action failed"); res.status(500).json({ error: "Could not update that claim." }); }
});

/* ═══ #2 Succession / legacy designation ══════════════════════════════ */

export const LEGACY_INCLUDES = ["catalog", "page"];
export const LEGACY_EXCLUDES = ["private messages", "payment rails and payout credentials"];
const legacyDto = (r: typeof legacyDesignationsTable.$inferSelect) => ({
  id: r.id, userId: r.user_id, heirUserId: r.heir_user_id, status: r.status, instructions: r.instructions,
  includes: LEGACY_INCLUDES, excludes: LEGACY_EXCLUDES,
  activation: "manual_review" as const,
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

router.get("/legacy/designation", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(legacyDesignationsTable).where(eq(legacyDesignationsTable.user_id, req.userId!)).limit(1);
    res.json({ designation: rows[0] ? legacyDto(rows[0]) : null, includes: LEGACY_INCLUDES, excludes: LEGACY_EXCLUDES, activation: "manual_review" });
  } catch (err) { logger.error({ err }, "[trust] legacy get failed"); res.status(500).json({ error: "Could not load your designation." }); }
});

const legacyBody = z.object({ heirUserId: z.string().uuid(), instructions: z.string().trim().max(2000).optional() });

router.post("/legacy/designation", requireAuth, async (req, res) => {
  const parsed = legacyBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid designation", details: parsed.error.issues }); return; }
  if (parsed.data.heirUserId === req.userId) { res.status(400).json({ error: "You can't name yourself as your own heir." }); return; }
  try {
    const existing = await db.select().from(legacyDesignationsTable).where(eq(legacyDesignationsTable.user_id, req.userId!)).limit(1);
    if (existing[0]) {
      const [row] = await db.update(legacyDesignationsTable)
        .set({ heir_user_id: parsed.data.heirUserId, instructions: parsed.data.instructions ?? existing[0].instructions, status: "pending", updated_at: new Date() })
        .where(eq(legacyDesignationsTable.id, existing[0].id)).returning();
      res.json({ designation: legacyDto(row!) });
      return;
    }
    const [row] = await db.insert(legacyDesignationsTable).values({ user_id: req.userId!, heir_user_id: parsed.data.heirUserId, instructions: parsed.data.instructions ?? "", status: "pending" }).returning();
    res.status(201).json({ designation: legacyDto(row!) });
  } catch (err) { logger.error({ err }, "[trust] legacy create failed"); res.status(500).json({ error: "Could not save your designation." }); }
});

router.delete("/legacy/designation", requireAuth, async (req, res) => {
  try {
    const [row] = await db.update(legacyDesignationsTable).set({ status: "revoked", updated_at: new Date() })
      .where(eq(legacyDesignationsTable.user_id, req.userId!)).returning();
    if (!row) { res.status(404).json({ error: "You have no designation to remove." }); return; }
    res.json({ designation: legacyDto(row) });
  } catch (err) { logger.error({ err }, "[trust] legacy revoke failed"); res.status(500).json({ error: "Could not remove your designation." }); }
});

router.get("/legacy/inbox", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(legacyDesignationsTable).where(eq(legacyDesignationsTable.heir_user_id, req.userId!)).orderBy(desc(legacyDesignationsTable.created_at));
    res.json({ designations: rows.map(legacyDto) });
  } catch (err) { logger.error({ err }, "[trust] legacy inbox failed"); res.status(500).json({ error: "Could not load designations naming you." }); }
});

router.post("/legacy/inbox/:id/respond", requireAuth, async (req, res) => {
  const id = param(req, "id");
  const parsed = z.object({ response: z.enum(["accept", "decline"]) }).safeParse(req.body ?? {});
  if (!isUuid(id) || !parsed.success) { res.status(400).json({ error: "Invalid response." }); return; }
  try {
    const rows = await db.select().from(legacyDesignationsTable).where(and(eq(legacyDesignationsTable.id, id), eq(legacyDesignationsTable.heir_user_id, req.userId!))).limit(1);
    const d = rows[0];
    if (!d) { res.status(404).json({ error: "Designation not found." }); return; }
    if (d.status !== "pending") { res.status(409).json({ error: `That designation is already ${d.status}.` }); return; }
    const [row] = await db.update(legacyDesignationsTable)
      .set({ status: parsed.data.response === "accept" ? "accepted" : "declined", updated_at: new Date() })
      .where(eq(legacyDesignationsTable.id, id)).returning();
    res.json({ designation: legacyDto(row!) });
  } catch (err) { logger.error({ err }, "[trust] legacy respond failed"); res.status(500).json({ error: "Could not record your answer." }); }
});

/* ═══ #2b Legacy contact — name + email of the person to CONTACT ═══════
   Not an heir and not a transfer: the designation above names a Bow
   Down Visuals account that would take over after manual review. This
   names ANY person (a partner, a family member) Bow Down Visuals
   should contact about the account and the creator's work if the
   creator no longer can. The record is the whole feature — it promises
   no account transfer, no payout, and no legal effect. Owner-only in
   both directions: every query is scoped to the caller, and the row is
   never joined into any public profile DTO — the email is private. */

const contactDto = (r: typeof legacyContactsTable.$inferSelect) => ({
  name: r.contact_name, email: r.contact_email, note: r.note,
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

router.get("/legacy/contact", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(legacyContactsTable).where(eq(legacyContactsTable.user_id, req.userId!)).limit(1);
    res.json({ contact: rows[0] ? contactDto(rows[0]) : null });
  } catch (err) { logger.error({ err }, "[trust] legacy contact get failed"); res.status(500).json({ error: "Could not load your legacy contact." }); }
});

const legacyContactBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  note: z.string().trim().max(1000).optional(),
});

router.put("/legacy/contact", requireAuth, async (req, res) => {
  const parsed = legacyContactBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid legacy contact", details: parsed.error.issues }); return; }
  try {
    const { name, email, note } = parsed.data;
    const existing = await db.select().from(legacyContactsTable).where(eq(legacyContactsTable.user_id, req.userId!)).limit(1);
    if (existing[0]) {
      const [row] = await db.update(legacyContactsTable)
        .set({ contact_name: name, contact_email: email, note: note ?? "", updated_at: new Date() })
        .where(eq(legacyContactsTable.id, existing[0].id)).returning();
      res.json({ contact: contactDto(row!) });
      return;
    }
    const [row] = await db.insert(legacyContactsTable).values({ user_id: req.userId!, contact_name: name, contact_email: email, note: note ?? "" }).returning();
    res.status(201).json({ contact: contactDto(row!) });
  } catch (err) { logger.error({ err }, "[trust] legacy contact save failed"); res.status(500).json({ error: "Could not save your legacy contact." }); }
});

router.delete("/legacy/contact", requireAuth, async (req, res) => {
  try {
    const existing = await db.select().from(legacyContactsTable).where(eq(legacyContactsTable.user_id, req.userId!)).limit(1);
    if (!existing[0]) { res.status(404).json({ error: "You have no legacy contact to remove." }); return; }
    await db.delete(legacyContactsTable).where(eq(legacyContactsTable.user_id, req.userId!));
    res.json({ contact: null });
  } catch (err) { logger.error({ err }, "[trust] legacy contact remove failed"); res.status(500).json({ error: "Could not remove your legacy contact." }); }
});

/* ═══ #3 Full-catalog portability export ══════════════════════════════ */

interface ManifestSource { status: "ok" | "error"; count: number | null; items: unknown[] }
async function manifestSection(fn: () => Promise<unknown[]>): Promise<ManifestSource> {
  try { const items = await fn(); return { status: "ok", count: items.length, items }; }
  catch (err) { logger.error({ err }, "[trust] catalog export section failed"); return { status: "error", count: null, items: [] }; }
}

export async function buildCatalogManifest(userId: string) {
  const rows = async (q: ReturnType<typeof sql>) => ((await db.execute(q)).rows as any[]);
  const [songs, videos, releases, storeProducts, audience] = await Promise.all([
    manifestSection(async () => (await rows(sql`SELECT id, title, audio_url AS "fileUrl", source, duration_sec AS "durationSec", created_at AS "createdAt" FROM songs WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 2000`))
      .map((r) => ({ ...r, format: "original audio file (link) + JSON metadata" }))),
    manifestSection(async () => (await rows(sql`SELECT id, title, video_url AS "fileUrl", thumbnail_url AS "thumbnailUrl", status, created_at AS "createdAt" FROM generated_clips WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 2000`))
      .map((r) => ({ ...r, format: "original video file (link) + JSON metadata" }))),
    manifestSection(async () => rows(sql`SELECT id, title, artist_name AS "artistName", status, audio_url AS "fileUrl", artwork_url AS "artworkUrl", platforms, metadata, created_at AS "createdAt" FROM distribution_releases WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 2000`)),
    manifestSection(async () => rows(sql`SELECT p.id, p.title, p.kind, p.price_cents AS "priceCents", p.is_active AS "isActive", p.media_urls AS "mediaUrls" FROM store_products p JOIN creator_profiles cp ON cp.id = p.profile_id WHERE cp.user_id = ${userId} LIMIT 2000`)),
    manifestSection(async () => rows(sql`SELECT s.email, s.name, s.source, s.subscribed_at AS "subscribedAt" FROM email_subscribers s JOIN email_lists l ON l.id = s.list_id WHERE l.user_id = ${userId} AND s.unsubscribed_at IS NULL LIMIT 10000`)),
  ]);
  const partial = [songs, videos, releases, storeProducts, audience].some((s) => s.status === "error");
  return {
    format: "manifest+links" as const,
    formatNote: "One manifest, not one giant zip: video originals are large, so each entry carries the file's download link plus its metadata in open JSON. For a spreadsheet instead, the export builder (Settings → Your whole catalog) downloads one catalog kind at a time as CSV with the fields you pick. Nothing is re-encoded.",
    exportedAt: new Date().toISOString(),
    includes: ["songs + audio files", "videos", "release metadata", "store products", "audience list (your email list subscribers who have not unsubscribed)"],
    partial, songs, videos, releases, storeProducts, audience,
  };
}

router.post("/catalog-export", requireAuth, async (req, res) => {
  try {
    const [job] = await db.insert(catalogExportJobsTable).values({ user_id: req.userId!, status: "running", progress: 10 }).returning();
    const manifest = await buildCatalogManifest(req.userId!);
    const [done] = await db.update(catalogExportJobsTable)
      .set({ status: "complete", progress: 100, manifest, updated_at: new Date() })
      .where(eq(catalogExportJobsTable.id, job!.id)).returning();
    res.status(201).json({ job: { id: done!.id, status: done!.status, progress: done!.progress, manifest: done!.manifest, createdAt: iso(done!.created_at) } });
  } catch (err) { logger.error({ err }, "[trust] catalog export failed"); res.status(500).json({ error: "Could not build your catalog package." }); }
});

router.get("/catalog-export", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(catalogExportJobsTable).where(eq(catalogExportJobsTable.user_id, req.userId!)).orderBy(desc(catalogExportJobsTable.created_at)).limit(50);
    res.json({ jobs: rows.map((j) => ({ id: j.id, status: j.status, progress: j.progress, error: j.error, createdAt: iso(j.created_at) })) });
  } catch (err) { logger.error({ err }, "[trust] catalog jobs failed"); res.status(500).json({ error: "Could not load your exports." }); }
});

router.get("/catalog-export/:id", requireAuth, async (req, res) => {
  const id = param(req, "id");
  if (!isUuid(id)) { res.status(400).json({ error: "Invalid export id." }); return; }
  try {
    const rows = await db.select().from(catalogExportJobsTable).where(and(eq(catalogExportJobsTable.id, id), eq(catalogExportJobsTable.user_id, req.userId!))).limit(1);
    const j = rows[0];
    if (!j) { res.status(404).json({ error: "Export not found." }); return; }
    res.json({ job: { id: j.id, status: j.status, progress: j.progress, manifest: j.manifest, error: j.error, createdAt: iso(j.created_at) } });
  } catch (err) { logger.error({ err }, "[trust] catalog job failed"); res.status(500).json({ error: "Could not load that export." }); }
});

/* ═══ #3b Catalog export BUILDER — one kind, your fields, a file ═══════
   The package above always carries everything. The builder is the
   narrower tool: one catalog kind (tracks / releases / videos), only the
   fields the creator picks, downloaded as CSV or JSON. Columns come ONLY
   from the whitelist below — the same columns buildCatalogManifest
   reads — so a field name off the wire can never become SQL. The query
   is born scoped to the caller (WHERE user_id = caller), never filtered
   after the fact. Same 2,000-row cap as the manifest; when the cap is
   hit the response SAYS so (X-Export-Truncated + the JSON body's
   `truncated`) instead of quietly dropping the tail. */

interface CatalogExportKindDef { table: string; fields: Record<string, string> }
export const CATALOG_EXPORT_KINDS: Record<string, CatalogExportKindDef> = {
  tracks: {
    table: "songs",
    fields: { id: "id", title: "title", source: "source", durationSec: "duration_sec", fileUrl: "audio_url", createdAt: "created_at" },
  },
  releases: {
    table: "distribution_releases",
    fields: { id: "id", title: "title", artistName: "artist_name", status: "status", fileUrl: "audio_url", artworkUrl: "artwork_url", createdAt: "created_at" },
  },
  videos: {
    table: "generated_clips",
    fields: { id: "id", title: "title", status: "status", fileUrl: "video_url", thumbnailUrl: "thumbnail_url", createdAt: "created_at" },
  },
};
export const CATALOG_EXPORT_ROW_CAP = 2000;

const exportCell = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v ?? null);

export async function buildCatalogExport(userId: string, kind: string, fields: string[]) {
  const def = CATALOG_EXPORT_KINDS[kind]!;
  const cols = sql.join(fields.map((f) => sql.raw(`"${def.fields[f]}" AS "${f}"`)), sql`, `);
  const rows = ((await db.execute(sql`SELECT ${cols} FROM ${sql.raw(def.table)} WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${sql.raw(String(CATALOG_EXPORT_ROW_CAP + 1))}`)).rows as Record<string, unknown>[])
    .map((r) => Object.fromEntries(fields.map((f) => [f, exportCell(r[f])])));
  const truncated = rows.length > CATALOG_EXPORT_ROW_CAP;
  return { rows: truncated ? rows.slice(0, CATALOG_EXPORT_ROW_CAP) : rows, truncated };
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const catalogBuildSchema = z.object({
  kind: z.enum(["tracks", "releases", "videos"]),
  fields: z.array(z.string().min(1)).min(1).max(16).optional(),
  format: z.enum(["csv", "json"]).default("csv"),
});

router.post("/catalog-export/build", requireAuth, async (req, res) => {
  const parsed = catalogBuildSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Choose a catalog kind (tracks, releases or videos), at least one field, and a format (csv or json)." }); return; }
  const { kind, format } = parsed.data;
  const def = CATALOG_EXPORT_KINDS[kind]!;
  const allowed = Object.keys(def.fields);
  const fields = [...new Set(parsed.data.fields ?? allowed)];
  const bad = fields.filter((f) => !allowed.includes(f));
  if (bad.length > 0) { res.status(400).json({ error: `Unknown ${kind} field(s): ${bad.join(", ")}. Available: ${allowed.join(", ")}.` }); return; }
  try {
    const { rows, truncated } = await buildCatalogExport(req.userId!, kind, fields);
    if (truncated) res.setHeader("X-Export-Truncated", "true");
    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="my-catalog-${kind}.json"`);
      res.json({ format: "catalog-export", kind, fields, count: rows.length, truncated, exportedAt: new Date().toISOString(), rows });
    } else {
      const lines = [fields.map(csvCell).join(","), ...rows.map((r) => fields.map((f) => csvCell(r[f])).join(","))];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="my-catalog-${kind}.csv"`);
      res.send(lines.join("\r\n") + "\r\n");
    }
  } catch (err) { logger.error({ err }, "[trust] catalog export build failed"); res.status(500).json({ error: "Could not build that export." }); }
});

/* ═══ #4 Unified mod console + automod ════════════════════════════════ */

async function myProfileId(userId: string): Promise<string | null> {
  const rows = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.userId, userId)).limit(1);
  return rows[0]?.id ?? null;
}
/** Console access: the channel owner, or an appointed moderator of it. */
async function consoleRole(userId: string, profileId: string): Promise<"owner" | "moderator" | null> {
  const own = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.id, profileId)).limit(1);
  if (!own[0]) return null;
  if (own[0].userId === userId) return "owner";
  const mods = await db.select().from(liveChannelModeratorsTable)
    .where(and(eq(liveChannelModeratorsTable.profile_id, profileId), eq(liveChannelModeratorsTable.moderator_user_id, userId))).limit(1);
  return mods[0] ? "moderator" : null;
}
const profileParam = async (req: Request, res: Response): Promise<{ profileId: string; role: "owner" | "moderator" } | null> => {
  const profileId = typeof req.query["profileId"] === "string" ? req.query["profileId"] : param(req, "profileId");
  if (!isUuid(profileId)) { res.status(400).json({ error: "A channel profile id is required." }); return null; }
  const role = await consoleRole(req.userId!, profileId);
  if (!role) { res.status(403).json({ error: "Only the creator and their appointed moderators can open this console." }); return null; }
  return { profileId, role };
};

router.get("/mod-console", requireAuth, async (req, res) => {
  const ctx = await profileParam(req, res); if (!ctx) return;
  try {
    const actions = await db.select().from(chatModActionsTable).where(eq(chatModActionsTable.profile_id, ctx.profileId)).orderBy(desc(chatModActionsTable.created_at)).limit(200);
    const rulesRows = await db.select().from(chatAutomodRulesTable).where(eq(chatAutomodRulesTable.profile_id, ctx.profileId)).limit(1);
    const r = rulesRows[0];
    res.json({
      profileId: ctx.profileId, yourRole: ctx.role,
      flagged: actions.filter((a) => a.action === "automod_flag" || a.action === "flag"),
      actions: actions.map((a) => ({ id: a.id, streamId: a.stream_id, actorUserId: a.actor_user_id, targetUserId: a.target_user_id, action: a.action, reason: a.reason, rule: a.rule, messageBody: a.message_body, createdAt: iso(a.created_at) })),
      automod: r ? { blockLinks: r.block_links, blockedWords: r.blocked_words ?? [], capsPercent: r.caps_percent, capsMinLength: r.caps_min_length } : { blockLinks: false, blockedWords: [], capsPercent: null, capsMinLength: 12 },
    });
  } catch (err) { logger.error({ err }, "[trust] mod console failed"); res.status(500).json({ error: "Could not load the mod console." }); }
});

const automodBody = z.object({
  blockLinks: z.boolean().optional(),
  blockedWords: z.array(z.string().trim().min(1).max(60)).max(200).optional(),
  capsPercent: z.number().int().min(50).max(100).nullable().optional(),
  capsMinLength: z.number().int().min(4).max(100).optional(),
});

router.put("/mod-console/automod", requireAuth, async (req, res) => {
  const parsed = automodBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid automod rules", details: parsed.error.issues }); return; }
  const profileId = typeof (req.body as any)?.profileId === "string" ? (req.body as any).profileId : "";
  if (!isUuid(profileId)) { res.status(400).json({ error: "A channel profile id is required." }); return; }
  const role = await consoleRole(req.userId!, profileId);
  if (role !== "owner") { res.status(403).json({ error: "Only the creator sets automod rules — moderators work within them." }); return; }
  try {
    const existing = await db.select().from(chatAutomodRulesTable).where(eq(chatAutomodRulesTable.profile_id, profileId)).limit(1);
    const values = {
      block_links: parsed.data.blockLinks ?? existing[0]?.block_links ?? false,
      blocked_words: parsed.data.blockedWords ?? existing[0]?.blocked_words ?? [],
      caps_percent: parsed.data.capsPercent !== undefined ? parsed.data.capsPercent : (existing[0]?.caps_percent ?? null),
      caps_min_length: parsed.data.capsMinLength ?? existing[0]?.caps_min_length ?? 12,
      updated_at: new Date(),
    };
    const [row] = existing[0]
      ? await db.update(chatAutomodRulesTable).set(values).where(eq(chatAutomodRulesTable.id, existing[0].id)).returning()
      : await db.insert(chatAutomodRulesTable).values({ profile_id: profileId, ...values }).returning();
    res.json({ automod: { blockLinks: row!.block_links, blockedWords: row!.blocked_words ?? [], capsPercent: row!.caps_percent, capsMinLength: row!.caps_min_length } });
  } catch (err) { logger.error({ err }, "[trust] automod save failed"); res.status(500).json({ error: "Could not save automod rules." }); }
});

const modActionBody = z.object({
  profileId: z.string().uuid(), streamId: z.string().uuid().optional().nullable(),
  targetUserId: z.string().uuid().optional().nullable(),
  action: z.enum(["flag", "delete", "mute", "unmute"]),
  reason: z.string().trim().min(1).max(500),
  messageBody: z.string().max(500).optional().nullable(),
});

router.post("/mod-console/actions", requireAuth, async (req, res) => {
  const parsed = modActionBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Every moderation action needs a recorded reason.", details: parsed.error.issues }); return; }
  try {
    const role = await consoleRole(req.userId!, parsed.data.profileId);
    if (!role) { res.status(403).json({ error: "Only the creator and their appointed moderators can do that." }); return; }
    const [row] = await db.insert(chatModActionsTable).values({
      profile_id: parsed.data.profileId, stream_id: parsed.data.streamId ?? null,
      actor_user_id: req.userId!, target_user_id: parsed.data.targetUserId ?? null,
      action: parsed.data.action, reason: parsed.data.reason, rule: null, message_body: parsed.data.messageBody ?? null,
    }).returning();
    res.status(201).json({ actionEntry: { id: row!.id, action: row!.action, reason: row!.reason, createdAt: iso(row!.created_at) } });
  } catch (err) { logger.error({ err }, "[trust] mod action failed"); res.status(500).json({ error: "Could not record that action." }); }
});

/** Why was I flagged? — the affected chatter's own honest view. */
router.get("/mod-console/my-flags", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(chatModActionsTable).where(eq(chatModActionsTable.target_user_id, req.userId!)).orderBy(desc(chatModActionsTable.created_at)).limit(100);
    res.json({ flags: rows.map((a) => ({ id: a.id, action: a.action, reason: a.reason, rule: a.rule, createdAt: iso(a.created_at) })) });
  } catch (err) { logger.error({ err }, "[trust] my flags failed"); res.status(500).json({ error: "Could not load your flags." }); }
});

export { evaluateAutomod };

/* ═══ #5 Earnings documents ═══════════════════════════════════════════ */

interface YearSource { status: "ok" | "error"; totalCents: number | null; count: number | null }
const errYear = (): YearSource => ({ status: "error", totalCents: null, count: null });

export async function buildYearStatement(userId: string, year: number) {
  const one = async (fn: () => Promise<YearSource>): Promise<YearSource> => { try { return await fn(); } catch (err) { logger.error({ err }, "[trust] statement source failed"); return errYear(); } };
  const sum = async (q: ReturnType<typeof sql>) => { const r = await db.execute(q); const row = (r.rows as any[])[0] ?? { cents: 0, n: 0 }; return { status: "ok" as const, totalCents: Number(row.cents), count: Number(row.n) }; };
  const storeSales = await one(() => sum(sql`
    SELECT COALESCE(SUM(o.creator_amount_cents),0)::int AS cents, COUNT(*)::int AS n FROM store_orders o
    JOIN creator_profiles cp ON cp.id = o.profile_id
    WHERE cp.user_id = ${userId} AND o.status = 'completed' AND EXTRACT(YEAR FROM o.created_at) = ${year}`));
  const shopSales = await one(() => sum(sql`
    SELECT COALESCE(SUM(amount_cents - platform_fee_cents),0)::int AS cents, COUNT(*)::int AS n FROM shop_events
    WHERE user_id = ${userId} AND event_type = 'sale' AND EXTRACT(YEAR FROM created_at) = ${year}`));
  const memberships = await one(() => sum(sql`
    SELECT COALESCE(SUM(price_cents),0)::int AS cents, COUNT(*)::int AS n FROM fan_members
    WHERE user_id = ${userId} AND stripe_session_id IS NOT NULL AND EXTRACT(YEAR FROM created_at) = ${year}`));
  const brandDeals = await one(() => sum(sql`
    SELECT COALESCE(SUM(net_cents),0)::int AS cents, COUNT(*)::int AS n FROM sponsor_payouts
    WHERE creator_user_id = ${userId} AND status = 'released' AND EXTRACT(YEAR FROM created_at) = ${year}`));
  const royalties = await one(async () => {
    const r = await db.execute(sql`SELECT COALESCE(SUM(gross_amount * 100),0)::int AS cents, COUNT(*)::int AS n FROM royalty_entries WHERE user_id = ${userId} AND EXTRACT(YEAR FROM period_end) = ${year}`);
    const row = (r.rows as any[])[0] ?? { cents: 0, n: 0 };
    return { status: "ok" as const, totalCents: Number(row.cents), count: Number(row.n) };
  });
  const sources = { storeSales, shopSales, memberships, brandDeals, royalties };
  const partial = Object.values(sources).some((s) => s.status === "error");
  const totalCents = Object.values(sources).reduce((acc, s) => acc + (s.totalCents ?? 0), 0);
  return {
    year, userId, currency: "USD", totalCents, partial, sources,
    documentKind: "statement_of_platform_recorded_earnings" as const,
    disclaimer: "This is a statement of earnings recorded on this platform — it is not a filed tax form and not tax advice. If you were paid through a payment processor, that processor issues its own tax forms; keep both.",
  };
}
const yearParam = (req: Request) => { const y = Number(param(req, "year")); return Number.isInteger(y) && y >= 2020 && y <= 2100 ? y : null; };

router.get("/earnings/statements/:year", requireAuth, async (req, res) => {
  const year = yearParam(req);
  if (!year) { res.status(400).json({ error: "Give a four-digit year." }); return; }
  const stmt = await buildYearStatement(req.userId!, year);
  res.json({ statement: stmt });
});

router.get("/earnings/statements/:year/pdf", requireAuth, async (req, res) => {
  const year = yearParam(req);
  if (!year) { res.status(400).json({ error: "Give a four-digit year." }); return; }
  try {
    const stmt = await buildYearStatement(req.userId!, year);
    const money = (c: number | null) => (c == null ? "unavailable" : `$${(c / 100).toFixed(2)}`);
    const b = new PdfBuilder(`Earnings statement ${year}`);
    const page = b.addPage();
    page.rect(0, 0, 612, 96, BLACK);
    page.text(48, 30, "EARNINGS STATEMENT", { size: 22, bold: true, color: GOLD });
    page.text(48, 60, `Bow Down Visuals · ${year}`, { size: 11, color: WHITE });
    let y = 130;
    page.text(48, y, "What this is", { size: 12, bold: true }); y += 20;
    page.text(48, y, stmt.disclaimer, { size: 9, color: GREY, maxWidth: 500 }); y += 48;
    const lines: Array<[string, YearSource]> = [["Store sales", stmt.sources.storeSales], ["Shop sales", stmt.sources.shopSales], ["Memberships", stmt.sources.memberships], ["Brand deals", stmt.sources.brandDeals], ["Royalties (recorded)", stmt.sources.royalties]];
    for (const [label, s] of lines) {
      page.text(48, y, label, { size: 11 });
      page.text(564, y, s.status === "error" ? "could not load" : `${money(s.totalCents)}  (${s.count} records)`, { size: 11, align: "right" });
      y += 22;
    }
    page.line(48, 564, y, GOLD, 1.5); y += 24;
    page.text(48, y, stmt.partial ? "Total of the sources that loaded" : "Total", { size: 12, bold: true });
    page.text(564, y, money(stmt.totalCents), { size: 12, bold: true, align: "right" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="earnings-statement-${year}.pdf"`);
    res.send(b.toBuffer());
  } catch (err) { logger.error({ err }, "[trust] statement pdf failed"); res.status(500).json({ error: "Could not render that statement." }); }
});

/* ═══ #6 Stage audio rooms (REST; WS at file bottom) ═════════════════ */

const stageDto = (r: typeof stageRoomsTable.$inferSelect) => ({
  id: r.id, hostUserId: r.host_user_id, profileId: r.profile_id, title: r.title, status: r.status,
  speakerCap: STAGE_SPEAKER_CAP, presenceCap: STAGE_PRESENCE_CAP,
  livePeers: stageRooms.get(r.id)?.peersDto() ?? [],
  createdAt: iso(r.created_at), closedAt: r.closed_at ? iso(r.closed_at) : null,
});

router.post("/stage-rooms", requireAuth, async (req, res) => {
  const parsed = z.object({ title: z.string().trim().min(1).max(120) }).safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Your room needs a title." }); return; }
  try {
    const profileId = await myProfileId(req.userId!);
    const [row] = await db.insert(stageRoomsTable).values({ host_user_id: req.userId!, profile_id: profileId, title: parsed.data.title, status: "open" }).returning();
    getOrCreateStageRoom(liveChatHub as unknown as RoomHub, row!.id, req.userId!);
    res.status(201).json({ room: stageDto(row!) });
  } catch (err) { logger.error({ err }, "[trust] stage create failed"); res.status(500).json({ error: "Could not open that room." }); }
});

router.get("/stage-rooms", async (_req, res) => {
  try {
    const rows = await db.select().from(stageRoomsTable).where(eq(stageRoomsTable.status, "open")).orderBy(desc(stageRoomsTable.created_at)).limit(100);
    res.json({ rooms: rows.map(stageDto) });
  } catch (err) { logger.error({ err }, "[trust] stage list failed"); res.status(500).json({ error: "Could not load rooms." }); }
});

router.post("/stage-rooms/:id/close", requireAuth, async (req, res) => {
  const id = param(req, "id");
  if (!isUuid(id)) { res.status(400).json({ error: "Invalid room id." }); return; }
  try {
    const [row] = await db.update(stageRoomsTable).set({ status: "closed", closed_at: new Date(), updated_at: new Date() })
      .where(and(eq(stageRoomsTable.id, id), eq(stageRoomsTable.host_user_id, req.userId!))).returning();
    if (!row) { res.status(404).json({ error: "Room not found, or it isn't yours to close." }); return; }
    /* The in-process presence dies with the row (Flag S-2) — before
       this, the registry kept every closed room for the process life. */
    evictStageRoom(id);
    res.json({ room: stageDto(row) });
  } catch (err) { logger.error({ err }, "[trust] stage close failed"); res.status(500).json({ error: "Could not close that room." }); }
});

/* ═══ #7 Group roles + onboarding ═════════════════════════════════════ */

async function groupAndRole(slug: string, userId: string) {
  const g = (await db.select().from(groupsTable).where(eq(groupsTable.slug, slug)).limit(1))[0];
  if (!g) return { group: null, role: null };
  const m = (await db.select().from(groupMembersTable).where(and(eq(groupMembersTable.groupId, g.id), eq(groupMembersTable.userId, userId))).limit(1))[0];
  return { group: g, role: normalizeGroupRole(m?.role) };
}

router.get("/groups/:slug/my-role", requireAuth, async (req, res) => {
  const { group, role } = await groupAndRole(param(req, "slug"), req.userId!);
  if (!group) { res.status(404).json({ error: "Group not found." }); return; }
  res.json({ role, can: role ? { post: canGroupAction(role, "post"), deletePost: canGroupAction(role, "deletePost"), reviewJoinRequests: canGroupAction(role, "reviewJoinRequests"), setJoinQuestions: canGroupAction(role, "setJoinQuestions"), removeMember: canGroupAction(role, "removeMember"), setMemberRole: canGroupAction(role, "setMemberRole") } : null });
});

router.patch("/groups/:slug/members/:userId/role", requireAuth, async (req, res) => {
  const parsed = z.object({ role: z.enum(["admin", "moderator", "member"]) }).safeParse(req.body ?? {});
  if (!parsed.success || !isUuid(param(req, "userId"))) { res.status(400).json({ error: "Invalid role change." }); return; }
  const { group, role } = await groupAndRole(param(req, "slug"), req.userId!);
  if (!group) { res.status(404).json({ error: "Group not found." }); return; }
  const targetId = param(req, "userId");
  const tm = (await db.select().from(groupMembersTable).where(and(eq(groupMembersTable.groupId, group.id), eq(groupMembersTable.userId, targetId))).limit(1))[0];
  if (!tm) { res.status(404).json({ error: "They're not in this group." }); return; }
  if (!canAssignRole(role, tm.role, parsed.data.role)) { res.status(403).json({ error: "Your rung on the ladder can't make that change — roles move strictly below the person changing them, and ownership never moves this way." }); return; }
  await db.update(groupMembersTable).set({ role: parsed.data.role }).where(and(eq(groupMembersTable.groupId, group.id), eq(groupMembersTable.userId, targetId)));
  res.json({ ok: true, userId: targetId, role: parsed.data.role });
});

router.get("/groups/:slug/join-questions", async (req, res) => {
  const g = (await db.select().from(groupsTable).where(eq(groupsTable.slug, param(req, "slug"))).limit(1))[0];
  if (!g) { res.status(404).json({ error: "Group not found." }); return; }
  const qs = await db.select().from(groupJoinQuestionsTable).where(eq(groupJoinQuestionsTable.group_id, g.id)).orderBy(asc(groupJoinQuestionsTable.position));
  res.json({ questions: qs.map((q) => ({ id: q.id, question: q.question, position: q.position })) });
});

router.put("/groups/:slug/join-questions", requireAuth, async (req, res) => {
  const parsed = z.object({ questions: z.array(z.string().trim().min(1).max(300)).max(5) }).safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Up to five short questions." }); return; }
  const { group, role } = await groupAndRole(param(req, "slug"), req.userId!);
  if (!group) { res.status(404).json({ error: "Group not found." }); return; }
  if (!canGroupAction(role, "setJoinQuestions")) { res.status(403).json({ error: "Only group admins and the owner set join questions — moderators review answers, they don't write the questions." }); return; }
  await db.delete(groupJoinQuestionsTable).where(eq(groupJoinQuestionsTable.group_id, group.id));
  for (let i = 0; i < parsed.data.questions.length; i++) await db.insert(groupJoinQuestionsTable).values({ group_id: group.id, question: parsed.data.questions[i]!, position: i });
  const qs = await db.select().from(groupJoinQuestionsTable).where(eq(groupJoinQuestionsTable.group_id, group.id)).orderBy(asc(groupJoinQuestionsTable.position));
  res.json({ questions: qs.map((q) => ({ id: q.id, question: q.question, position: q.position })) });
});

router.post("/groups/:slug/join-requests", requireAuth, async (req, res) => {
  const parsed = z.object({ answers: z.array(z.object({ questionId: z.string().uuid(), answer: z.string().trim().min(1).max(1000) })).max(5).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid answers." }); return; }
  const g = (await db.select().from(groupsTable).where(eq(groupsTable.slug, param(req, "slug"))).limit(1))[0];
  if (!g) { res.status(404).json({ error: "Group not found." }); return; }
  const { role } = await groupAndRole(param(req, "slug"), req.userId!);
  if (role) { res.status(409).json({ error: "You're already in this group." }); return; }
  const qs = await db.select().from(groupJoinQuestionsTable).where(eq(groupJoinQuestionsTable.group_id, g.id)).orderBy(asc(groupJoinQuestionsTable.position));
  if (qs.length === 0) { res.status(409).json({ error: "This group takes direct joins — use the join button; no questions are set." }); return; }
  const given = new Map((parsed.data.answers ?? []).map((a) => [a.questionId, a.answer]));
  if (qs.some((q) => !given.get(q.id))) { res.status(400).json({ error: "Answer every join question — the admins read them when they decide." }); return; }
  const existing = await db.select().from(groupJoinRequestsTable).where(and(eq(groupJoinRequestsTable.group_id, g.id), eq(groupJoinRequestsTable.user_id, req.userId!), eq(groupJoinRequestsTable.status, "pending"))).limit(1);
  if (existing[0]) { res.status(409).json({ error: "Your request is already waiting on the admins." }); return; }
  const [row] = await db.insert(groupJoinRequestsTable).values({
    group_id: g.id, user_id: req.userId!, status: "pending",
    answers: qs.map((q) => ({ questionId: q.id, question: q.question, answer: given.get(q.id)! })),
  }).returning();
  res.status(201).json({ request: { id: row!.id, status: row!.status, createdAt: iso(row!.created_at) } });
});

router.get("/groups/:slug/join-requests", requireAuth, async (req, res) => {
  const { group, role } = await groupAndRole(param(req, "slug"), req.userId!);
  if (!group) { res.status(404).json({ error: "Group not found." }); return; }
  if (!canGroupAction(role, "reviewJoinRequests")) { res.status(403).json({ error: "Only moderators and up can review join requests." }); return; }
  const rows = await db.select().from(groupJoinRequestsTable).where(and(eq(groupJoinRequestsTable.group_id, group.id), eq(groupJoinRequestsTable.status, "pending"))).orderBy(asc(groupJoinRequestsTable.created_at));
  res.json({ requests: rows.map((r) => ({ id: r.id, userId: r.user_id, answers: r.answers ?? [], status: r.status, createdAt: iso(r.created_at) })) });
});

router.post("/groups/:slug/join-requests/:requestId/review", requireAuth, async (req, res) => {
  const parsed = z.object({ decision: z.enum(["approve", "deny"]) }).safeParse(req.body ?? {});
  if (!parsed.success || !isUuid(param(req, "requestId"))) { res.status(400).json({ error: "Invalid review." }); return; }
  const { group, role } = await groupAndRole(param(req, "slug"), req.userId!);
  if (!group) { res.status(404).json({ error: "Group not found." }); return; }
  if (!canGroupAction(role, "reviewJoinRequests")) { res.status(403).json({ error: "Only moderators and up can review join requests." }); return; }
  const jr = (await db.select().from(groupJoinRequestsTable).where(and(eq(groupJoinRequestsTable.id, param(req, "requestId")), eq(groupJoinRequestsTable.group_id, group.id))).limit(1))[0];
  if (!jr || jr.status !== "pending") { res.status(404).json({ error: "That request isn't waiting anymore." }); return; }
  const status = parsed.data.decision === "approve" ? "approved" : "denied";
  await db.update(groupJoinRequestsTable).set({ status, reviewed_by: req.userId!, updated_at: new Date() }).where(eq(groupJoinRequestsTable.id, jr.id));
  if (status === "approved") {
    const already = await groupAndRole(param(req, "slug"), jr.user_id);
    if (!already.role) {
      await db.insert(groupMembersTable).values({ groupId: group.id, userId: jr.user_id, role: "member" });
      await db.update(groupsTable).set({ memberCount: sql`${groupsTable.memberCount} + 1` }).where(eq(groupsTable.id, group.id));
    }
  }
  res.json({ ok: true, status });
});

/* ═══ #8 Retention curves + audience breakdown ════════════════════════ */

const heartbeatBody = z.object({
  videoId: z.string().uuid(),
  ownerUserId: z.string().uuid().optional().nullable(),
  positionSeconds: z.number().min(0).max(86400),
  durationSeconds: z.number().min(1).max(86400),
});

router.post("/analytics/retention/heartbeat", requireAuth, async (req, res) => {
  const parsed = heartbeatBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid heartbeat." }); return; }
  if (parsed.data.positionSeconds > parsed.data.durationSeconds + 5) { res.status(400).json({ error: "Position can't run past the end of the video." }); return; }
  try {
    await db.insert(videoRetentionEventsTable).values({
      video_id: parsed.data.videoId, owner_user_id: parsed.data.ownerUserId ?? null,
      viewer_user_id: req.userId!, position_seconds: parsed.data.positionSeconds, duration_seconds: parsed.data.durationSeconds,
    });
    res.status(201).json({ ok: true });
  } catch (err) { logger.error({ err }, "[trust] heartbeat failed"); res.status(500).json({ error: "Could not record that heartbeat." }); }
});

export function retentionCurve(events: Array<{ position_seconds: number; duration_seconds: number; viewer_user_id: string | null }>, buckets = 10) {
  const viewers = new Set(events.map((e) => e.viewer_user_id ?? "anon"));
  const maxByViewer = new Map<string, number>();
  for (const e of events) {
    const pct = Math.min(1, e.position_seconds / Math.max(1, e.duration_seconds));
    const k = e.viewer_user_id ?? "anon";
    maxByViewer.set(k, Math.max(maxByViewer.get(k) ?? 0, pct));
  }
  const total = Math.max(1, viewers.size);
  const curve = Array.from({ length: buckets }, (_, i) => {
    const threshold = i / buckets;
    let reached = 0;
    for (const v of maxByViewer.values()) if (v >= threshold) reached++;
    return { bucketStartPct: Math.round(threshold * 100), retainedPct: Math.round((reached / total) * 1000) / 10 };
  });
  return { curve, uniqueViewers: viewers.size };
}

router.get("/analytics/videos/:videoId/retention", requireAuth, async (req, res) => {
  const videoId = param(req, "videoId");
  if (!isUuid(videoId)) { res.status(400).json({ error: "Invalid video id." }); return; }
  try {
    const events = await db.select().from(videoRetentionEventsTable).where(eq(videoRetentionEventsTable.video_id, videoId)).limit(20000);
    if (events.length === 0) {
      res.json({ videoId, hasData: false, note: "No retention data recorded for this video yet — curves build from real playback heartbeats, and older videos were never back-filled.", curve: [], audience: null });
      return;
    }
    const ownerId = events.find((e) => e.owner_user_id)?.owner_user_id ?? null;
    // Audience breakdown — only from rows that exist: follows for
    // follower-vs-not, and each viewer's earliest event on ANY video
    // of this owner for new-vs-returning.
    let audience: { followers: number; nonFollowers: number; newViewers: number; returningViewers: number } | null = null;
    if (ownerId) {
      const profile = (await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.userId, ownerId)).limit(1))[0];
      const viewerIds = [...new Set(events.map((e) => e.viewer_user_id).filter(Boolean))] as string[];
      let followerSet = new Set<string>();
      if (profile) {
        const fr = await db.select().from(followsTable).where(eq(followsTable.profileId, profile.id));
        followerSet = new Set(fr.map((f) => f.followerUserId));
      }
      const prior = await db.select().from(videoRetentionEventsTable).where(eq(videoRetentionEventsTable.owner_user_id, ownerId));
      const firstSeen = new Map<string, number>();
      for (const e of prior) { if (!e.viewer_user_id) continue; const t = new Date(e.created_at).getTime(); if (!firstSeen.has(e.viewer_user_id) || t < firstSeen.get(e.viewer_user_id)!) firstSeen.set(e.viewer_user_id, t); }
      const thisVideoFirst = new Map<string, number>();
      for (const e of events) { if (!e.viewer_user_id) continue; const t = new Date(e.created_at).getTime(); if (!thisVideoFirst.has(e.viewer_user_id) || t < thisVideoFirst.get(e.viewer_user_id)!) thisVideoFirst.set(e.viewer_user_id, t); }
      let followers = 0, nonFollowers = 0, newViewers = 0, returningViewers = 0;
      for (const vid of viewerIds) {
        if (followerSet.has(vid)) followers++; else nonFollowers++;
        if ((firstSeen.get(vid) ?? Infinity) < (thisVideoFirst.get(vid) ?? Infinity)) returningViewers++; else newViewers++;
      }
      audience = { followers, nonFollowers, newViewers, returningViewers };
    }
    const { curve, uniqueViewers } = retentionCurve(events);
    res.json({ videoId, hasData: true, curve, uniqueViewers, eventCount: events.length, audience });
  } catch (err) { logger.error({ err }, "[trust] retention failed"); res.status(500).json({ error: "Could not load retention for that video." }); }
});

/* ═══ #6 Stage WS registration ════════════════════════════════════════ */

export const stageHub = new RoomHub();
export function registerStageWs(gateway: LiveWsGateway, deps: { verifyToken?: typeof verifyAccessToken } = {}): void {
  const verifyToken = deps.verifyToken ?? verifyAccessToken;
  gateway.register("/api/stage-rooms/:id/ws", async ({ socket, params, query }) => {
    const rows = await db.select().from(stageRoomsTable).where(eq(stageRoomsTable.id, params.id)).limit(1).catch(() => []);
    const room = rows[0];
    if (!room || room.status !== "open") { socket.close(4404, "That room isn't open"); return; }
    const token = query.get("token") ?? "";
    const auth = token ? await verifyToken(token) : null;
    const stage = getOrCreateStageRoom(stageHub, room.id, room.host_user_id);
    const client = socket as unknown as WsClientSocket;
    if (!stage.attach(client, { userId: auth?.userId ?? null, displayName: auth ? "Member" : "Guest" })) return;
    socket.on("message", (data: unknown) => stage.handleFrame(client, String(data)));
    socket.on("close", () => stage.detach(client));
  });
}

export default router;
