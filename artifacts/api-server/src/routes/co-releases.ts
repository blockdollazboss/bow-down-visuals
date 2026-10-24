import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  coReleasesTable,
  coReleaseSidesTable,
  creatorProfilesTable,
  distributionReleasesTable,
  storeProductsTable,
  moneyEntriesTable,
  storeOrdersTable,
  notificationsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  applyCoReleaseAction,
  amendProposedSplit,
  attributeEarnings,
  deriveCoReleaseState,
  initialCoRelease,
  isCoReleaseVisibleOnProfile,
  isMissingCoReleaseTable,
  sideForUser,
  validateSplit,
  CoReleaseError,
  CO_RELEASE_NOT_READY,
  type CoRelease,
} from "../lib/co-releases";
import {
  coReleaseSideSummaries,
  fetchProfilesByIdCoRelease,
  loadCoRelease,
  probeCoReleaseTables,
  rowsToCoRelease,
} from "../lib/co-releases-db";

/* ─── Co-releases (Stack-100 #3 Wave 3 — co-posts phase 2) ─────────────────
   A release (song) or a store product, published to BOTH creators'
   profiles at once, with a royalty split captured as CONSENT up front.

   POST   /api/co-releases                        draft a co-release of MY
                                                  existing release/product
                                                  with a proposed split
                                                  (initiator side accepted;
                                                  co-author side pending —
                                                  NOT live anywhere)
   GET    /api/co-releases/mine                   every co-release I'm a
                                                  side of, incl. approvals
   GET    /api/co-releases/by-profile/:id         a profile's LIVE
                                                  co-releases (that side
                                                  still standing)
   GET    /api/co-releases/:id/attribution        the agreed split applied
                                                  to the earnings the rails
                                                  recorded for this item
                                                  (accounting — never a payout)
   POST   /api/co-releases/:id/accept             pending side approves the
                                                  split AND the release →
                                                  publishes + freezes split
   POST   /api/co-releases/:id/decline            pending side says no
                                                  (pre-live only)
   POST   /api/co-releases/:id/withdraw           accepted side withdraws
                                                  THEIR profile copy only
   POST   /api/co-releases/:id/amend-split        initiator re-proposes the
                                                  split (pre-publish only)

   Money rules (no invented prices/rates anywhere):
   - Shares are creator-entered percentages, validated server-side to
     sum to 100 (lib/co-releases validateSplit).
   - The platform fee is NOT in the split: store orders split only
     creator_amount_cents — the amount left AFTER the existing rail's
     flat 5% fee. Release income splits the logged income amount.
   - The site pays nobody real money: attribution here is the same
     split ACCOUNTING model as GET /api/splits/overview.

   Until the held migration (co_releases + co_release_sides, see the
   lane's MIGRATION-NEEDED.md) lands, writes answer 503
   co_release_not_ready BEFORE creating anything. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createSchema = z.object({
  item_kind: z.enum(["release", "product"]),
  item_id: z.string().uuid(),
  co_author_user_id: z.string().uuid().optional(),
  co_author_profile_id: z.string().uuid().optional(),
  author_share_pct: z.number(),
  co_author_share_pct: z.number(),
});

const amendSchema = z.object({
  author_share_pct: z.number(),
  co_author_share_pct: z.number(),
});

function notReady(res: Response) {
  return res.status(503).json({ ...CO_RELEASE_NOT_READY });
}

async function notifyUser(userId: string, kind: string, title: string, body: string, link: string) {
  try {
    await db.insert(notificationsTable).values({ userId, kind, title, body, link });
  } catch {
    /* best-effort — never break the write path over a notification */
  }
}

async function myProfile(userId: string) {
  const [p] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return p ?? null;
}

type HeadRow = typeof coReleasesTable.$inferSelect;

