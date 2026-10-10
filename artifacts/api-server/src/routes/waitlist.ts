import { Router } from "express";
import { randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicApiLimiter } from "../lib/rate-limit";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { logger } from "../lib/logger";

const router = Router();



/* ── Waitlist invite mechanics (virality wave) ───────────────────────────
   Every waitlisted user gets a personal invite code. Each successful invite
   (a friend who joins via their link) moves them up JUMP_PER_INVITE spots
   in the queue and counts toward milestones:
     1 invite  → Jumpstarter (+100 spots)
     3 invites → Early access unlocked
    10 invites → 1,500 bonus Visual Bucs on launch day
    25 invites → Founder status (5,000 bonus Visual Bucs)
   Attribution is idempotent: waitlist_invites.invitee_email is UNIQUE, so a
   retry or a later signup for the same email can never double-credit. */
const JUMP_PER_INVITE = 100;

interface Milestone {
  invites: number;
  title: string;
  reward: string;
}
const MILESTONES: Milestone[] = [
  { invites: 1, title: "Jumpstarter", reward: "+100 queue spots" },
  { invites: 3, title: "Early Access", reward: "Skip the line at launch" },
  { invites: 10, title: "Launch Bonus", reward: "1,500 bonus Visual Bucs on launch day" },
  { invites: 25, title: "Founder", reward: "5,000 bonus Visual Bucs + Founder status" },
];

function milestoneProgress(invitesCount: number) {
  return MILESTONES.map((m) => ({
    ...m,
    unlocked: invitesCount >= m.invites,
    invitesAway: Math.max(0, m.invites - invitesCount),
  }));
}

/* Boot-time self-heal: create invite columns/table if they don't exist
   (idempotent). Mirrors the referrals route's ensureReferralTables. */
let tablesEnsured = false;
async function ensureWaitlistInviteTables(): Promise<void> {
  if (tablesEnsured) return;
  tablesEnsured = true;
  await db.execute(sql.raw(`
    ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invite_code TEXT;
    ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invited_by_email TEXT;
    ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invites_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS jump_spots INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS early_access_unlocked BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS launch_bonus_bucs INTEGER NOT NULL DEFAULT 0;
    CREATE UNIQUE INDEX IF NOT EXISTS waitlist_invite_code_uidx ON waitlist (invite_code);
    CREATE TABLE IF NOT EXISTS waitlist_invites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inviter_email TEXT NOT NULL,
      invitee_email TEXT NOT NULL UNIQUE,
      invite_code TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS waitlist_invites_inviter_idx ON waitlist_invites (inviter_email);
  `));
}

