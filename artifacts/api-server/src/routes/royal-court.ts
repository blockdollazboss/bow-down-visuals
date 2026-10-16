import { Router } from "express";
import { z } from "zod";
import { db, creatorProfilesTable, followsTable, royalCourtTable, ROYAL_COURT_MAX_MEMBERS } from "@workspace/db";
import { eq, asc, desc, inArray, ilike, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { refreshSupabaseStorageUrlsDeep } from "../lib/objectStorage";

/* ── The Royal Court ──────────────────────────────────────────────────────
   A creator crowns up to 8 other creators into their Court, in rank
   order (migration 0131, table royal_court). The Court renders on the
   creator's public profile page; the owner builds it from profile
   settings by picking from creators they follow or by search.
   Routes:
     GET /api/creator-profiles/:slug/court            public, rank-ordered
     GET /api/creator-profiles/me/court               owner view (auth)
     PUT /api/creator-profiles/me/court               replace-all save (auth)
     GET /api/creator-profiles/me/court-candidates    picker: following + search (auth)
   DTOs are explicit camelCase, hand-built below — never a raw row spread.
   A crowned member whose profile is deleted can't exist (FK cascade);
   one who went private is filtered at read on the PUBLIC view only, so
   the public Court never renders a profile visitors can't open, while
   the owner still sees the seat and can re-crown or remove them. */

const router = Router();

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── DTOs ───────────────────────────────────────────────────────────────── */

export interface CourtMemberDto {
  position: number;
  profileId: string;
  slug: string;
  displayName: string;
  avatarUrl: string | null;
  profileUrl: string;
  isPublic: boolean;
}

export interface CourtCandidateDto {
  profileId: string;
  slug: string;
  displayName: string;
  avatarUrl: string | null;
  profileUrl: string;
  isPublic: boolean;
  isFollowing: boolean;
}

type ProfileRow = typeof creatorProfilesTable.$inferSelect;
type CourtRow = typeof royalCourtTable.$inferSelect;

function toCourtMemberDto(entry: CourtRow, profile: ProfileRow): CourtMemberDto {
  return {
    position: entry.position,
    profileId: profile.id,
    slug: profile.slug,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl ?? null,
    profileUrl: `/artist/${profile.slug}`,
    isPublic: profile.isPublic,
  };
}

function toCandidateDto(profile: ProfileRow, isFollowing: boolean): CourtCandidateDto {
  return {
    profileId: profile.id,
    slug: profile.slug,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl ?? null,
    profileUrl: `/artist/${profile.slug}`,
    isPublic: profile.isPublic,
    isFollowing,
  };
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

async function getOwnProfile(userId: string): Promise<ProfileRow | null> {
  const [row] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return row ?? null;
}

/** Rank-ordered Court for a profile. `publicOnly` drops members whose
    profile went private (and any row whose profile vanished, which the
    FK cascade should already prevent). Stored positions are preserved —
    a filtered member leaves an honest gap, never a silent re-rank. */
async function loadCourt(ownerProfileId: string, publicOnly: boolean): Promise<CourtMemberDto[]> {
  const entries = await db
    .select()
    .from(royalCourtTable)
    .where(eq(royalCourtTable.ownerProfileId, ownerProfileId))
    .orderBy(asc(royalCourtTable.position));
  if (entries.length === 0) return [];
  const memberIds = entries.map((e) => e.memberProfileId);
  const profiles = await db
    .select()
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.id, memberIds));
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const out: CourtMemberDto[] = [];
  for (const entry of entries) {
    const profile = byId.get(entry.memberProfileId);
    if (!profile) continue;
    if (publicOnly && !profile.isPublic) continue;
    out.push(toCourtMemberDto(entry, profile));
  }
  return out;
}

/* ── GET /api/creator-profiles/me/court — the owner's own Court (auth).
   Registered BEFORE /:slug/court: below it, "me" would be captured as a
   slug and the owner would read a stranger's (empty) Court as their own. */
router.get("/creator-profiles/me/court", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const own = await getOwnProfile(req.userId!);
    if (!own) {
      res.status(404).json({ error: "NO_PROFILE", message: "Create your creator profile first — then you can set your Front Row." });
      return;
    }
    const court = await loadCourt(own.id, false);
    res.json(await refreshSupabaseStorageUrlsDeep({ court, maxMembers: ROYAL_COURT_MAX_MEMBERS }));
  } catch (err) {
    req.log.error({ err }, "royal-court GET (me) error");
    res.status(500).json({ error: "Couldn't load your Front Row. Try again." });
  }
});

/* ── GET /api/creator-profiles/me/court-candidates — picker source (auth).
   No ?q: the creators the caller follows (their people first).
   With ?q: public creators matching name or slug, most-followed first.
   The caller's own profile is always excluded — no self-crowning. */
