/**
 * account.ts — the signed-in user's own data controls.
 *
 *  GET    /api/account/export   { exportedAt, profile, projects, drafts, clips, songs }
 *  DELETE /api/account          body { confirm: "DELETE" } — deletes the auth
 *                               user and their profile row. Admin accounts
 *                               can never be deleted here (403).
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const router = Router();

function adminEmails(): string[] {
  return (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Fetch one table's rows for a user; returns [] when the table is missing or errors. */
async function fetchUserRows(
  supabase: ReturnType<typeof getSupabaseAdmin>,
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

/**
 * GET /api/account/export
 * Download everything the account owns: profile, projects, drafts,
 * generated clips, songs. Service-role read, filtered to the requester.
 */
router.get("/api/account/export", requireAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getSupabaseAdmin();
    const userId = req.userId!;

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

    req.log.info({ userId }, "account: data export generated");
    res.json({
      exportedAt: new Date().toISOString(),
      profile: profile ?? null,
      projects,
      drafts,
      clips,
      songs,
    });
  } catch (err) {
    req.log.error({ err }, "account: export failed");
    res.status(500).json({ error: "Could not export your data. Please try again." });
  }
});

const DeleteAccountSchema = z.object({
  confirm: z.literal("DELETE"),
});

/**
 * DELETE /api/account
 * Permanently deletes the requesting user's auth account and profile row.
 * Body must be exactly { confirm: "DELETE" }. Admin accounts are protected.
 */
router.delete("/api/account", requireAuth, async (req: Request, res: Response) => {
  const parsed = DeleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Confirmation required: body must be { confirm: "DELETE" }.' });
    return;
  }
  const requesterEmail = (req.userEmail ?? "").toLowerCase();
  if (requesterEmail && adminEmails().includes(requesterEmail)) {
    res.status(403).json({ error: "Admin accounts cannot be deleted here." });
    return;
  }
  try {
    const supabase = getSupabaseAdmin();
    const userId = req.userId!;

    // Delete the profile row first, then the auth user.
    const { error: profileErr } = await supabase.from("profiles").delete().eq("id", userId);
    if (profileErr) throw profileErr;

    const { error: authErr } = await supabase.auth.admin.deleteUser(userId);
    if (authErr) throw authErr;

    req.log.info({ userId, email: req.userEmail }, "account: user deleted their account");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "account: delete failed");
    res.status(500).json({ error: "Could not delete your account. Please try again." });
  }
});

export default router;
