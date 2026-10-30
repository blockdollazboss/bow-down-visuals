import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  plainDealsTable,
  plainDealSidesTable,
  creatorProfilesTable,
  distributionReleasesTable,
  storeProductsTable,
  shopProductsTable,
  coReleasesTable,
  coReleaseSidesTable,
  notificationsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  amendPlainDeal,
  applyPlainDealAction,
  dealSideForUser,
  dealWasSigned,
  derivePlainDealState,
  initialPlainDeal,
  isMissingPlainDealTable,
  renderPlainDealText,
  PlainDealError,
  PLAIN_DEAL_COPY,
  PLAIN_DEAL_ITEM_KINDS,
  PLAIN_DEAL_NOT_READY,
  type PlainDeal,
  type PlainDealSplitAttach,
} from "../lib/plain-deals";
import {
  fetchProfilesByIdPlainDeal,
  loadPlainDeal,
  plainDealSideSummaries,
  probePlainDealTables,
  rowsToPlainDeal,
} from "../lib/plain-deals-db";
import {
  applyCoReleaseAction,
  deriveCoReleaseState,
  initialCoRelease,
} from "../lib/co-releases";
import { rowsToCoRelease } from "../lib/co-releases-db";
import { validateProductSplits, SaleSplitError } from "../lib/sale-splits";

/* ─── Plain-Words Deals (Stack-200 upgrade #164) ───────────────────────────
   The Contracts surface at base is an ANALYZER (paste a deal, get an AI
   review). This router is the missing half: two creators WRITE a deal
   in plain words — what each side does and gets — sign it in-app, and
   at full signature its split is wired into the EXISTING rails:

   POST   /api/plain-deals                  draft a deal (author signs
                                            at draft; partner pending —
                                            nothing is agreed yet)
   GET    /api/plain-deals/mine             every deal I'm a side of
   GET    /api/plain-deals/:id              one deal (sides only)
   POST   /api/plain-deals/:id/sign         sign the words as written —
                                            completing the pair FREEZES
                                            the split + signed text and
                                            attaches the split to its rail
   POST   /api/plain-deals/:id/decline      partner says no (pre-sign)
   POST   /api/plain-deals/:id/withdraw     a signer steps back (the
                                            signed split stands)
   POST   /api/plain-deals/:id/amend        author rewrites the words
                                            pre-signature; the partner
                                            is un-signed and must sign
                                            the NEW words

   Attach rails (no second splits machine is built):
   - item_kind release / product → a co-release is created already
     published with the agreed split frozen (the co-releases consent
     machine builds it). If the pair already has a live/pending
     co-release for the item, the deal stays record-only rather than
     duplicating the rail.
   - item_kind store_product / shop_product → the agreed split is
     written onto the product's sale-splits list (validated by the
     sale-splits machine, owner included).
   - item_kind general → record-only by design.

   Money rules: shares are creator-entered, validated by the
   co-releases validateSplit (sum 100). The platform fee is never
   part of a deal split — the rails take their fee first, exactly as
   with co-releases and sale-splits. No prices are introduced.

   Until the provisional migration (0289_plain_deals.sql) lands,
   writes answer 503 plain_deal_not_ready BEFORE creating anything,
   and reads degrade to empty. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sideWords = z.object({
  does_text: z.string().min(1).max(2000),
  gets_text: z.string().min(1).max(2000),
  share_pct: z.number(),
});

const createSchema = z.object({
  title: z.string().min(1).max(300),
  item_kind: z.enum(PLAIN_DEAL_ITEM_KINDS),
  item_id: z.string().uuid().nullable().optional(),
  item_title: z.string().max(300).optional(),
  partner_profile_id: z.string().uuid().optional(),
  partner_user_id: z.string().uuid().optional(),
  author: sideWords,
  partner: sideWords,
  signed_name: z.string().min(1).max(120),
});

const signSchema = z.object({
  signed_name: z.string().min(1).max(120),
});

const amendSchema = z.object({
  title: z.string().min(1).max(300),
  author: sideWords.extend({ signed_name: z.string().min(1).max(120) }),
  partner: sideWords,
});

function notReady(res: Response) {
  return res.status(503).json({ ...PLAIN_DEAL_NOT_READY });
}

async function notifyUser(userId: string, kind: string, title: string, body: string, link: string) {
  try {
    await db.insert(notificationsTable).values({ userId, kind, title, body, link });
  } catch {
    /* best-effort — never break the write path over a notification */
  }
}

