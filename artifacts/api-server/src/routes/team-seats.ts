import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requireAuth } from "../middlewares/require-auth";
import { db, teamSeatsTable, permissionsForRole, TEAM_SEAT_ROLES } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { sendEmail, emailShell, escapeHtml, isEmailConfigured } from "../lib/email";

const router = Router();

/* ─── Team Seats ─────────────────────────────────────────────────────────
   DistroKid-style roles for collaborators & managers on an account.

   The account holder is the implicit `owner` and manages seats. Invites are
   link-based with an optional email (sent via Resend when RESEND_API_KEY is
   configured; the link is always returned too so the owner can share it
   manually as a fallback). A seat activates when the invited email's
   signed-in account accepts the link (matched on Supabase auth email).

   GET    /api/team-seats           — my owned seats + seats I'm a member of
   POST   /api/team-seats/invite    — invite by email (owner only)
   POST   /api/team-seats/accept    — accept an invite link (invitee, auth'd)
   PATCH  /api/team-seats/:id       — change role (owner only)
   DELETE /api/team-seats/:id       — revoke seat (owner only)

   Handoffs: the Splits Ledger can read GET /api/team-seats and match seats
   by email/name as collaborator options; the `manager` role includes
   canViewMoney (see permissionsForRole) for Money Tracker gating. */

const InviteSchema = z.object({
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().max(80).optional().default(""),
  role: z.enum(["manager", "collaborator", "viewer"]).default("collaborator"),
});

const ChangeRoleSchema = z.object({
  role: z.enum(["manager", "collaborator", "viewer"]),
});

function paramId(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function seatDto(seat: typeof teamSeatsTable.$inferSelect, isOwner: boolean) {
  return {
    id: seat.id,
    email: seat.email,
    displayName: seat.displayName ?? "",
    role: seat.role,
    status: seat.status,
    invitedAt: seat.invitedAt,
    joinedAt: seat.joinedAt,
    permissions: permissionsForRole(seat.role),
    // Owners are never seated as their own members; they hold full rights.
    isAccountOwner: isOwner,
  };
}

/* GET /api/team-seats — my owned seats + seats where I'm a member */
router.get("/team-seats", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const email = (req.userEmail ?? "").toLowerCase();
    const owned = await db
      .select()
      .from(teamSeatsTable)
      .where(eq(teamSeatsTable.ownerId, userId))
      .orderBy(desc(teamSeatsTable.invitedAt));
    const memberOf = email
      ? await db
          .select()
          .from(teamSeatsTable)
          .where(
            and(
              eq(teamSeatsTable.email, email),
              eq(teamSeatsTable.status, "active"),
              isNull(teamSeatsTable.revokedAt),
            ),
          )
          .orderBy(desc(teamSeatsTable.invitedAt))
      : [];
    res.json({
      seats: owned.map((s) => seatDto(s, true)),
      memberOf: memberOf.map((s) => seatDto(s, false)),
      roles: [...TEAM_SEAT_ROLES],
      myRole: "owner" as const,
    });
  } catch (err) {
    req.log.error({ err }, "[team-seats] list failed");
    res.status(500).json({ error: "Could not load team seats." });
  }
});

/* POST /api/team-seats/invite — invite by email (owner only).
   Sends an invite email when an email provider is configured; the invite
   link is always returned for manual sharing as a fallback. */