async function dto(head: HeadRow, co: CoRelease, viewerUserId: string | null) {
  const profiles = await fetchProfilesByIdCoRelease(co.sides.map((s) => s.profileId));
  const viewerSide = viewerUserId ? sideForUser(co, viewerUserId) : null;
  return {
    id: head.id,
    item_kind: co.itemKind,
    item_id: co.itemId,
    item_title: head.item_title,
    is_co_release: true,
    co_release_state: deriveCoReleaseState(co),
    published_at: co.publishedAt,
    /* Proposed shares ride on each side; agreed shares are the frozen
       snapshot (null until publish). Displays must show agreed shares
       once published — they are the rail. */
    agreed_shares: co.agreedShares,
    sides: coReleaseSideSummaries(co, profiles),
    viewer_side: viewerSide
      ? { role: viewerSide.role, status: viewerSide.status, profile_id: viewerSide.profileId }
      : null,
    created_at: head.created_at,
  };
}

/* POST /api/co-releases — draft (pending the co-author's approval of
   BOTH the release and the split) */
router.post("/co-releases", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    }
    const d = parsed.data;
    if (!d.co_author_user_id && !d.co_author_profile_id) {
      return res.status(400).json({ error: "no_co_author", message: "Pick the creator you're releasing with." });
    }
    try {
      validateSplit([{ sharePct: d.author_share_pct }, { sharePct: d.co_author_share_pct }]);
    } catch (e) {
      if (e instanceof CoReleaseError) return res.status(400).json({ error: e.code, message: e.message });
      throw e;
    }

    const me = await myProfile(req.userId!);
    if (!me) {
      return res.status(403).json({
        error: "no_profile",
        message: "Create your creator profile first — a co-release lives on both creators' profiles.",
      });
    }

    /* The item must be an EXISTING item the initiator owns. A release
       is owned by account; a store product is owned by creator profile. */
    let itemTitle = "";
    if (d.item_kind === "release") {
      const [rel] = await db
        .select()
        .from(distributionReleasesTable)
        .where(and(eq(distributionReleasesTable.id, d.item_id), eq(distributionReleasesTable.user_id, req.userId!)))
        .limit(1);
      if (!rel) {
        return res.status(404).json({ error: "item_not_found", message: "That release isn't yours (or doesn't exist) — a co-release starts from your own release." });
      }
      itemTitle = rel.title;
    } else {
      const [prod] = await db
        .select()
        .from(storeProductsTable)
        .where(and(eq(storeProductsTable.id, d.item_id), eq(storeProductsTable.profileId, me.id)))
        .limit(1);
      if (!prod) {
        return res.status(404).json({ error: "item_not_found", message: "That product isn't on your profile (or doesn't exist) — a co-release starts from your own product." });
      }
      itemTitle = prod.title;
    }

    let coProfile: typeof creatorProfilesTable.$inferSelect | null = null;
    if (d.co_author_profile_id) {
      const [p] = await db
        .select()
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.id, d.co_author_profile_id))
        .limit(1);
      coProfile = p ?? null;
    } else if (d.co_author_user_id) {
      coProfile = await myProfile(d.co_author_user_id);
    }
    if (!coProfile) {
      return res.status(400).json({
        error: "co_author_no_profile",
        message: "That creator hasn't set up their creator profile yet — a co-release lives on both creator profiles, so they need one first.",
      });
    }
    if (coProfile.id === me.id) {
      return res.status(400).json({ error: "same_creator", message: "A co-release needs two different creators." });
    }

    /* Migration gate: probe BEFORE writing anything. */
    try {
      await probeCoReleaseTables();
    } catch (err) {
      if (isMissingCoReleaseTable(err)) return notReady(res);
      throw err;
    }

    /* One live/pending co-release per item per pair — a second draft
       for the same two creators on the same item is a duplicate, not
       a renegotiation (amend-split is the renegotiation path). */
    const existingHeads = await db
      .select()
      .from(coReleasesTable)
      .where(and(eq(coReleasesTable.item_kind, d.item_kind), eq(coReleasesTable.item_id, d.item_id)));
    if (existingHeads.length > 0) {
      const existingSides = await db
        .select()
        .from(coReleaseSidesTable)
        .where(inArray(coReleaseSidesTable.co_release_id, existingHeads.map((h) => h.id)));
      for (const head of existingHeads) {
        const co = rowsToCoRelease(head, existingSides);
        if (!co) continue;
        const pair = co.sides.map((s) => s.profileId).sort().join(":");
        const us = [me.id, coProfile.id].sort().join(":");
        const state = deriveCoReleaseState(co);
        if (pair === us && (state === "pending" || state === "live" || state === "live_one_side")) {
          return res.status(409).json({
            error: "co_release_exists",
            message: "You two already have a co-release for this item — change the proposed split there, or withdraw it and start again.",
            co_release_id: head.id,
          });
        }
      }
    }

    const [head] = await db
      .insert(coReleasesTable)
      .values({ item_kind: d.item_kind, item_id: d.item_id, item_title: itemTitle })
      .returning();

    const co = initialCoRelease(
      head.id,
      { kind: d.item_kind, id: d.item_id },
      { profileId: me.id, userId: req.userId!, sharePct: d.author_share_pct },
      { profileId: coProfile.id, userId: coProfile.userId, sharePct: d.co_author_share_pct },
    );
    await db.insert(coReleaseSidesTable).values(
      co.sides.map((s) => ({
        co_release_id: head.id,
        profile_id: s.profileId,
        user_id: s.userId,
        role: s.role,
        status: s.status,
        share_pct: String(s.sharePct),
        accepted_at: s.acceptedAt instanceof Date ? s.acceptedAt : s.acceptedAt ? new Date(s.acceptedAt) : null,
        responded_at: s.role === "author" ? new Date() : null,
      })),
    );

    await notifyUser(
      coProfile.userId,
      "co_release_invite",
      `${me.displayName} invited you to co-release "${itemTitle}" 🤝`,
      `They proposed a royalty split — you ${d.co_author_share_pct}% / them ${d.author_share_pct}%. It goes live on both profiles only when you approve the split and the release.`,
      "/collabs?tab=coreleases",
    );

    return res.status(201).json({ co_release: await dto(head, co, req.userId!) });
  } catch (err) {
    if (err instanceof CoReleaseError) return res.status(400).json({ error: err.code, message: err.message });
    if (isMissingCoReleaseTable(err)) return notReady(res);
    logger.error({ err }, "[co-releases] create failed");
    return res.status(500).json({ error: "co_release_failed", message: "Couldn't create that co-release." });
  }
});