async function myProfileCard(userId: string) {
  const [p] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return p ?? null;
}

type HeadRow = typeof plainDealsTable.$inferSelect;

function attachGuidance(deal: PlainDeal): string {
  if (deal.splitAttach?.rail === "co_release") return PLAIN_DEAL_COPY.attachCoRelease;
  if (deal.splitAttach?.rail === "sale_splits") return PLAIN_DEAL_COPY.attachSaleSplits;
  if (deal.itemKind === "release" || deal.itemKind === "product") return PLAIN_DEAL_COPY.attachCoRelease;
  if (deal.itemKind === "store_product" || deal.itemKind === "shop_product") return PLAIN_DEAL_COPY.attachSaleSplits;
  return PLAIN_DEAL_COPY.attachRecordOnly;
}

async function dto(head: HeadRow, deal: PlainDeal, viewerUserId: string | null) {
  const profiles = await fetchProfilesByIdPlainDeal(deal.sides.map((s) => s.profileId));
  const author = deal.sides.find((s) => s.role === "author")!;
  const partner = deal.sides.find((s) => s.role === "partner")!;
  const viewerSide = viewerUserId ? dealSideForUser(deal, viewerUserId) : null;
  return {
    id: head.id,
    title: deal.title,
    item_kind: deal.itemKind,
    item_id: deal.itemId,
    item_title: deal.itemTitle,
    is_plain_deal: true,
    deal_state: derivePlainDealState(deal),
    /* The agreement in plain words, rendered from the CURRENT words —
       after signing, signed_text is the frozen copy that was signed. */
    plain_text: renderPlainDealText(deal, {
      authorName: profiles.get(author.profileId)?.displayName ?? "One creator",
      partnerName: profiles.get(partner.profileId)?.displayName ?? "The other creator",
    }),
    signed_text: deal.signedText,
    signed_at: deal.signedAt,
    agreed_shares: deal.agreedShares,
    split_attach: deal.splitAttach,
    sides: plainDealSideSummaries(deal, profiles),
    viewer_side: viewerSide
      ? { role: viewerSide.role, status: viewerSide.status, profile_id: viewerSide.profileId }
      : null,
    guidance: {
      fee: PLAIN_DEAL_COPY.feeOutsideSplit,
      locked: PLAIN_DEAL_COPY.lockedAtSignature,
      attach: attachGuidance(deal),
    },
    created_at: head.created_at,
    updated_at: head.updated_at,
  };
}

/* Persist one side row from the machine state (the single write every
   action route shares). */
async function persistSide(dealId: string, side: PlainDeal["sides"][number], now: Date) {
  await db
    .update(plainDealSidesTable)
    .set({
      status: side.status,
      does_text: side.doesText,
      gets_text: side.getsText,
      share_pct: String(side.sharePct),
      signed_name: side.signedName,
      signed_at:
        side.signedAt instanceof Date ? side.signedAt : side.signedAt ? new Date(side.signedAt) : null,
      updated_at: now,
    })
    .where(
      and(eq(plainDealSidesTable.plain_deal_id, dealId), eq(plainDealSidesTable.profile_id, side.profileId)),
    );
}

/* ── The attach: write a freshly-signed deal's frozen split into its
   existing rail. Best-effort by design: the deal is SIGNED either way
   (the split is the agreement on record); a failed or skipped attach
   leaves split_attach null and the honest guidance copy says so. */
