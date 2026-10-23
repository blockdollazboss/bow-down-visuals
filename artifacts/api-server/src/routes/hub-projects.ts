import { Router, json } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { recordCreation } from "../lib/retention";
import { mirrorExternalMediaUrl } from "../lib/mirrorMedia";
import { refreshSupabaseStorageUrlsDeep, normalizeToStorageRef } from "../lib/objectStorage";

/* Mirror-on-save (2026-10-13 law): hub assets are kind-typed, so each
   media asset's URL is re-hosted into permanent storage at save time,
   following mirrorProjectScenes' per-field pattern. Script assets carry
   data: text (passes through untouched); "other" is only normalized to
   its storage ref when it points at our own buckets. */
const ASSET_MIRROR_KIND: Record<string, "image" | "video" | "audio" | undefined> = {
  beat: "audio",
  stems: "audio",
  song: "audio",
  sfx: "audio",
  video: "video",
  clip: "video",
  image: "image",
  thumbnail: "image",
};

async function mirrorHubAssets(
  assets: z.infer<typeof HubAssetSchema>[],
  ownerKey: string,
): Promise<z.infer<typeof HubAssetSchema>[]> {
  return Promise.all(
    assets.map(async (asset) => {
      const kind = ASSET_MIRROR_KIND[asset.kind];
      if (!kind) {
        const normalized = normalizeToStorageRef(asset.url);
        return normalized && normalized !== asset.url ? { ...asset, url: normalized } : asset;
      }
      const mirrored = await mirrorExternalMediaUrl(asset.url, { kind, ownerKey });
      return mirrored && mirrored !== asset.url ? { ...asset, url: mirrored } : asset;
    }),
  );
}

const router = Router();

/* The hub project is metadata + URLs only — but a script asset carries its
   text as a data: URL, so allow a roomy (but bounded) body on this router. */
router.use(json({ limit: "5mb" }));

const HubAssetSchema = z.object({
  id: z.string().max(80),
  kind: z.enum(["beat", "stems", "song", "video", "image", "thumbnail", "clip", "script", "sfx", "other"]),
  url: z.string().max(1_000_000),
  label: z.string().max(200),
  detail: z.string().max(300).optional(),
  meta: z.record(z.string(), z.string()).optional(),
  createdAt: z.number(),
});

const SaveHubProjectSchema = z.object({
  /* The server project id (0142): present once the client has saved or
     adopted a project. */
  id: z.string().uuid().optional(),
  /* The client's local project id (0142): the upsert key when no server
     id is known yet — each local project maps to exactly one row. */
  clientRef: z.string().max(80).optional(),
  name: z.string().min(1).max(80),
  type: z.enum(["song", "video", "visual", "movie", "game", "series", "podcast", "release", "grow", "influencer", "ai-influencer", "ai-producer", "clipper", "monetize", "learn", "business"]),
  assets: z.array(HubAssetSchema).max(200),
  concept: z.string().max(2000).default(""),
  templateKey: z.string().max(80).nullable().default(null),
  /* "Made with Bow Down Visuals" credit toggle — project-level, default ON. */
  attribution: z.boolean().default(true),
  /* The Creative Vault character this project is made as (0142, G8).
     Absent = leave whatever the row holds; null = clear it. */
  artistVaultId: z.string().uuid().nullable().optional(),
  updatedAt: z.number(),
});

/* Raw-SQL route (house pattern): the drizzle query builder emits
   rowMode:'array', which the pg-mem test harness cannot drive — raw
   SQL behaves identically on both. */
interface HubProjectRow {
  id: string;
  user_id: string;
  client_ref: string | null;
  name: string;
  type: string;
  assets: unknown;
  concept: string | null;
  template_key: string | null;
  attribution: boolean | null;
  artist_vault_id: string | null;
  updated_at: string | Date | null;
}

const PROJECT_COLUMNS = sql`id, user_id, client_ref, name, type, assets, concept, template_key, attribution, artist_vault_id, updated_at`;

