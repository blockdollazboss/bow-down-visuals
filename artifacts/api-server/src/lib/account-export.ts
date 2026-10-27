import { getSupabaseAdmin } from "./supabase-admin";

/**
 * account-export.ts — the account data payload, shared.
 *
 * Extracted verbatim from routes/account.ts (GET /api/account/export)
 * so The Vault (Stack-200 UPGRADE #162) packages the exact same data
 * the creator can already download as JSON — profile, projects,
 * drafts, clips, songs — inside its media archive as
 * data/account-export.json. One builder, two surfaces, no drift.
 */

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/** Fetch one table's rows for a user; returns [] when the table is missing or errors. */
export async function fetchUserRows(
  supabase: SupabaseAdmin,
  table: string,
  userId: string,
): Promise<unknown[]> {
  try {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}

export interface AccountExportPayload {
  exportedAt: string;
  profile: unknown;
  projects: unknown[];
  drafts: unknown[];
  clips: unknown[];
  songs: unknown[];
  [key: string]: unknown;
}

/**
 * Everything the account owns, as data: profile, projects, drafts,
 * generated clips, songs. Service-role read, filtered to the user.
 */
export async function buildAccountExportPayload(userId: string): Promise<AccountExportPayload> {
  const supabase = getSupabaseAdmin();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  const [projects, drafts, clips, songs] = await Promise.all([
    fetchUserRows(supabase, "projects", userId),
    fetchUserRows(supabase, "project_drafts", userId),
    fetchUserRows(supabase, "generated_clips", userId),
    fetchUserRows(supabase, "songs", userId),
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