/* GET /api/co-releases/mine — approval inbox + my live co-releases */
router.get("/co-releases/mine", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    let sideRows: Array<typeof coReleaseSidesTable.$inferSelect>;
    try {
      sideRows = await db
        .select()
        .from(coReleaseSidesTable)
        .where(eq(coReleaseSidesTable.user_id, req.userId!))
        .orderBy(desc(coReleaseSidesTable.created_at))
        .limit(100);
    } catch (err) {
      if (isMissingCoReleaseTable(err)) return res.json({ co_releases: [], pending_setup: true });
      throw err;
    }
    if (sideRows.length === 0) return res.json({ co_releases: [] });
    const ids = [...new Set(sideRows.map((r) => r.co_release_id))];
    const [heads, allSides] = await Promise.all([
      db.select().from(coReleasesTable).where(inArray(coReleasesTable.id, ids)),
      db.select().from(coReleaseSidesTable).where(inArray(coReleaseSidesTable.co_release_id, ids)),
    ]);
    const out = [];
    for (const head of heads) {
      const co = rowsToCoRelease(head, allSides);
      if (co) out.push(await dto(head, co, req.userId!));
    }
    out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return res.json({ co_releases: out });
  } catch (err) {
    logger.error({ err }, "[co-releases] mine failed");
    return res.status(500).json({ error: "co_releases_failed", message: "Couldn't load your co-releases." });
  }
});

/* GET /api/co-releases/by-profile/:profileId — that profile's LIVE
   co-releases. A withdrawn side's profile never appears here. */