async function projectPayload(row: HubProjectRow) {
  return {
    id: row.id,
    /* Lets an adopting client keep saving into THIS row (0142). */
    clientRef: row.client_ref ?? null,
    name: row.name,
    type: row.type,
    /* Stored asset URLs may be storage refs — re-sign fresh on every read. */
    assets: Array.isArray(row.assets) ? await refreshSupabaseStorageUrlsDeep(row.assets) : [],
    concept: row.concept ?? "",
    templateKey: row.template_key ?? null,
    attribution: row.attribution ?? true,
    artistVaultId: row.artist_vault_id ?? null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
  };
}

async function mostRecentProject(userId: string): Promise<HubProjectRow | undefined> {
  const r = await db.execute(sql`
    SELECT ${PROJECT_COLUMNS} FROM hub_projects
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT 1
  `);
  return r.rows[0] as unknown as HubProjectRow | undefined;
}

async function projectById(userId: string, id: string): Promise<HubProjectRow | undefined> {
  const r = await db.execute(sql`
    SELECT ${PROJECT_COLUMNS} FROM hub_projects
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `);
  return r.rows[0] as unknown as HubProjectRow | undefined;
}

/* Get the user's most recently updated hub project (null when never
   saved). Pre-0142 this was THE project; the row set can now hold many
   (see GET /hub/projects), and this stays the "current" one. */
router.get("/hub/project", requireAuth, async (req, res) => {
  /* S27-49: no error handling here meant a DB failure escaped as an
     unhandled 500. Controlled { error } shape, matching this file's
     other handlers ("Project not found", "Invalid project data"). */
  try {
    const row = await mostRecentProject(req.userId!);
    if (!row) {
      res.json({ project: null });
      return;
    }
    res.json({ project: await projectPayload(row) });
  } catch (err) {
    console.error("[hub-projects] GET /hub/project failed", err);
    res.status(500).json({ error: "Couldn't load your hub project — try again." });
  }
});

/* List the user's hub projects (0142): summaries, newest first. */
router.get("/hub/projects", requireAuth, async (req, res) => {
  try {
    const r = await db.execute(sql`
      SELECT id, name, type, artist_vault_id, updated_at FROM hub_projects
      WHERE user_id = ${req.userId!}
      ORDER BY updated_at DESC
      LIMIT 100
    `);
    res.json({
      projects: (r.rows as unknown as Array<{
        id: string; name: string; type: string;
        artist_vault_id: string | null; updated_at: string | Date | null;
      }>).map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        artistVaultId: row.artist_vault_id ?? null,
        updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
      })),
    });
  } catch (err) {
    console.error("[hub-projects] GET /hub/projects failed", err);
    res.status(500).json({ error: "Couldn't load your hub projects — try again." });
  }
});

/* Get ONE of the user's hub projects by id (wave-2 #3): the full
   payload — the read that lets the projects browser open any row, not
   just the most recent one. Same payload shape as GET /hub/project.
   Owner-scoped like the id-targeted save below: a project that isn't
   the caller's reads as 404, never a leak that the row exists — and a
   malformed id is a 404 too, not a 500. */
router.get("/hub/projects/:id", requireAuth, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  /* Same S27-49 guard as the two reads above: a DB failure is a
     controlled 500, not an unhandled escape. */
  try {
    const row = await projectById(req.userId!, id);
    if (!row) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json({ project: await projectPayload(row) });
  } catch (err) {
    console.error("[hub-projects] GET /hub/projects/:id failed", err);
    res.status(500).json({ error: "Couldn't load your hub project — try again." });
  }
});

/* Save a hub project (0142 upsert rules):
   - id present → update that project (must be the caller's own — 404
     otherwise, no existence leak).
   - clientRef present → update the row that local project maps to,
     or insert its first row. A user whose ONLY row predates client
     refs (client_ref NULL — the old single project) has that row
     claimed by the first clientRef save instead of duplicated.
   - neither (a legacy client) → update the most recent project,
     preserving the pre-0142 single-project behavior. */