async function attachSignedDeal(deal: PlainDeal): Promise<PlainDealSplitAttach> {
  if (!deal.itemId || !deal.agreedShares) return null;
  const now = new Date();
  const author = deal.sides.find((s) => s.role === "author")!;
  const partner = deal.sides.find((s) => s.role === "partner")!;
  try {
    if (deal.itemKind === "release" || deal.itemKind === "product") {
      /* Never duplicate a rail the pair already has for this item. */
      const heads = await db
        .select()
        .from(coReleasesTable)
        .where(and(eq(coReleasesTable.item_kind, deal.itemKind), eq(coReleasesTable.item_id, deal.itemId)));
      if (heads.length > 0) {
        const sideRows = await db
          .select()
          .from(coReleaseSidesTable)
          .where(inArray(coReleaseSidesTable.co_release_id, heads.map((h) => h.id)));
        const pairKey = deal.sides.map((s) => s.profileId).sort().join(":");
        for (const h of heads) {
          const co = rowsToCoRelease(h, sideRows);
          if (!co) continue;
          if (co.sides.map((s) => s.profileId).sort().join(":") !== pairKey) continue;
          const st = deriveCoReleaseState(co);
          if (st === "pending" || st === "live" || st === "live_one_side") return null;
        }
      }
      const coId = randomUUID();
      let co = initialCoRelease(
        coId,
        { kind: deal.itemKind, id: deal.itemId },
        { profileId: author.profileId, userId: author.userId, sharePct: author.sharePct },
        { profileId: partner.profileId, userId: partner.userId, sharePct: partner.sharePct },
      );
      co = applyCoReleaseAction(co, partner.profileId, "accept", now);
      await db.insert(coReleasesTable).values({
        id: coId,
        item_kind: deal.itemKind,
        item_id: deal.itemId,
        item_title: deal.itemTitle,
        published_at: now,
      });
      await db.insert(coReleaseSidesTable).values(
        co.sides.map((s) => ({
          co_release_id: coId,
          profile_id: s.profileId,
          user_id: s.userId,
          role: s.role,
          status: s.status,
          share_pct: String(s.sharePct),
          agreed_share_pct: String(s.sharePct),
          accepted_at:
            s.acceptedAt instanceof Date ? s.acceptedAt : s.acceptedAt ? new Date(s.acceptedAt) : now,
          responded_at: now,
          agreed_at: now,
        })),
      );
      return { rail: "co_release", refId: coId, at: now.toISOString() };
    }
    if (deal.itemKind === "store_product" || deal.itemKind === "shop_product") {
      const splits = validateProductSplits(
        author.userId,
        deal.sides.map((s) => ({ userId: s.userId, sharePct: s.sharePct })),
      );
      if (!splits) return null;
      if (deal.itemKind === "store_product") {
        await db.update(storeProductsTable).set({ splits }).where(eq(storeProductsTable.id, deal.itemId));
      } else {
        await db.update(shopProductsTable).set({ splits }).where(eq(shopProductsTable.id, deal.itemId));
      }
      return { rail: "sale_splits", refId: deal.itemId, at: now.toISOString() };
    }
  } catch (err) {
    logger.warn({ err, dealId: deal.id }, "[plain-deals] split attach failed — deal stands as record-only");
    return null;
  }
  return null;
}