router.get("/co-releases/by-profile/:profileId", async (req: Request, res: Response) => {
  try {
    const profileId = String(req.params["profileId"] ?? "");
    if (!UUID_RE.test(profileId)) return res.status(400).json({ error: "invalid_id" });
    let sideRows: Array<typeof coReleaseSidesTable.$inferSelect>;
    try {
      sideRows = await db
        .select()
        .from(coReleaseSidesTable)
        .where(and(eq(coReleaseSidesTable.profile_id, profileId), eq(coReleaseSidesTable.status, "accepted")))
        .orderBy(desc(coReleaseSidesTable.created_at))
        .limit(100);
    } catch (err) {
      if (isMissingCoReleaseTable(err)) return res.json({ co_releases: [] });
      throw err;
    }
    if (sideRows.length === 0) return res.json({ co_releases: [] });
    const ids = [...new Set(sideRows.map((r) => r.co_release_id))];
    const [heads, allSides] = await Promise.all([
      db.select().from(coReleasesTable).where(inArray(coReleasesTable.id, ids)),
      db.select().from(coReleaseSidesTable).where(inArray(coReleaseSidesTable.co_release_id, ids)),
    ]);
    const out = [];
    for (const head of heads) {
      const co = rowsToCoRelease(head, allSides);
      if (!co || !isCoReleaseVisibleOnProfile(co, profileId)) continue;
      out.push(await dto(head, co, null));
    }
    out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return res.json({ co_releases: out });
  } catch (err) {
    logger.error({ err }, "[co-releases] by-profile failed");
    return res.status(500).json({ error: "co_releases_failed", message: "Couldn't load co-releases for that profile." });
  }
});

/* GET /api/co-releases/:id/attribution — the AGREED split applied to
   the earnings the existing rails recorded for this item, on/after
   the publish moment. Sides only. Accounting — never a payout.
   - release: the author's logged income (money_entries, release_id =
     item, entry_type income, entry_date >= publish date), full amount.
   - product: completed store_orders for the item — creator_amount_cents
     ONLY (the rail's flat 5% platform fee is already out of it and is
     never part of the split). */
router.get("/co-releases/:id/attribution", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params["id"] ?? "");
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    let loaded: Awaited<ReturnType<typeof loadCoRelease>>;
    try {
      loaded = await loadCoRelease(id);
    } catch (err) {
      if (isMissingCoReleaseTable(err)) return notReady(res);
      throw err;
    }
    if (!loaded) return res.status(404).json({ error: "not_found", message: "That co-release doesn't exist." });
    const { head, co } = loaded;
    if (!sideForUser(co, req.userId!)) {
      return res.status(403).json({ error: "not_a_co_author", message: "Only the two creators on this co-release can see its split attribution." });
    }
    if (deriveCoReleaseState(co) === "pending" || deriveCoReleaseState(co) === "declined" || deriveCoReleaseState(co) === "cancelled") {
      return res.status(409).json({
        error: "not_published",
        message: "This co-release hasn't been approved by both creators yet, so there's no agreed split to apply.",
      });
    }
    const authorSide = co.sides.find((s) => s.role === "author")!;
    const publishedAt = co.publishedAt instanceof Date ? co.publishedAt : new Date(co.publishedAt!);
    const publishDay = publishedAt.toISOString().slice(0, 10);

    let earnings: Array<{ id: string; amountCents: number }> = [];
    let basis: string;
    if (co.itemKind === "release") {
      const rows = await db
        .select()
        .from(moneyEntriesTable)
        .where(
          and(
            eq(moneyEntriesTable.user_id, authorSide.userId),
            eq(moneyEntriesTable.entry_type, "income"),
            eq(moneyEntriesTable.releaseId, co.itemId),
          ),
        );
      earnings = rows
        .filter((r) => String(r.entry_date).slice(0, 10) >= publishDay)
        .map((r) => ({ id: r.id, amountCents: r.amount_cents }));
      basis = "logged_income";
    } else {
      const rows = await db
        .select()
        .from(storeOrdersTable)
        .where(and(eq(storeOrdersTable.productId, co.itemId), eq(storeOrdersTable.status, "completed")));
      earnings = rows
        .filter((r) => r.createdAt && r.createdAt >= publishedAt)
        .map((r) => ({ id: r.id, amountCents: r.creatorAmountCents }));
      basis = "creator_amount_after_platform_fee";
    }

    const result = attributeEarnings(co, earnings);
    const profiles = await fetchProfilesByIdCoRelease(co.sides.map((s) => s.profileId));
    return res.json({
      co_release_id: co.id,
      item_kind: co.itemKind,
      item_id: co.itemId,
      item_title: head.item_title,
      basis,
      agreed_shares: co.agreedShares,
      total_creator_cents: result.totalCents,
      totals: result.totals.map((t) => ({
        ...t,
        display_name: profiles.get(t.profileId)?.displayName ?? null,
      })),
      entries: result.entries,
      disclaimer:
        "Split accounting for earnings recorded on the site's existing rails — the site does not pay out real money; these shares are the agreed accounting between the two creators.",
    });
  } catch (err) {
    if (err instanceof CoReleaseError) return res.status(409).json({ error: err.code, message: err.message });
    if (isMissingCoReleaseTable(err)) return notReady(res);
    logger.error({ err }, "[co-releases] attribution failed");
    return res.status(500).json({ error: "co_release_attribution_failed", message: "Couldn't load split attribution." });
  }
});

