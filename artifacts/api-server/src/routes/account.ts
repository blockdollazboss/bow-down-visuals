/**
 * account.ts — the signed-in user's own data controls.
 *
 *  GET    /api/account/export   { exportedAt, profile, projects, drafts, clips, songs }
 *  DELETE /api/account          body { confirm: "DELETE" } — the full,
 *                               honest exit (lib/account-exit.ts):
 *                               refused while someone else's money is in
 *                               flight with this member (409, plain
 *                               sentences naming what must settle), the
 *                               member's own plan is cancelled at Stripe
 *                               first, API keys + overlay token are
 *                               killed, their content and public creator
 *                               presence are erased from the app
 *                               database, and only then are the profile
 *                               row and the auth user deleted. Admin
 *                               accounts can never be deleted here (403).
 *                               Transaction records (orders, sales,
 *                               payouts, ledgers) are kept — the
 *                               Settings copy says so.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { buildAccountExportPayload } from "../lib/account-export";
import {
  cancelOwnCreatorPlan,
  eraseAccountData,
  findAccountExitBlockers,
  revokeAccountSessions,
} from "../lib/account-exit";

const router = Router();

function adminEmails(): string[] {
  return (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * GET /api/account/export
 * Download everything the export lists: profile, projects, drafts,
 * generated clips, songs. Each category is read from the store that
 * actually holds it (lib/account-export.ts) — a category that cannot
 * be read fails the export instead of arriving silently empty.
 * Payload built by lib/account-export.ts — shared with The Vault (#162).
 */
router.get("/account/export", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const payload = await buildAccountExportPayload(userId);
    req.log.info({ userId }, "account: data export generated");
    res.json(payload);
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
 * Permanently deletes the requesting user's account — all of it, in
 * the order lib/account-exit.ts documents. Body must be exactly
 * { confirm: "DELETE" }. Admin accounts are protected. Every step is
 * idempotent, so a member whose deletion failed halfway can simply
 * confirm again and the exit completes.
 */
router.delete("/account", requireAuth, async (req: Request, res: Response) => {
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
  const userId = req.userId!;

  /* 1 — Someone else's money in flight refuses the exit, in plain
   * sentences the member can act on. Nothing is deleted. */
  let blockers: string[];
  try {
    blockers = await findAccountExitBlockers(userId);
  } catch (err) {
    req.log.error({ err, userId }, "account: exit blocker check failed");
    res.status(500).json({ error: "Could not delete your account. Please try again." });
    return;
  }
  if (blockers.length > 0) {
    res.status(409).json({ error: blockers.join(" "), blockers });
    return;
  }

  /* 2 — The member's own plan is cancelled at Stripe before anything
   * is deleted. If Stripe refuses, the exit stops here: deleting the
   * account of a member whose plan still bills would strand them with
   * charges and no way to cancel. */
  try {
    await cancelOwnCreatorPlan(userId);
  } catch (err) {
    req.log.error({ err, userId }, "account: plan cancellation failed; deletion aborted");
    res.status(502).json({
      error: "Your plan could not be cancelled just now, so your account was not deleted. Please try again.",
    });
    return;
  }

  try {
    /* 3 — Credentials that resolve without the auth user die now. */
    await revokeAccountSessions(userId);

    /* 4 — The member's content and public presence leave the app
     * database (transaction records stay — see the header). */
    await eraseAccountData(userId);

    /* 5 — The Supabase profile row, then the auth user. Deleting the
     * auth user cascades the Supabase-side tables and kills every
     * bearer token: requireAuth validates tokens against Supabase
     * Auth itself, and a deleted user can never pass. */
    const supabase = getSupabaseAdmin();
    const { error: profileErr } = await supabase.from("profiles").delete().eq("id", userId);
    if (profileErr) throw profileErr;

    const { error: authErr } = await supabase.auth.admin.deleteUser(userId);
    if (authErr) throw authErr;

    req.log.info({ userId, email: req.userEmail }, "account: user deleted their account");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, userId }, "account: delete failed");
    res.status(500).json({ error: "Could not delete your account. Please try again." });
  }
});

export default router;