/* POST /api/plain-deals — draft (author signs at draft; partner pending) */
router.post("/plain-deals", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    }
    const d = parsed.data;
    if (!d.partner_profile_id && !d.partner_user_id) {
      return res.status(400).json({ error: "no_partner", message: "Pick the creator you're making this deal with." });
    }
    if (d.item_kind !== "general" && !d.item_id) {
      return res.status(400).json({ error: "item_required", message: "This kind of deal names the work it covers — pick the release or product." });
    }

    const me = await myProfileCard(req.userId!);
    if (!me) {
      return res.status(403).json({
        error: "no_profile",
        message: "Create your creator profile first — a plain-words deal lives on both creators' profiles.",
      });
    }

    /* The item must be an EXISTING item the author owns. A release is
       owned by account; a store product by creator profile; a shop
       product by account. */
    let itemTitle = "";
    if (d.item_kind === "release") {
      const [rel] = await db
        .select()
        .from(distributionReleasesTable)
        .where(and(eq(distributionReleasesTable.id, d.item_id!), eq(distributionReleasesTable.user_id, req.userId!)))
        .limit(1);
      if (!rel) {
        return res.status(404).json({ error: "item_not_found", message: "That release isn't yours (or doesn't exist) — a deal starts from your own work." });
      }
      itemTitle = rel.title;
    } else if (d.item_kind === "product" || d.item_kind === "store_product") {
      const [prod] = await db
        .select()
        .from(storeProductsTable)
        .where(and(eq(storeProductsTable.id, d.item_id!), eq(storeProductsTable.profileId, me.id)))
        .limit(1);
      if (!prod) {
        return res.status(404).json({ error: "item_not_found", message: "That product isn't on your profile (or doesn't exist) — a deal starts from your own work." });
      }
      itemTitle = prod.title;
    } else if (d.item_kind === "shop_product") {
      const [prod] = await db
        .select()
        .from(shopProductsTable)
        .where(and(eq(shopProductsTable.id, d.item_id!), eq(shopProductsTable.user_id, req.userId!)))
        .limit(1);
      if (!prod) {
        return res.status(404).json({ error: "item_not_found", message: "That shop product isn't yours (or doesn't exist) — a deal starts from your own work." });
      }
      itemTitle = prod.name;
    } else {
      itemTitle = (d.item_title ?? "").trim();
    }

    let partnerCard: Awaited<ReturnType<typeof myProfileCard>> | null = null;
    if (d.partner_profile_id) {
      const rows = await fetchProfilesByIdPlainDeal([d.partner_profile_id]);
      partnerCard = rows.get(d.partner_profile_id) ?? null;
    } else if (d.partner_user_id) {
      partnerCard = await myProfileCard(d.partner_user_id);
    }
    if (!partnerCard) {
      return res.status(400).json({
        error: "partner_no_profile",
        message: "That creator hasn't set up their creator profile yet — a deal lives on both creator profiles, so they need one first.",
      });
    }
    if (partnerCard.id === me.id) {
      return res.status(400).json({ error: "same_creator", message: "A deal needs two different creators." });
    }

    /* Migration gate: probe BEFORE writing anything. */
    try {
      await probePlainDealTables();
    } catch (err) {
      if (isMissingPlainDealTable(err)) return notReady(res);
      throw err;
    }

    const id = randomUUID();
    const deal = initialPlainDeal(id, {
      title: d.title,
      itemKind: d.item_kind,
      itemId: d.item_kind === "general" ? null : d.item_id!,
      itemTitle,
      author: {
        profileId: me.id,
        userId: req.userId!,
        doesText: d.author.does_text,
        getsText: d.author.gets_text,
        sharePct: d.author.share_pct,
        signedName: d.signed_name,
      },
      partner: {
        profileId: partnerCard.id,
        userId: partnerCard.userId,
        doesText: d.partner.does_text,
        getsText: d.partner.gets_text,
        sharePct: d.partner.share_pct,
      },
    });

    const [head] = await db
      .insert(plainDealsTable)
      .values({
        id,
        title: deal.title,
        item_kind: deal.itemKind,
        item_id: deal.itemId,
        item_title: deal.itemTitle,
      })
      .returning();
    await db.insert(plainDealSidesTable).values(
      deal.sides.map((s) => ({
        plain_deal_id: id,
        profile_id: s.profileId,
        user_id: s.userId,
        role: s.role,
        status: s.status,
        does_text: s.doesText,
        gets_text: s.getsText,
        share_pct: String(s.sharePct),
        signed_name: s.signedName,
        signed_at: s.signedAt instanceof Date ? s.signedAt : s.signedAt ? new Date(s.signedAt) : null,
      })),
    );

    const authorSideDraft = deal.sides.find((s) => s.role === "author")!;
    const partnerSideDraft = deal.sides.find((s) => s.role === "partner")!;
    await notifyUser(
      partnerCard.userId,
      "plain_deal_invite",
      `${me.displayName} wrote you a plain-words deal 🤝`,
      `"${deal.title}" — in plain words: what each of you does, what each of you gets, and a ${authorSideDraft.sharePct}% / ${partnerSideDraft.sharePct}% split. Nothing is agreed until you sign the same words.`,
      "/contracts",
    );

    return res.status(201).json({ plain_deal: await dto(head, deal, req.userId!) });
  } catch (err) {
    if (err instanceof PlainDealError) return res.status(400).json({ error: err.code, message: err.message });
    if (isMissingPlainDealTable(err)) return notReady(res);
    logger.error({ err }, "[plain-deals] create failed");
    return res.status(500).json({ error: "plain_deal_failed", message: "Couldn't create that deal." });
  }
});