/* Shared accept / decline / withdraw — pure machine decides legality;
   only the ACTOR's side row is written. Accept-as-second-side also
   freezes the agreed split (head.published_at + sides.agreed_*). */
function actionRoute(action: "accept" | "decline" | "withdraw") {
  return async (req: Request, res: Response) => {
    try {
      const id = String(req.params["id"] ?? "");
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
      let loaded: Awaited<ReturnType<typeof loadCoRelease>>;
      try {
        loaded = await loadCoRelease(id);
      } catch (err) {
        if (isMissingCoReleaseTable(err)) return notReady(res);
        throw err;
      }
      if (!loaded) return res.status(404).json({ error: "not_found", message: "That co-release doesn't exist." });
      const { head, co } = loaded;
      const mySide = sideForUser(co, req.userId!);
      if (!mySide) {
        return res.status(403).json({ error: "not_a_co_author", message: "Only the two creators on this co-release can do that." });
      }
      let next: CoRelease;
      try {
        next = applyCoReleaseAction(co, mySide.profileId, action);
      } catch (e) {
        if (e instanceof CoReleaseError) return res.status(409).json({ error: e.code, message: e.message });
        throw e;
      }
      const changed = next.sides.find((s) => s.profileId === mySide.profileId)!;
      const now = new Date();
      const justPublished = !co.publishedAt && !!next.publishedAt;
      await db
        .update(coReleaseSidesTable)
        .set({
          status: changed.status,
          accepted_at:
            changed.acceptedAt instanceof Date
              ? changed.acceptedAt
              : changed.acceptedAt
                ? new Date(changed.acceptedAt)
                : null,
          responded_at: action === "accept" || action === "decline" ? now : undefined,
          withdrawn_at: action === "withdraw" ? now : undefined,
          /* Freeze: on publish, EVERY side's agreed share is written
             in the same request (see below for the other side). */
          ...(justPublished
            ? { agreed_share_pct: String(changed.sharePct), agreed_at: now }
            : {}),
          updated_at: now,
        })
        .where(
          and(eq(coReleaseSidesTable.co_release_id, id), eq(coReleaseSidesTable.profile_id, mySide.profileId)),
        );
      if (justPublished) {
        const otherSide = next.sides.find((s) => s.profileId !== mySide.profileId)!;
        await db
          .update(coReleaseSidesTable)
          .set({ agreed_share_pct: String(otherSide.sharePct), agreed_at: now, updated_at: now })
          .where(
            and(eq(coReleaseSidesTable.co_release_id, id), eq(coReleaseSidesTable.profile_id, otherSide.profileId)),
          );
        await db
          .update(coReleasesTable)
          .set({ published_at: now, updated_at: now })
          .where(eq(coReleasesTable.id, id));
      }

      const other = next.sides.find((s) => s.profileId !== mySide.profileId);
      if (other) {
        const state = deriveCoReleaseState(next);
        const titles: Record<string, string> = {
          accept: state === "live" ? `Your co-release "${head.item_title}" is live on both profiles 🤝` : "Your co-author approved the co-release 🤝",
          decline: "Your co-release invite was declined",
          withdraw: state === "live_one_side" ? "Your co-author withdrew their side of your co-release" : "Your co-release was withdrawn before it went live",
        };
        const bodies: Record<string, string> = {
          accept: "The split you both approved is now locked in for this release.",
          decline: "A declined co-release never goes live — the item stays a solo release on the original creator's profile.",
          withdraw:
            state === "live_one_side"
              ? "The release leaves their profile only — it stays live on yours, and the agreed split for earnings stays as agreed."
              : "The co-release ended before going live.",
        };
        await notifyUser(other.userId, `co_release_${action}`, titles[action], bodies[action], "/collabs?tab=coreleases");
      }
      const fresh = await loadCoRelease(id);
      return res.json({ co_release: fresh ? await dto(fresh.head, fresh.co, req.userId!) : null });
    } catch (err) {
      if (isMissingCoReleaseTable(err)) return notReady(res);
      logger.error({ err, action }, "[co-releases] action failed");
      return res.status(500).json({ error: "co_release_action_failed", message: "Couldn't update that co-release." });
    }
  };
}

