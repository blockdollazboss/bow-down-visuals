/* ─── Global Drop (#165) — UPGRADE of Translate & Dub ──────────────────
   Translate & Dub is per-VIDEO editor work: upload a video, pick
   languages, get dubs. The delta is the one-tap RELEASE-level action:
   the release's five launch languages packaged as first-class
   VERSIONS on the release itself —

   - ASSEMBLE (one tap): a package with one version per launch
     language (Spanish, Portuguese, French, German, Japanese — all
     five are dub-supported on the existing rail), each carrying the
     release's own title as its source and a door into Translate &
     Dub for the actual dub/caption work.
   - REVIEW (per version, creator's hand): the creator enters the
     translated title and the version's destination URL and approves
     the version. Nothing is approved by default; nothing publishes
     unreviewed.
   - PUBLISH: approved versions WITH a URL are written into the
     release's smartlink language routing — the release's own
     distribution surface fans visitors out by language. Existing
     destinations for other languages are never clobbered.

   Honesty rules: no translation is invented here (the translated
   title is the creator's, from their work on the dub rail); URLs are
   http(s) only, the same rule the smartlink rail itself validates;
   if the routing column is not live yet (its migration was held),
   publish answers an honest 409 — the package and its reviews are
   safe, only the routing write waits. */

import { sql, eq, and } from "drizzle-orm";
import { db, globalDropPackagesTable } from "@workspace/db";
import { isUndefinedColumn } from "./pg-errors";

export const GLOBAL_DROP_LANGUAGES = [
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
] as const;

export type GlobalDropLanguageCode = (typeof GLOBAL_DROP_LANGUAGES)[number]["code"];

export interface GlobalDropVersion {
  language: GlobalDropLanguageCode;
  label: string;
  sourceTitle: string;
  translatedTitle: string | null;
  url: string | null;
  /** 'draft' | 'approved' — the creator's review state. */
  status: "draft" | "approved";
  /** The existing Translate & Dub surface, where the dub + captions
   *  for this version are produced. */
  translateLink: string;
}

export type GlobalDropVersions = Record<GlobalDropLanguageCode, GlobalDropVersion>;

export interface GlobalDropRelease {
  id: string;
  userId: string;
  title: string;
  artistName: string;
}

/** Pure assembly — five draft versions from the release's own title. */
export function assemblePackage(release: GlobalDropRelease): GlobalDropVersions {
  const versions = {} as GlobalDropVersions;
  for (const lang of GLOBAL_DROP_LANGUAGES) {
    versions[lang.code] = {
      language: lang.code,
      label: lang.label,
      sourceTitle: release.title,
      translatedTitle: null,
      url: null,
      status: "draft",
      translateLink: "/translate",
    };
  }
  return versions;
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** The publish set: approved AND carrying a valid URL. Title-only
 *  approvals are real versions, but there is nowhere to route to —
 *  publish says exactly which those are instead of dropping them
 *  silently. */
export function publishableVersions(versions: GlobalDropVersions): {
  routable: Array<{ code: GlobalDropLanguageCode; url: string }>;
  titleOnly: GlobalDropLanguageCode[];
} {
  const routable: Array<{ code: GlobalDropLanguageCode; url: string }> = [];
  const titleOnly: GlobalDropLanguageCode[] = [];
  for (const lang of GLOBAL_DROP_LANGUAGES) {
    const v = versions[lang.code];
    if (!v || v.status !== "approved") continue;
    if (v.url && isHttpUrl(v.url)) routable.push({ code: lang.code, url: v.url });
    else titleOnly.push(lang.code);
  }
  return { routable, titleOnly };
}

/** Merge routable versions into the release's existing language
 *  destinations. Other languages' destinations are never touched;
 *  a Global Drop code overwrites only its own key. */
export function mergeLanguageDestinations(
  existing: Record<string, string>,
  routable: Array<{ code: GlobalDropLanguageCode; url: string }>,
): Record<string, string> {
  const merged = { ...existing };
  for (const r of routable) merged[r.code] = r.url;
  return merged;
}

/* ── Store ──────────────────────────────────────────────────────────── */

export interface GlobalDropStore {
  getByRelease(releaseId: string): Promise<Record<string, unknown> | null>;
  upsertPackage(row: { userId: string; releaseId: string; versions: GlobalDropVersions }): Promise<{ id: string }>;
  saveVersions(id: string, userId: string, versions: GlobalDropVersions): Promise<boolean>;
  setStatus(id: string, userId: string, status: "active"): Promise<boolean>;
  readLanguageDestinations(releaseId: string): Promise<Record<string, string>>;
  writeLanguageDestinations(releaseId: string, destinations: Record<string, string>): Promise<void>;
}

export const drizzleGlobalDropStore: GlobalDropStore = {
  async getByRelease(releaseId) {
    const rows = await db
      .select()
      .from(globalDropPackagesTable)
      .where(eq(globalDropPackagesTable.releaseId, releaseId))
      .limit(1);
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  },
  async upsertPackage(row) {
    const inserted = await db
      .insert(globalDropPackagesTable)
      .values({ userId: row.userId, releaseId: row.releaseId, versions: row.versions })
      .onConflictDoUpdate({
        target: globalDropPackagesTable.releaseId,
        set: { versions: row.versions, updatedAt: new Date() },
      })
      .returning({ id: globalDropPackagesTable.id });
    return { id: inserted[0]!.id };
  },
  async saveVersions(id, userId, versions) {
    const updated = await db
      .update(globalDropPackagesTable)
      .set({ versions, updatedAt: new Date() })
      .where(and(eq(globalDropPackagesTable.id, id), eq(globalDropPackagesTable.userId, userId)))
      .returning({ id: globalDropPackagesTable.id });
    return updated.length > 0;
  },
  async setStatus(id, userId, status) {
    const updated = await db
      .update(globalDropPackagesTable)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(globalDropPackagesTable.id, id), eq(globalDropPackagesTable.userId, userId)))
      .returning({ id: globalDropPackagesTable.id });
    return updated.length > 0;
  },
  async readLanguageDestinations(releaseId) {
    try {
      const rows = await db.execute(sql`
        SELECT smartlink_language_destinations AS destinations
        FROM distribution_releases WHERE id = ${releaseId} LIMIT 1`);
      const r = (rows.rows as Array<Record<string, unknown>>)[0];
      const d = r?.["destinations"];
      return d && typeof d === "object" ? (d as Record<string, string>) : {};
    } catch (err) {
      /* The routing column's migration was held — until it lands the
         honest read is "no destinations", never a crash. */
      if (isUndefinedColumn(err)) return {};
      throw err;
    }
  },
  async writeLanguageDestinations(releaseId, destinations) {
    await db.execute(sql`
      UPDATE distribution_releases
      SET smartlink_language_destinations = ${JSON.stringify(destinations)}::jsonb,
          updated_at = now()
      WHERE id = ${releaseId}`);
  },
};
