import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { db, projectDraftsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { refreshSupabaseStorageUrlsDeep, normalizeToStorageRef } from "../lib/objectStorage";
import { isExternalHttpUrl, isPermanentMediaValue, mirrorExternalMediaUrl } from "../lib/mirrorMedia";

const router = Router();

/* Mirror-on-save, write-time half (2026-10-13 law): draft_data is an
   untyped client-assembled blob, so arbitrary links inside it can't be
   told apart from media — but any value pointing at OUR OWN storage is
   normalized to its permanent ref before persisting (normalizeToStorageRef
   is documented "use at WRITE time"), so a stored signed URL can never
   expire. External provider URLs are handled by the typed-key convention
   below (mirrorDraftMediaDeep). */
function normalizeDraftRefsDeep<T>(value: T): T {
  if (typeof value === "string") {
    return (normalizeToStorageRef(value) ?? value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => normalizeDraftRefsDeep(v)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalizeDraftRefsDeep(v)]),
    ) as T;
  }
  return value;
}

/* ─── Typed-key media mirroring ─────────────────────────────────────────
   External media URLs inside draft_data are mirrored into permanent
   storage ONLY under the media-key conventions the draft producers
   actually save. Deep-mirroring every http(s) string in the blob would
   download arbitrary web links users paste into text fields, so this
   key set is evidence-driven — collected from the four producers that
   POST /api/drafts:

   • pages/make-video.tsx + pages/song-and-video.tsx save
     { scenes, formValues, audioUrl, step, … }: the top-level `audioUrl`
     is the user's song (audio), and each SceneData entry
     (lib/scene-parser.ts) carries `demoClipUrl` (video), `thumbnailUrl`
     (image) and `locationImageUrl` (image, a Locations-library pick).
   • lib/music-lane.ts saves a LaneSession whose `pickedVersion`
     ({ url, storagePath, name, durationSec }) and `variants[]`
     ({ url, storagePath, label }) hold generated song files. A bare
     `url` therefore counts as media ONLY inside an object that also
     carries a `storagePath` sibling — the marker that the entry is a
     stored-media asset — and those are audio.
   • components/outreach/SponsorReadPanel.tsx saves text only (script,
     key points, brand copy) — no media keys; nothing in that shape is
     ever mirrored.

   Values under ANY other key (lyrics, prompts, specialInstructions —
   users paste ordinary links there) are never sent to the mirror and
   stay byte-identical. Media values that are already permanent or
   point at our own storage pass through via the guards (same pattern
   as mirrorProjectScenes): the helper normalizes own-storage URLs to
   their ref without a download. */
const DRAFT_MEDIA_KEYS: Record<string, "image" | "video" | "audio"> = {
  audioUrl: "audio",
  demoClipUrl: "video",
  thumbnailUrl: "image",
  locationImageUrl: "image",
};

async function mirrorDraftMediaDeep<T>(value: T, ownerKey: string): Promise<T> {
  if (Array.isArray(value)) {
    return (await Promise.all(
      value.map((v) => mirrorDraftMediaDeep(v, ownerKey)),
    )) as T;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const hasStoragePathSibling = typeof obj["storagePath"] === "string";
    const entries = await Promise.all(
      Object.entries(obj).map(async ([key, v]) => {
        const kind =
          DRAFT_MEDIA_KEYS[key] ??
          (key === "url" && hasStoragePathSibling ? ("audio" as const) : undefined);
        if (kind && typeof v === "string" && isExternalHttpUrl(v) && !isPermanentMediaValue(v)) {
          return [key, await mirrorExternalMediaUrl(v, { kind, ownerKey })] as const;
        }
        return [key, await mirrorDraftMediaDeep(v, ownerKey)] as const;
      }),
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}

const UpsertDraftSchema = z.object({
  workflowType: z.string().min(1).max(64),
  title: z.string().max(200).optional().nullable(),
  draftData: z.record(z.string(), z.unknown()),
});

/* POST /api/drafts — upsert (one slot per user per workflow) */
router.post("/drafts", requireAuth, async (req, res) => {
  const parsed = UpsertDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid draft data", details: parsed.error.issues });
    return;
  }
  const { workflowType, title, draftData } = parsed.data;
  /* Mirror external media under the typed-key convention first (it
     downloads), then normalize any of our own storage URLs to refs. */
  const storedDraftData = normalizeDraftRefsDeep(
    await mirrorDraftMediaDeep(draftData, req.userId!),
  );

  try {
    const [row] = await db
      .insert(projectDraftsTable)
      .values({
        user_id: req.userId!,
        workflow_type: workflowType,
        title: title ?? null,
        draft_data: storedDraftData,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [projectDraftsTable.user_id, projectDraftsTable.workflow_type],
        set: {
          title: title ?? null,
          draft_data: storedDraftData,
          updated_at: new Date(),
        },
      })
      .returning({ id: projectDraftsTable.id });

    res.status(201).json({ id: row?.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save draft";
    req.log.error({ err: msg }, "[drafts] upsert failed");
    res.status(500).json({ error: msg });
  }
});

/* GET /api/drafts — list drafts for the user (optionally filter by workflow) */
router.get("/drafts", requireAuth, async (req, res) => {
  const { workflow } = req.query as { workflow?: string };

  try {
    const rows = await db
      .select()
      .from(projectDraftsTable)
      .where(
        workflow
          ? and(
              eq(projectDraftsTable.user_id, req.userId!),
              eq(projectDraftsTable.workflow_type, workflow),
            )
          : eq(projectDraftsTable.user_id, req.userId!),
      )
      .orderBy(desc(projectDraftsTable.updated_at));

    /* Storage refs inside draft data are re-signed fresh on every read. */
    const refreshedRows = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        draft_data: await refreshSupabaseStorageUrlsDeep(row.draft_data),
      })),
    );

    res.json({ drafts: refreshedRows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch drafts";
    res.status(500).json({ error: msg });
  }
});

/* GET /api/drafts/:id — load a specific draft */
router.get("/drafts/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };

  try {
    const [row] = await db
      .select()
      .from(projectDraftsTable)
      .where(
        and(
          eq(projectDraftsTable.id, id),
          eq(projectDraftsTable.user_id, req.userId!),
        ),
      )
      .limit(1);

    if (!row) { res.status(404).json({ error: "Draft not found" }); return; }

    /* Storage refs inside draft data are re-signed fresh on every read. */
    row.draft_data = await refreshSupabaseStorageUrlsDeep(row.draft_data);

    res.json({ draft: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch draft";
    res.status(500).json({ error: msg });
  }
});

/* DELETE /api/drafts/:id */
router.delete("/drafts/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };

  try {
    await db
      .delete(projectDraftsTable)
      .where(
        and(
          eq(projectDraftsTable.id, id),
          eq(projectDraftsTable.user_id, req.userId!),
        ),
      );
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete draft";
    res.status(500).json({ error: msg });
  }
});

/* DELETE /api/drafts?workflow=make-video — delete by workflow type */
router.delete("/drafts", requireAuth, async (req, res) => {
  const { workflow } = req.query as { workflow?: string };
  if (!workflow) { res.status(400).json({ error: "workflow query param required" }); return; }

  try {
    await db
      .delete(projectDraftsTable)
      .where(
        and(
          eq(projectDraftsTable.user_id, req.userId!),
          eq(projectDraftsTable.workflow_type, workflow),
        ),
      );
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete draft";
    res.status(500).json({ error: msg });
  }
});

export default router;