/* GET /api/plain-deals/mine — my deals, newest first (guarded read) */
router.get("/plain-deals/mine", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    let sideRows: Array<typeof plainDealSidesTable.$inferSelect>;
    try {
      sideRows = await db
        .select()
        .from(plainDealSidesTable)
        .where(eq(plainDealSidesTable.user_id, req.userId!))
        .orderBy(desc(plainDealSidesTable.created_at))
        .limit(100);
    } catch (err) {
      if (isMissingPlainDealTable(err)) return res.json({ plain_deals: [], pending_setup: true });
      throw err;
    }
    if (sideRows.length === 0) return res.json({ plain_deals: [] });
    const ids = [...new Set(sideRows.map((r) => r.plain_deal_id))];
    const [heads, allSides] = await Promise.all([
      db.select().from(plainDealsTable).where(inArray(plainDealsTable.id, ids)),
      db.select().from(plainDealSidesTable).where(inArray(plainDealSidesTable.plain_deal_id, ids)),
    ]);
    const out = [];
    for (const head of heads) {
      const deal = rowsToPlainDeal(head, allSides);
      if (deal) out.push(await dto(head, deal, req.userId!));
    }
    out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return res.json({ plain_deals: out });
  } catch (err) {
    logger.error({ err }, "[plain-deals] mine failed");
    return res.status(500).json({ error: "plain_deals_failed", message: "Couldn't load your deals." });
  }
});

/* GET /api/plain-deals/:id — one deal; only its two sides may read it */
router.get("/plain-deals/:id", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const id = String(req.params["id"] ?? "");
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    let loaded: Awaited<ReturnType<typeof loadPlainDeal>>;
    try {
      loaded = await loadPlainDeal(id);
    } catch (err) {
      if (isMissingPlainDealTable(err)) return notReady(res);
      throw err;
    }
    if (!loaded) return res.status(404).json({ error: "not_found", message: "That deal doesn't exist." });
    if (!dealSideForUser(loaded.deal, req.userId!)) {
      return res.status(403).json({ error: "not_a_party", message: "Only the two creators on this deal can see it." });
    }
    return res.json({ plain_deal: await dto(loaded.head, loaded.deal, req.userId!) });
  } catch (err) {
    logger.error({ err }, "[plain-deals] get failed");
    return res.status(500).json({ error: "plain_deal_failed", message: "Couldn't load that deal." });
  }
});