function generateCode(): string {
  // 8-char alphanumeric, easy to share (no confusing 0/O, 1/I/l)
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

interface WaitlistRow {
  email: string;
  name: string;
  created_at: string;
  invite_code: string | null;
  invites_count: number;
  jump_spots: number;
  early_access_unlocked: boolean;
  launch_bonus_bucs: number;
}

/* Position = chronological rank minus earned queue jumps, floored at 1. */
async function computePosition(
  admin: SupabaseClient,
  row: WaitlistRow
): Promise<{ position: number; total: number; rawRank: number }> {
  const { count: earlier } = await admin
    .from("waitlist")
    .select("id", { count: "exact", head: true })
    .lt("created_at", row.created_at);
  const { count: total } = await admin
    .from("waitlist")
    .select("id", { count: "exact", head: true });
  const rawRank = (earlier ?? 0) + 1;
  const position = Math.max(1, rawRank - (row.jump_spots ?? 0));
  return { position, total: total ?? rawRank, rawRank };
}

/* Recompute an inviter's counters from the attribution table so retries
   and races can never drift the numbers. */
async function refreshInviterStats(admin: SupabaseClient, inviterEmail: string): Promise<void> {
  const { count } = await admin
    .from("waitlist_invites")
    .select("id", { count: "exact", head: true })
    .eq("inviter_email", inviterEmail);
  const invites = count ?? 0;
  await admin
    .from("waitlist")
    .update({
      invites_count: invites,
      jump_spots: invites * JUMP_PER_INVITE,
      early_access_unlocked: invites >= 3,
      launch_bonus_bucs: invites >= 25 ? 5000 : invites >= 10 ? 1500 : 0,
    })
    .eq("email", inviterEmail);
}

/* ── POST /api/waitlist — join (optionally via an invite code) ─────────── */
router.post("/waitlist", publicApiLimiter, async (req, res) => {
  const {
    name,
    email,
    creatorName,
    artistType,
    wantToCreate,
    socialHandle,
    message,
    inviteCode,
  } = req.body as Record<string, string>;

  if (!name || !email) {
    res.status(400).json({ error: "Name and email are required." });
    return;
  }
  if (!email.includes("@")) {
    res.status(400).json({ error: "Please enter a valid email address." });
    return;
  }

  // Prepend creator/artist name to message so it's visible in Supabase without a schema change
  const creatorNote = creatorName?.trim() ? `Creator/Artist Name: ${creatorName.trim()}\n\n` : "";
  const fullMessage = `${creatorNote}${message?.trim() ?? ""}`.trim() || null;
  const normalizedEmail = email.trim().toLowerCase();

  try {
    await ensureWaitlistInviteTables();
    const supabase = getSupabaseAdmin();

    // Duplicate? (email is unique on the waitlist)
    const { data: existing } = await supabase
      .from("waitlist")
      .select("email")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (existing) {
      res.status(409).json({ error: "duplicate_email", message: "This email is already on the waitlist." });
      return;
    }

    // Resolve the inviter (if the user arrived via an invite link)
    let inviterEmail: string | null = null;
    const inviterCode = inviteCode?.trim().toUpperCase();
    if (inviterCode && /^[A-Z0-9]{4,16}$/.test(inviterCode)) {
      const { data: inviter } = await supabase
        .from("waitlist")
        .select("email")
        .eq("invite_code", inviterCode)
        .maybeSingle();
      if (inviter && inviter.email.toLowerCase() !== normalizedEmail) {
        inviterEmail = inviter.email;
      }
    }

    // Generate a personal invite code for the new entrant (retry on collision)
    let myCode: string | null = null;
    for (let attempt = 0; attempt < 5 && !myCode; attempt++) {
      const candidate = generateCode();
      const { data: clash } = await supabase
        .from("waitlist")
        .select("id")
        .eq("invite_code", candidate)
        .maybeSingle();
      if (!clash) myCode = candidate;
    }
    if (!myCode) {
      res.status(500).json({ error: "Could not generate an invite code. Please try again." });
      return;
    }

    const { data: inserted, error } = await supabase
      .from("waitlist")
      .insert({
        name: name.trim(),
        email: normalizedEmail,
        artist_type: artistType ?? null,
        want_to_create: wantToCreate ?? null,
        social_handle: socialHandle?.trim() ?? null,
        message: fullMessage,
        invite_code: myCode,
        invited_by_email: inviterEmail,
      })
      .select("created_at, invite_code, invites_count, jump_spots, early_access_unlocked, launch_bonus_bucs")
      .single();

    if (error) {
      if (error.code === "23505") {
        res.status(409).json({ error: "duplicate_email", message: "This email is already on the waitlist." });
        return;
      }
      throw error;
    }

    // Attribute the invite (idempotent — UNIQUE on invitee_email)
    let inviterCredited = false;
    if (inviterEmail) {
      const { error: inviteError } = await supabase.from("waitlist_invites").upsert(
        { inviter_email: inviterEmail, invitee_email: normalizedEmail, invite_code: inviterCode! },
        { onConflict: "invitee_email", ignoreDuplicates: true }
      );
      if (!inviteError) {
        inviterCredited = true;
        await refreshInviterStats(supabase, inviterEmail);
      } else {
        logger.warn({ err: inviteError }, "waitlist invite attribution failed");
      }
    }

    const row: WaitlistRow = {
      email: normalizedEmail,
      name: name.trim(),
      created_at: inserted.created_at,
      invite_code: inserted.invite_code,
      invites_count: 0,
      jump_spots: 0,
      early_access_unlocked: false,
      launch_bonus_bucs: 0,
    };
    const { position, total } = await computePosition(supabase, row);

    res.json({
      success: true,
      inviteCode: myCode,
      position,
      total,
      invitesCount: 0,
      inviterCredited,
      milestones: milestoneProgress(0),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to join waitlist";
    res.status(500).json({ error: message });
  }
});

/* ── GET /api/waitlist/status?email= — live position for a waitlisted email */
router.get("/waitlist/status", publicApiLimiter, async (req, res) => {
  const email = String(req.query["email"] ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "A valid email is required." });
    return;
  }
  try {
    await ensureWaitlistInviteTables();
    const supabase = getSupabaseAdmin();
    const { data: row } = await supabase
      .from("waitlist")
      .select("email, name, created_at, invites_count, jump_spots, early_access_unlocked, launch_bonus_bucs")
      .eq("email", email)
      .maybeSingle();
    if (!row) {
      res.status(404).json({ error: "not_found", message: "This email is not on the waitlist yet." });
      return;
    }
    const { position, total } = await computePosition(supabase, row as WaitlistRow);
    const invitesCount = row.invites_count ?? 0;
    // Privacy: never expose the invite code on this unauthenticated endpoint.
    // The code is returned only at signup (POST /api/waitlist) and on the
    // invite page itself. Position/milestones are safe to share.
    res.json({
      position,
      total,
      invitesCount,
      jumpSpots: row.jump_spots ?? 0,
      earlyAccessUnlocked: row.early_access_unlocked ?? false,
      launchBonusBucs: row.launch_bonus_bucs ?? 0,
      milestones: milestoneProgress(invitesCount),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load waitlist status";
    res.status(500).json({ error: message });
  }
});

/* ── GET /api/waitlist/invite/:code — public position page data (no PII) ─ */
export async function getWaitlistInvitePublic(code: string) {
  await ensureWaitlistInviteTables();
  const supabase = getSupabaseAdmin();
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(normalized)) return null;
  const { data: row } = await supabase
    .from("waitlist")
    .select("created_at, invites_count, jump_spots")
    .eq("invite_code", normalized)
    .maybeSingle();
  if (!row) return null;
  const { position, total } = await computePosition(supabase, row as WaitlistRow);
  const invitesCount = row.invites_count ?? 0;
  const next = MILESTONES.find((m) => invitesCount < m.invites) ?? null;
  return {
    code: normalized,
    position,
    total,
    invitesCount,
    milestones: milestoneProgress(invitesCount),
    nextMilestone: next,
  };
}

router.get("/waitlist/invite/:code", publicApiLimiter, async (req, res) => {
  try {
    const data = await getWaitlistInvitePublic(String(req.params["code"] ?? ""));
    if (!data) {
      res.status(404).json({ error: "not_found", message: "Invite code not found." });
      return;
    }
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load invite";
    res.status(500).json({ error: message });
  }
});

export default router;
