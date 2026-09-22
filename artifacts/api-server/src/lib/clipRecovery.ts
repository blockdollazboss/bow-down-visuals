/**
 * TEMPORARY CLIP RECOVERY (added 2026-09-22, REMOVE AFTER USE).
 *
 * Recovers video clips whose Replit-GCS signed URLs expired (2026-07-14).
 * The Render backend cannot mint fresh GCS URLs (no Replit sidecar), but the
 * still-running Replit deployment can. This helper:
 *   1. Calls the Replit backend's project API with the user's JWT (forwarded
 *      server-to-server; the token never leaves backend code) to get fresh
 *      7-day GCS URLs for the project's clips.
 *   2. Downloads each video from its fresh URL.
 *   3. Uploads it to Supabase Storage (`generated-clips` bucket).
 *   4. Returns scenes with `demoClipUrl` rewritten to stable
 *      `supabase://generated-clips/...` refs, which the normal read path
 *      re-signs on every load.
 *
 * Fails gracefully (returns scenes unchanged) if the Replit backend is
 * unreachable or cannot mint fresh URLs.
 */
import {
  isLegacyGcsUrl,
  uploadMediaToSupabaseStorage,
} from "./objectStorage";

const REPLIT_API_BASE = "https://bow-down-visuals--blockdollazboss.replit.app";

/** Extract the GCS object path (e.g. "clips/<uuid>.mp4") from a legacy URL. */
function gcsObjectPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    const m = /^\/([a-z0-9-]+)\/(.+)$/.exec(parsed.pathname);
    if (!m) return null;
    return m[2];
  } catch {
    return null;
  }
}

/** True when the URL is a legacy GCS URL whose signature has provably expired. */
function isExpiredGcsUrl(url: string): boolean {
  try {
    const q = new URL(url).searchParams;
    const googExpires = q.get("X-Goog-Expires");
    const googDate = q.get("X-Goog-Date");
    if (googExpires && googDate) {
      const secs = Number(googExpires);
      const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(googDate);
      if (!m || !Number.isFinite(secs)) return false;
      const issued = Date.UTC(
        Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        Number(m[4]), Number(m[5]), Number(m[6]),
      );
      return issued + secs * 1000 < Date.now();
    }
    const expiresParam = q.get("Expires");
    if (expiresParam) {
      const epoch = Number(expiresParam);
      if (!Number.isFinite(epoch)) return false;
      return epoch * 1000 < Date.now();
    }
    return false;
  } catch {
    return false;
  }
}

type SceneLike = Record<string, unknown>;

/**
 * Attempt to recover expired clip URLs in `scenes` via the Replit backend.
 * Returns a new scenes array with recovered `demoClipUrl` values rewritten
 * to Supabase storage refs. Scenes that cannot be recovered are unchanged.
 */
export async function recoverExpiredClipsViaReplit(
  accessToken: string,
  projectId: string,
  scenes: SceneLike[],
): Promise<SceneLike[]> {
  /* Scenes that need a clip: no demoClipUrl, or an expired legacy GCS URL.
     (The UI shows "No clip" when demoClipUrl is missing — those still need
     recovery via Replit scene-ID matching.) */
  const needsRecovery = scenes.filter(
    (s) =>
      typeof s["demoClipUrl"] !== "string" ||
      !s["demoClipUrl"] ||
      (isLegacyGcsUrl(s["demoClipUrl"] as string) &&
        isExpiredGcsUrl(s["demoClipUrl"] as string)),
  );
  if (needsRecovery.length === 0) return scenes;

  /* ── 1. Ask the Replit backend for fresh signed GCS URLs ── */
  let replitScenes: SceneLike[];
  try {
    const res = await fetch(
      `${REPLIT_API_BASE}/api/projects/${encodeURIComponent(projectId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) return scenes;
    const json = (await res.json()) as {
      project?: { output_data?: { scenes?: SceneLike[] } };
    };
    replitScenes = json.project?.output_data?.scenes ?? [];
  } catch {
    return scenes;
  }

  /* Index Replit scenes by GCS object path AND by scene ID for matching. */
  const freshByObjectPath = new Map<string, string>();
  const freshBySceneId = new Map<string, string>();
  for (const rs of replitScenes) {
    const url = rs["demoClipUrl"];
    if (typeof url !== "string" || !isLegacyGcsUrl(url)) continue;
    const objPath = gcsObjectPath(url);
    if (objPath) freshByObjectPath.set(objPath, url);
    const sid = rs["id"];
    if (typeof sid === "string" && sid) freshBySceneId.set(sid, url);
  }
  if (freshByObjectPath.size === 0 && freshBySceneId.size === 0) return scenes;

  /* ── 2-4. Download each recoverable clip, upload to Supabase, rewrite ref ── */
  const updated = await Promise.all(
    scenes.map(async (scene) => {
      const oldUrl = scene["demoClipUrl"];
      const hasExpiredUrl =
        typeof oldUrl === "string" &&
        isLegacyGcsUrl(oldUrl) &&
        isExpiredGcsUrl(oldUrl);
      const needsClip =
        typeof oldUrl !== "string" || !oldUrl || hasExpiredUrl;
      if (!needsClip) return scene;

      /* Try object-path match first (for scenes with expired URLs),
         then scene-ID match (for scenes with no clip at all). */
      let freshUrl: string | undefined;
      if (hasExpiredUrl) {
        const objPath = gcsObjectPath(oldUrl as string);
        freshUrl = objPath ? freshByObjectPath.get(objPath) : undefined;
      }
      if (!freshUrl) {
        const sid = scene["id"];
        if (typeof sid === "string" && sid) {
          freshUrl = freshBySceneId.get(sid);
        }
      }
      if (!freshUrl) return scene;

      try {
        const dlRes = await fetch(freshUrl, {
          signal: AbortSignal.timeout(120_000),
        });
        if (!dlRes.ok) return scene;
        const buf = Buffer.from(await dlRes.arrayBuffer());
        if (buf.length === 0 || buf.length > 200 * 1024 * 1024) return scene;

        const objPath = gcsObjectPath(freshUrl) ?? `clip-${Date.now()}.mp4`;
        const objectName = `recovered/${projectId}/${objPath}`;
        const storageRef = await uploadMediaToSupabaseStorage(
          objectName,
          buf,
          "video/mp4",
        );
        return { ...scene, demoClipUrl: storageRef };
      } catch {
        return scene;
      }
    }),
  );

  return updated;
}