/* Shared loader for the action routes: 404/403 handled, deal in hand. */
async function loadForAction(req: Request, res: Response) {
  const id = String(req.params["id"] ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return null;
  }
  let loaded: Awaited<ReturnType<typeof loadPlainDeal>>;
  try {
    loaded = await loadPlainDeal(id);
  } catch (err) {
    if (isMissingPlainDealTable(err)) {
      notReady(res);
      return null;
    }
    throw err;
  }
  if (!loaded) {
    res.status(404).json({ error: "not_found", message: "That deal doesn't exist." });
    return null;
  }
  const mySide = dealSideForUser(loaded.deal, req.userId!);
  if (!mySide) {
    res.status(403).json({ error: "not_a_party", message: "Only the two creators on this deal can do that." });
    return null;
  }
  return { ...loaded, mySide };
}

async function signNames(deal: PlainDeal): Promise<{ authorName: string; partnerName: string }> {
  const profiles = await fetchProfilesByIdPlainDeal(deal.sides.map((s) => s.profileId));
  const author = deal.sides.find((s) => s.role === "author")!;
  const partner = deal.sides.find((s) => s.role === "partner")!;
  return {
    authorName: profiles.get(author.profileId)?.displayName ?? "One creator",
    partnerName: profiles.get(partner.profileId)?.displayName ?? "The other creator",
  };
}

/* POST /api/plain-deals/:id/sign — sign the words as written. When this
   completes the pair, the split + text freeze and the split attaches. */
router.post("/plain-deals/:id/sign", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = signSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    const ctx = await loadForAction(req, res);
    if (!ctx) return;
    const { head, deal, mySide } = ctx;
    const names = await signNames(deal);
    let next: PlainDeal;
    try {
      next = applyPlainDealAction(deal, mySide.profileId, "sign", { signedName: parsed.data.signed_name, ...names });
    } catch (e) {
      if (e instanceof PlainDealError) return res.status(409).json({ error: e.code, message: e.message });
      throw e;
    }
    const now = new Date();
    const changed = next.sides.find((s) => s.profileId === mySide.profileId)!;
    await persistSide(deal.id, changed, now);

    const justSigned = !dealWasSigned(deal) && dealWasSigned(next);
    if (justSigned) {
      const attach = await attachSignedDeal(next);
      const frozen: PlainDeal = { ...next, splitAttach: attach };
      await db
        .update(plainDealsTable)
        .set({
          agreed_shares: next.agreedShares,
          signed_text: next.signedText,
          signed_at: next.signedAt instanceof Date ? next.signedAt : next.signedAt ? new Date(next.signedAt) : now,
          split_attach: attach
            ? { rail: attach.rail, refId: attach.refId, at: new Date(attach.at).toISOString() }
            : null,
          updated_at: now,
        })
        .where(eq(plainDealsTable.id, deal.id));
      const other = next.sides.find((s) => s.profileId !== mySide.profileId)!;
      await notifyUser(
        other.userId,
        "plain_deal_signed",
        `Your plain-words deal "${head.title}" is signed by both sides 🤝`,
        attach
          ? "The words and the split are locked, and the split is wired into the work — nobody has to re-type the numbers."
          : "The words and the split are locked and on record.",
        "/contracts",
      );
      const fresh = await loadPlainDeal(deal.id);
      return res.json({ plain_deal: fresh ? await dto(fresh.head, frozen, req.userId!) : null });
    }
    const fresh = await loadPlainDeal(deal.id);
    return res.json({ plain_deal: fresh ? await dto(fresh.head, fresh.deal, req.userId!) : null });
  } catch (err) {
    if (isMissingPlainDealTable(err)) return notReady(res);
    logger.error({ err }, "[plain-deals] sign failed");
    return res.status(500).json({ error: "plain_deal_action_failed", message: "Couldn't sign that deal." });
  }
});

/* POST /api/plain-deals/:id/decline + /withdraw — the pure machine
   decides legality; only the actor's side row is written. */
