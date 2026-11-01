import { desc, eq } from "drizzle-orm";
import {
  db,
  generatedClipsTable,
  projectDraftsTable,
  songsTable,
} from "@workspace/db";
import { getSupabaseAdmin } from "./supabase-admin";

/**
 * account-export.ts — the account data payload, shared.
 *
 * Extracted verbatim from routes/account.ts (GET /api/account/export)
 * so The Vault (Stack-200 UPGRADE #162) packages the exact same data
 * the creator can already download as JSON — profile, projects,
 * drafts, clips, songs — inside its media archive as
 * data/account-export.json. One builder, two surfaces, no drift.
 *
 * WHICH STORE HOLDS WHAT (stack1000 lane R2 correction): profile and
 * projects are written through Supabase (routes/projects.ts writes via
 * PostgREST), but drafts, clips and songs are written through Drizzle
 * into the app database (routes/drafts.ts, lib/library-song.ts — the
 * Render Postgres behind DATABASE_URL, which "has no profiles table",
 * lib/credits.ts). The old builder read ALL five categories from
 * Supabase, so drafts/clips/songs silently came back empty for every
 * member — fetchUserRows swallowed the PostgREST error and returned
 * []. Each category is now read from the store its writers actually
 * write to, and a failed read throws: an export that cannot fetch a
 * category it lists must fail loudly, never hand over a fake-empty
 * section.
 */

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/** Fetch one Supabase table's rows for a user; THROWS on error. */
async function fetchUserRows(
  supabase: SupabaseAdmin,
  table: string,
  userId: string,
): Promise<unknown[]> {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

interface AccountExportPayload {
  exportedAt: string;
  profile: unknown;
  projects: unknown[];
  drafts: unknown[];
  clips: unknown[];
  songs: unknown[];
  [key: string]: unknown;
}

/**
 * Everything the export lists, as data: profile, projects, drafts,
 * generated clips, songs — each read from the store that actually
 * holds it (see the header note). Throws on any failed read.
 */
export async function buildAccountExportPayload(userId: string): Promise<AccountExportPayload> {
  const supabase = getSupabaseAdmin();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;

  const [projects, drafts, clips, songs] = await Promise.all([
    fetchUserRows(supabase, "projects", userId),
    db
      .select()
      .from(projectDraftsTable)
      .where(eq(projectDraftsTable.user_id, userId))
      .orderBy(desc(projectDraftsTable.updated_at)),
    db
      .select()
      .from(generatedClipsTable)
      .where(eq(generatedClipsTable.user_id, userId))
      .orderBy(desc(generatedClipsTable.created_at)),
    db
      .select()
      .from(songsTable)
      .where(eq(songsTable.user_id, userId))
      .orderBy(desc(songsTable.created_at)),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile: profile ?? null,
    projects,
    drafts,
    clips,
    songs,
  };
}