router.get("/creator-profiles/me/court-candidates", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const own = await getOwnProfile(req.userId!);
    if (!own) {
      res.status(404).json({ error: "NO_PROFILE", message: "Create your creator profile first — then you can set your Front Row." });
      return;
    }
    const q = String(req.query["q"] ?? "").trim().slice(0, 80);

    const followRows = await db
      .select({ profileId: followsTable.profileId })
      .from(followsTable)
      .where(eq(followsTable.followerUserId, req.userId!));
    const followingIds = new Set(followRows.map((r) => r.profileId));

    let profiles: ProfileRow[];
    if (q) {
      const like = `%${q.replace(/[%_]/g, "")}%`;
      profiles = await db
        .select()
        .from(creatorProfilesTable)
        .where(or(ilike(creatorProfilesTable.displayName, like), ilike(creatorProfilesTable.slug, like)))
        .orderBy(desc(creatorProfilesTable.followerCount))
        .limit(40);
      /* Search only surfaces profiles visitors can actually open. */
      profiles = profiles.filter((p) => p.isPublic);
    } else {
      if (followingIds.size === 0) {
        res.json({ candidates: [] });
        return;
      }
      profiles = await db
        .select()
        .from(creatorProfilesTable)
        .where(inArray(creatorProfilesTable.id, [...followingIds]));
      /* The people you follow, biggest first — same order every visit. */
      profiles = [...profiles].sort((a, b) => b.followerCount - a.followerCount);
    }

    const candidates = profiles
      .filter((p) => p.id !== own.id)
      .slice(0, 20)
      .map((p) => toCandidateDto(p, followingIds.has(p.id)));
    res.json(await refreshSupabaseStorageUrlsDeep({ candidates }));
  } catch (err) {
    req.log.error({ err }, "royal-court candidates error");
    res.status(500).json({ error: "Couldn't load creators for your Front Row. Try again." });
  }
});

/* ── PUT /api/creator-profiles/me/court — crown your Court (auth).
   Replace-all save: the array order IS the ranking (index 0 = position 1).
   Only the caller's own profile can be written — the owner is resolved
   from the session, never from the request body. */
const saveCourtSchema = z.object({
  memberProfileIds: z.array(z.string()).max(64),
});

router.put("/creator-profiles/me/court", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const own = await getOwnProfile(req.userId!);
    if (!own) {
      res.status(404).json({ error: "NO_PROFILE", message: "Create your creator profile first — then you can set your Front Row." });
      return;
    }
    const parsed = saveCourtSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Send your Front Row as a list of creator profile ids." });
      return;
    }
    const ids = parsed.data.memberProfileIds;

    if (ids.length > ROYAL_COURT_MAX_MEMBERS) {
      res.status(400).json({
        error: "COURT_FULL",
        message: `The Front Row holds at most ${ROYAL_COURT_MAX_MEMBERS} creators — pick your top ${ROYAL_COURT_MAX_MEMBERS}.`,
      });
      return;
    }
    if (ids.some((id) => !UUID_SHAPE.test(id))) {
      res.status(400).json({ error: "INVALID_MEMBER", message: "Every Front Row member must be a creator profile id." });
      return;
    }
    if (new Set(ids).size !== ids.length) {
      res.status(400).json({ error: "DUPLICATE_MEMBER", message: "Each creator can hold only one seat in your Front Row." });
      return;
    }
    if (ids.includes(own.id)) {
      res.status(400).json({ error: "SELF_CROWN", message: "You can't take a seat yourself — the Front Row is for your people." });
      return;
    }
    if (ids.length > 0) {
      const found = await db
        .select({ id: creatorProfilesTable.id })
        .from(creatorProfilesTable)
        .where(inArray(creatorProfilesTable.id, ids));
      if (found.length !== ids.length) {
        res.status(400).json({ error: "MEMBER_NOT_FOUND", message: "One of those creators couldn't be found — refresh the picker and try again." });
        return;
      }
    }

    await db.delete(royalCourtTable).where(eq(royalCourtTable.ownerProfileId, own.id));
    if (ids.length > 0) {
      await db.insert(royalCourtTable).values(
        ids.map((memberProfileId, i) => ({
          ownerProfileId: own.id,
          memberProfileId,
          position: i + 1,
        })),
      );
    }

    const court = await loadCourt(own.id, false);
    res.json({ saved: true, court, maxMembers: ROYAL_COURT_MAX_MEMBERS });
  } catch (err) {
    req.log.error({ err }, "royal-court PUT error");
    res.status(500).json({ error: "Couldn't save your Front Row. Try again." });
  }
});

/* ── GET /api/creator-profiles/:slug/court — the public Court (no auth).
   404 when the profile is missing or private, same as the profile page
   itself: a private creator's Court is nobody's business. */
router.get("/creator-profiles/:slug/court", publicApiLimiter, async (req, res) => {
  try {
    const slug = String(req.params["slug"] ?? "").toLowerCase();
    const [profile] = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.slug, slug))
      .limit(1);
    if (!profile || !profile.isPublic) {
      res.status(404).json({ error: "This creator hasn't set up shop yet — or the profile went private." });
      return;
    }
    const court = await loadCourt(profile.id, true);
    res.json(await refreshSupabaseStorageUrlsDeep({ court, maxMembers: ROYAL_COURT_MAX_MEMBERS }));
  } catch (err) {
    req.log.error({ err }, "royal-court GET (public) error");
    res.status(500).json({ error: "Couldn't load the Front Row. Try again." });
  }
});

export default router;