function actionRoute(action: "decline" | "withdraw") {
  return async (req: Request, res: Response) => {
    try {
      const ctx = await loadForAction(req, res);
      if (!ctx) return;
      const { head, deal, mySide } = ctx;
      const names = await signNames(deal);
      let next: PlainDeal;
      try {
        next = applyPlainDealAction(deal, mySide.profileId, action, names);
      } catch (e) {
        if (e instanceof PlainDealError) return res.status(409).json({ error: e.code, message: e.message });
        throw e;
      }
      const now = new Date();
      const changed = next.sides.find((s) => s.profileId === mySide.profileId)!;
      await persistSide(deal.id, changed, now);
      const other = next.sides.find((s) => s.profileId !== mySide.profileId);
      if (other) {
        const state = derivePlainDealState(next);
        const titles: Record<string, string> = {
          decline: "Your plain-words deal was declined",
          withdraw:
            state === "signed_one_withdrawn"
              ? "Your deal partner stepped back from your signed deal"
              : "Your plain-words deal was withdrawn before signing",
        };
        const bodies: Record<string, string> = {
          decline: "A declined deal never takes effect — the words and split you saw are simply off the table.",
          withdraw:
            state === "signed_one_withdrawn"
              ? "The signed split still stands for money earned under it — stepping back only looks forward."
              : "The deal ended before it was signed, so nothing was ever agreed.",
        };
        await notifyUser(other.userId, `plain_deal_${action}`, titles[action], bodies[action], "/contracts");
      }
      const fresh = await loadPlainDeal(deal.id);
      return res.json({ plain_deal: fresh ? await dto(fresh.head, fresh.deal, req.userId!) : null });
    } catch (err) {
      if (isMissingPlainDealTable(err)) return notReady(res);
      logger.error({ err, action }, "[plain-deals] action failed");
      return res.status(500).json({ error: "plain_deal_action_failed", message: "Couldn't update that deal." });
    }
  };
}

router.post("/plain-deals/:id/decline", requireAuth, publicApiLimiter, actionRoute("decline"));
router.post("/plain-deals/:id/withdraw", requireAuth, publicApiLimiter, actionRoute("withdraw"));

/* POST /api/plain-deals/:id/amend — author rewrites the words before
   signature. The partner is un-signed in the same write: they must
   sign the NEW words; nobody is bound by words they didn't sign. */
router.post("/plain-deals/:id/amend", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = amendSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    const ctx = await loadForAction(req, res);
    if (!ctx) return;
    const { head, deal, mySide } = ctx;
    let next: PlainDeal;
    try {
      next = amendPlainDeal(deal, mySide.profileId, {
        title: parsed.data.title,
        author: {
          doesText: parsed.data.author.does_text,
          getsText: parsed.data.author.gets_text,
          sharePct: parsed.data.author.share_pct,
          signedName: parsed.data.author.signed_name,
        },
        partner: {
          doesText: parsed.data.partner.does_text,
          getsText: parsed.data.partner.gets_text,
          sharePct: parsed.data.partner.share_pct,
        },
      });
    } catch (e) {
      if (e instanceof PlainDealError) return res.status(409).json({ error: e.code, message: e.message });
      throw e;
    }
    const now = new Date();
    await db
      .update(plainDealsTable)
      .set({ title: next.title, updated_at: now })
      .where(eq(plainDealsTable.id, deal.id));
    for (const s of next.sides) await persistSide(deal.id, s, now);
    const other = next.sides.find((s) => s.profileId !== mySide.profileId)!;
    await notifyUser(
      other.userId,
      "plain_deal_amended",
      `The plain-words deal "${head.title}" changed before signing`,
      "New words and a new split were written, so your earlier read no longer counts — review and sign the new version if it works for you.",
      "/contracts",
    );
    const fresh = await loadPlainDeal(deal.id);
    return res.json({ plain_deal: fresh ? await dto(fresh.head, fresh.deal, req.userId!) : null });
  } catch (err) {
    if (isMissingPlainDealTable(err)) return notReady(res);
    logger.error({ err }, "[plain-deals] amend failed");
    return res.status(500).json({ error: "plain_deal_amend_failed", message: "Couldn't change that deal." });
  }
});

export default router;