router.put("/hub/project", requireAuth, async (req, res) => {
  const parsed = SaveHubProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project data" });
    return;
  }
  const d = parsed.data;
  const storedAssets = await mirrorHubAssets(d.assets, req.userId!);
  const updatedAt = new Date(d.updatedAt).toISOString();

  let targetId: string | null = null;
  if (d.id) {
    const r = await db.execute(sql`
      SELECT id FROM hub_projects WHERE id = ${d.id} AND user_id = ${req.userId!} LIMIT 1
    `);
    if (!r.rows[0]) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    targetId = String((r.rows[0] as Record<string, unknown>)["id"]);
  } else if (d.clientRef) {
    const r = await db.execute(sql`
      SELECT id FROM hub_projects WHERE user_id = ${req.userId!} AND client_ref = ${d.clientRef} LIMIT 1
    `);
    if (r.rows[0]) {
      targetId = String((r.rows[0] as Record<string, unknown>)["id"]);
    } else {
      const unclaimed = await db.execute(sql`
        SELECT id FROM hub_projects WHERE user_id = ${req.userId!} AND client_ref IS NULL LIMIT 2
      `);
      if (unclaimed.rows.length === 1) {
        targetId = String((unclaimed.rows[0] as Record<string, unknown>)["id"]);
      }
    }
  } else {
    const recent = await mostRecentProject(req.userId!);
    targetId = recent?.id ?? null;
  }

  if (targetId) {
    /* artist_vault_id is written only when the caller sent the field —
       two static shapes instead of a dynamic SET (pg-mem-safe). */
    if (d.artistVaultId !== undefined) {
      await db.execute(sql`
        UPDATE hub_projects
        SET name = ${d.name},
            type = ${d.type},
            assets = ${JSON.stringify(storedAssets)}::jsonb,
            concept = ${d.concept},
            template_key = ${d.templateKey},
            attribution = ${d.attribution},
            client_ref = COALESCE(${d.clientRef ?? null}, client_ref),
            artist_vault_id = ${d.artistVaultId},
            updated_at = ${updatedAt}
        WHERE id = ${targetId}
      `);
    } else {
      await db.execute(sql`
        UPDATE hub_projects
        SET name = ${d.name},
            type = ${d.type},
            assets = ${JSON.stringify(storedAssets)}::jsonb,
            concept = ${d.concept},
            template_key = ${d.templateKey},
            attribution = ${d.attribution},
            client_ref = COALESCE(${d.clientRef ?? null}, client_ref),
            updated_at = ${updatedAt}
        WHERE id = ${targetId}
      `);
    }
    res.json({ success: true, id: targetId });
  } else {
    const r = await db.execute(sql`
      INSERT INTO hub_projects (user_id, client_ref, name, type, assets, concept, template_key, attribution, artist_vault_id, updated_at)
      VALUES (${req.userId!}, ${d.clientRef ?? null}, ${d.name}, ${d.type},
              ${JSON.stringify(storedAssets)}::jsonb, ${d.concept}, ${d.templateKey},
              ${d.attribution}, ${d.artistVaultId ?? null}, ${updatedAt})
      RETURNING id
    `);
    res.json({ success: true, id: String((r.rows[0] as Record<string, unknown>)["id"]) });
  }
  // Retention hook: saving a project counts as a creation day.
  void recordCreation(req.userId!, "project");
});

/* Delete hub projects: ?id= removes just that one (must be the
   caller's); without an id, clears all of the caller's synced projects
   (the pre-0142 semantics). */
router.delete("/hub/project", requireAuth, async (req, res) => {
  const id = typeof req.query["id"] === "string" ? req.query["id"] : null;
  if (id) {
    await db.execute(sql`DELETE FROM hub_projects WHERE id = ${id} AND user_id = ${req.userId!}`);
  } else {
    await db.execute(sql`DELETE FROM hub_projects WHERE user_id = ${req.userId!}`);
  }
  res.json({ success: true });
});

export default router;