router.post("/team-seats/invite", requireAuth, async (req, res) => {
  const parsed = InviteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid invite", details: parsed.error.issues });
    return;
  }
  const { email, displayName, role } = parsed.data;
  const userId = req.userId!;
  const normalized = email.toLowerCase();
  if (normalized === (req.userEmail ?? "").toLowerCase()) {
    res.status(400).json({ error: "You already own this account — no need to invite yourself." });
    return;
  }
  try {
    const existing = await db
      .select({ id: teamSeatsTable.id })
      .from(teamSeatsTable)
      .where(and(eq(teamSeatsTable.ownerId, userId), eq(teamSeatsTable.email, normalized)))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "That email is already on your team." });
      return;
    }
    const token = randomBytes(32).toString("hex");
    const [seat] = await db
      .insert(teamSeatsTable)
      .values({
        ownerId: userId,
        email: normalized,
        displayName: displayName || null,
        role,
        status: "invited",
        inviteToken: token,
      })
      .returning();
    const origin = `${req.protocol}://${req.get("host")}`;
    const inviteLink = `${origin}/settings?teamInvite=${token}`;

    /* ── Invite email — best-effort, fail-open. The link is still returned
       so the owner can share it manually if email isn't configured. ───── */
    let emailSent = false;
    if (isEmailConfigured()) {
      const inviterName = displayName || req.userEmail || "Your collaborator";
      const html = emailShell(
        "You've been invited to a team 👑",
        `<p style="margin:0 0 12px;"><strong style="color:#d4af37;">${escapeHtml(inviterName)}</strong> invited you to join their team on Bow Down Visuals as <strong>${escapeHtml(role)}</strong>.</p>
<p style="margin:0 0 16px;color:#ccc;font-size:14px;">Accept the invite to start collaborating — sign in with <strong>${escapeHtml(normalized)}</strong>.</p>
<a href="${escapeHtml(inviteLink)}" style="display:inline-block;background:#d4af37;color:#0a0a0a;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:8px;">Accept invite</a>`
      );
      const result = await sendEmail({
        to: normalized,
        subject: `${inviterName} invited you to their Bow Down Visuals team`,
        html,
      });
      emailSent = result.sent;
    }

    res.status(201).json({
      seat: seatDto(seat, true),
      inviteLink,
      emailSent,
      emailNote: emailSent
        ? "Invite email sent."
        : "No email provider is configured — share the invite link manually.",
    });
  } catch (err) {
    req.log.error({ err }, "[team-seats] invite failed");
    res.status(500).json({ error: "Could not create the invite." });
  }
});

/* POST /api/team-seats/accept — accept an invite link (must be signed in as the invited email). */
router.post("/team-seats/accept", requireAuth, async (req, res) => {
  const token = String(req.body?.token ?? "").trim();
  if (!token) {
    res.status(400).json({ error: "Invite token is required." });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(teamSeatsTable)
      .where(eq(teamSeatsTable.inviteToken, token))
      .limit(1);
    const seat = rows[0];
    if (!seat || seat.status === "revoked") {
      res.status(404).json({ error: "This invite link is invalid or has been revoked." });
      return;
    }
    if (seat.status === "active") {
      res.json({ accepted: true, alreadyActive: true });
      return;
    }
    const signerEmail = (req.userEmail ?? "").toLowerCase();
    if (!signerEmail || signerEmail !== seat.email.toLowerCase()) {
      res.status(403).json({
        error: `This invite was sent to ${seat.email} — sign in with that email to accept it.`,
      });
      return;
    }
    const [updated] = await db
      .update(teamSeatsTable)
      .set({ status: "active", joinedAt: new Date(), inviteToken: null })
      .where(eq(teamSeatsTable.id, seat.id))
      .returning();
    res.json({ accepted: true, seat: seatDto(updated, false) });
  } catch (err) {
    req.log.error({ err }, "[team-seats] accept failed");
    res.status(500).json({ error: "Could not accept the invite." });
  }
});

/* PATCH /api/team-seats/:id — change role (owner only) */
router.patch("/team-seats/:id", requireAuth, async (req, res) => {
  const parsed = ChangeRoleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid role", details: parsed.error.issues });
    return;
  }
  const id = paramId(req.params.id);
  try {
    const [updated] = await db
      .update(teamSeatsTable)
      .set({ role: parsed.data.role })
      .where(and(eq(teamSeatsTable.id, id), eq(teamSeatsTable.ownerId, req.userId!)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Seat not found." });
      return;
    }
    res.json({ seat: seatDto(updated, true) });
  } catch (err) {
    req.log.error({ err }, "[team-seats] role change failed");
    res.status(500).json({ error: "Could not change the role." });
  }
});

/* DELETE /api/team-seats/:id — revoke seat / cancel invite (owner only) */
router.delete("/team-seats/:id", requireAuth, async (req, res) => {
  const id = paramId(req.params.id);
  try {
    const [updated] = await db
      .update(teamSeatsTable)
      .set({ status: "revoked", revokedAt: new Date(), inviteToken: null })
      .where(and(eq(teamSeatsTable.id, id), eq(teamSeatsTable.ownerId, req.userId!)))
      .returning({ id: teamSeatsTable.id });
    if (!updated) {
      res.status(404).json({ error: "Seat not found." });
      return;
    }
    res.json({ revoked: true });
  } catch (err) {
    req.log.error({ err }, "[team-seats] revoke failed");
    res.status(500).json({ error: "Could not revoke the seat." });
  }
});

export default router;