router.post("/co-releases/:id/accept", publicApiLimiter, requireAuth, actionRoute("accept"));
router.post("/co-releases/:id/decline", publicApiLimiter, requireAuth, actionRoute("decline"));
router.post("/co-releases/:id/withdraw", publicApiLimiter, requireAuth, actionRoute("withdraw"));

/* POST /api/co-releases/:id/amend-split — initiator re-proposes the
   split BEFORE publish. The co-author stays pending and must still
   approve the new split. After publish: 409 split_locked, always. */
router.post("/co-releases/:id/amend-split", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params["id"] ?? "");
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    const parsed = amendSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    let loaded: Awaited<ReturnType<typeof loadCoRelease>>;
    try {
      loaded = await loadCoRelease(id);
    } catch (err) {
      if (isMissingCoReleaseTable(err)) return notReady(res);
      throw err;
    }
    if (!loaded) return res.status(404).json({ error: "not_found", message: "That co-release doesn't exist." });
    const { head, co } = loaded;
    const mySide = sideForUser(co, req.userId!);
    if (!mySide) {
      return res.status(403).json({ error: "not_a_co_author", message: "Only the two creators on this co-release can do that." });
    }
    const otherSide = co.sides.find((s) => s.profileId !== mySide.profileId)!;
    let next: CoRelease;
    try {
      next = amendProposedSplit(co, mySide.profileId, [
        { profileId: mySide.profileId, sharePct: parsed.data.author_share_pct },
        { profileId: otherSide.profileId, sharePct: parsed.data.co_author_share_pct },
      ]);
    } catch (e) {
      if (e instanceof CoReleaseError) return res.status(409).json({ error: e.code, message: e.message });
      throw e;
    }
    const now = new Date();
    for (const s of next.sides) {
      await db
        .update(coReleaseSidesTable)
        .set({ share_pct: String(s.sharePct), updated_at: now })
        .where(and(eq(coReleaseSidesTable.co_release_id, id), eq(coReleaseSidesTable.profile_id, s.profileId)));
    }
    await notifyUser(
      otherSide.userId,
      "co_release_split_changed",
      `The proposed split for "${head.item_title}" changed`,
      `New proposal — you ${next.sides.find((s) => s.profileId === otherSide.profileId)!.sharePct}% / them ${next.sides.find((s) => s.profileId === mySide.profileId)!.sharePct}%. Nothing goes live until you approve it.`,
      "/collabs?tab=coreleases",
    );
    return res.json({ co_release: await dto(head, next, req.userId!) });
  } catch (err) {
    if (isMissingCoReleaseTable(err)) return notReady(res);
    logger.error({ err }, "[co-releases] amend-split failed");
    return res.status(500).json({ error: "co_release_amend_failed", message: "Couldn't change the proposed split." });
  }
});

export default router;
