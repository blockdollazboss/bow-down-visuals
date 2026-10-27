/**
 * group-profiles.ts — Duo/Group Profiles (Stack-200 UPGRADE N20).
 *
 *  POST /api/teams/:teamId/group-profile            upsert the group's
 *                                                   public identity +
 *                                                   written split terms
 *                                                   (team owner/admin)
 *  GET  /api/teams/:teamId/group-profile            the team's own view
 *                                                   (any active member)
 *  POST /api/teams/:teamId/group-profile/products   add a product to the
 *                                                   shared store — the
 *                                                   group's split terms
 *                                                   are stamped onto the
 *                                                   product's splits, so
 *                                                   the sale-splits rail
 *                                                   divides its sales
 *  GET  /api/group-profiles/:slug                   the public page:
 *                                                   identity, members
 *                                                   credited, split
 *                                                   terms, shared store
 *
 * The internal team and the money rail already exist (routes/teams.ts,
 * lib/sale-splits.ts) — this router is only the public half. Checkout,
 * orders and delivery are untouched: a group product is a normal store
 * product whose profile_id is the team owner's creator profile.
 */
import { Router, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  groupProfilesTable,
  teamMembersTable,
  creatorProfilesTable,
  storeProductsTable,
  type GroupProfile,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import {
  GroupProfileError,
  SaleSplitError,
  creditedMembers,
  getGroupProfileBySlug,
  getGroupProfileByTeam,
  getTeamRow,
  groupProfilesReady,
  listActiveMemberUserIds,
  listGroupStoreProducts,
  normalizeGroupSlug,
  storeProductsHaveGroupColumn,
  validateGroupSplitTerms,
} from "../lib/group-profiles";
import { validateProductSplits } from "../lib/sale-splits";

const router = Router();

function paramId(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireMembership(userId: string, teamId: string, minRole: "member" | "admin" | "owner") {
  const rows = await db
    .select()
    .from(teamMembersTable)
    .where(
      and(
        eq(teamMembersTable.teamId, teamId),
        eq(teamMembersTable.userId, userId),
        eq(teamMembersTable.status, "active"),
      ),
    )
    .limit(1);
  const membership = rows[0];
  if (!membership) return null;
  const rank: Record<string, number> = { member: 0, admin: 1, owner: 2 };
  if ((rank[membership.role] ?? 0) < (rank[minRole] ?? 0)) return null;
  return membership;
}

function notReady(res: Response) {
  res.status(503).json({
    error: "GROUP_PROFILES_NOT_READY",
    message: "Group profiles aren't switched on yet — nothing was saved.",
  });
}

function publicGroupView(group: GroupProfile) {
  return {
    slug: group.slug,
    displayName: group.displayName,
    bio: group.bio,
    avatarUrl: group.avatarUrl,
    bannerUrl: group.bannerUrl,
    splitTerms: group.splitTerms ?? null,
  };
}

function ownGroupView(group: GroupProfile) {
  return {
    id: group.id,
    teamId: group.teamId,
    isPublished: group.isPublished,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    ...publicGroupView(group),
  };
}

/* ── Upsert the public identity + split terms ─────────────────────── */
router.post("/teams/:teamId/group-profile", requireAuth, async (req: Request, res: Response) => {
  const teamId = paramId(req.params["teamId"]);
  if (!UUID_RE.test(teamId)) {
    res.status(400).json({ error: "Invalid team id." });
    return;
  }
  try {
    if (!(await groupProfilesReady())) return notReady(res);
    const membership = await requireMembership(req.userId!, teamId, "admin");
    if (!membership) {
      res.status(403).json({ error: "Only the team's owner or admins manage its public profile." });
      return;
    }
    const team = await getTeamRow(teamId);
    if (!team) {
      res.status(404).json({ error: "Team not found." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const existing = await getGroupProfileByTeam(teamId);

    let slug = existing?.slug ?? null;
    if (body["slug"] !== undefined) {
      slug = normalizeGroupSlug(body["slug"]);
      if (!slug) {
        res.status(400).json({
          error: "slug_invalid",
          message: "The group handle needs 3–64 characters: lowercase letters, numbers and dashes, starting and ending with a letter or number.",
        });
        return;
      }
      const clash = await getGroupProfileBySlug(slug);
      if (clash && clash.teamId !== teamId) {
        res.status(409).json({ error: "slug_taken", message: "That group handle is already taken." });
        return;
      }
    }
    if (!slug) {
      res.status(400).json({ error: "slug_required", message: "Pick a handle for the group's public page." });
      return;
    }

    const displayName =
      typeof body["displayName"] === "string" && body["displayName"].trim()
        ? body["displayName"].trim().slice(0, 120)
        : (existing?.displayName ?? team.name);
    const bio =
      typeof body["bio"] === "string" ? body["bio"].slice(0, 2000) : (existing?.bio ?? "");
    const avatarUrl =
      typeof body["avatarUrl"] === "string" ? body["avatarUrl"] : (existing?.avatarUrl ?? null);
    const bannerUrl =
      typeof body["bannerUrl"] === "string" ? body["bannerUrl"] : (existing?.bannerUrl ?? null);
    const isPublished =
      typeof body["isPublished"] === "boolean" ? body["isPublished"] : (existing?.isPublished ?? false);

    /* Split terms: only re-validated (and only changed) when the key is
       sent — null clears them. The machine + the active-member rule
       both run before anything is stored. */
    let splitTerms = existing?.splitTerms ?? null;
    if ("splitTerms" in body) {
      try {
        const memberIds = await listActiveMemberUserIds(teamId);
        splitTerms = validateGroupSplitTerms(team.ownerId, memberIds, body["splitTerms"] ?? null);
      } catch (err) {
        if (err instanceof SaleSplitError || err instanceof GroupProfileError) {
          res.status(400).json({ error: err.code, message: err.message });
          return;
        }
        throw err;
      }
    }

    const values = { slug, displayName, bio, avatarUrl, bannerUrl, isPublished, splitTerms };
    const [saved] = existing
      ? await db
          .update(groupProfilesTable)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(groupProfilesTable.id, existing.id))
          .returning()
      : await db.insert(groupProfilesTable).values({ teamId, ...values }).returning();
    res.status(existing ? 200 : 201).json({ group: ownGroupView(saved!) });
  } catch (err) {
    req.log.error({ err }, "group-profiles: upsert failed");
    res.status(500).json({ error: "Could not save the group profile. Please try again." });
  }
});

/* ── The team's own view ──────────────────────────────────────────── */
router.get("/teams/:teamId/group-profile", requireAuth, async (req: Request, res: Response) => {
  const teamId = paramId(req.params["teamId"]);
  if (!UUID_RE.test(teamId)) {
    res.status(400).json({ error: "Invalid team id." });
    return;
  }
  try {
    const membership = await requireMembership(req.userId!, teamId, "member");
    if (!membership) {
      res.status(403).json({ error: "You're not an active member of this team." });
      return;
    }
    const group = await getGroupProfileByTeam(teamId);
    if (!group) {
      res.json({ group: null, members: [], products: [] });
      return;
    }
    const [members, products] = await Promise.all([
      creditedMembers(group),
      listGroupStoreProducts(group.id),
    ]);
    res.json({ group: ownGroupView(group), members, products });
  } catch (err) {
    req.log.error({ err }, "group-profiles: own view failed");
    res.status(500).json({ error: "Could not read the group profile. Please try again." });
  }
});

/* ── Add a product to the shared store ────────────────────────────── */
const GROUP_PRODUCT_KINDS = ["download", "merch", "digital", "service", "ticket", "course", "gift_card"] as const;

router.post("/teams/:teamId/group-profile/products", requireAuth, async (req: Request, res: Response) => {
  const teamId = paramId(req.params["teamId"]);
  if (!UUID_RE.test(teamId)) {
    res.status(400).json({ error: "Invalid team id." });
    return;
  }
  try {
    if (!(await groupProfilesReady())) return notReady(res);
    if (!(await storeProductsHaveGroupColumn())) return notReady(res);
    const membership = await requireMembership(req.userId!, teamId, "admin");
    if (!membership) {
      res.status(403).json({ error: "Only the team's owner or admins manage its shared store." });
      return;
    }
    const team = await getTeamRow(teamId);
    const group = await getGroupProfileByTeam(teamId);
    if (!team || !group) {
      res.status(404).json({ error: "Set up the group's public profile before adding store products." });
      return;
    }
    /* The product's storefront profile stays the team owner's creator
       profile — checkout, orders and delivery keep their one rail. */
    const [ownerProfile] = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, team.ownerId))
      .limit(1);
    if (!ownerProfile) {
      res.status(409).json({
        error: "owner_profile_missing",
        message: "The team owner needs a creator profile before the group can sell — the shared store runs on it.",
      });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = typeof body["kind"] === "string" ? body["kind"] : "";
    if (!(GROUP_PRODUCT_KINDS as readonly string[]).includes(kind)) {
      res.status(400).json({ error: "kind_invalid", message: "Pick what kind of product this is." });
      return;
    }
    const title = typeof body["title"] === "string" ? body["title"].trim() : "";
    if (!title || title.length > 200) {
      res.status(400).json({ error: "title_required", message: "Give the product a title (max 200 characters)." });
      return;
    }
    const priceCents = body["priceCents"];
    if (typeof priceCents !== "number" || !Number.isInteger(priceCents) || priceCents < 0) {
      res.status(400).json({ error: "price_invalid", message: "The price must be a whole number of cents, 0 or more." });
      return;
    }
    const inventory =
      typeof body["inventory"] === "number" && Number.isInteger(body["inventory"]) ? body["inventory"] : -1;
    const mediaUrls = Array.isArray(body["mediaUrls"])
      ? body["mediaUrls"].filter((u): u is string => typeof u === "string").slice(0, 20)
      : [];
    /* THE stamp: the group's written split terms become the product's
       own splits (defensively re-validated), so the shipped
       sale-splits rail divides this product's sales by the published
       terms. No terms written → no splits → sells as the owner's. */
    const splits = group.splitTerms ? validateProductSplits(team.ownerId, group.splitTerms) : null;

    const [product] = await db
      .insert(storeProductsTable)
      .values({
        profileId: ownerProfile.id,
        groupProfileId: group.id,
        kind: kind as (typeof GROUP_PRODUCT_KINDS)[number],
        title,
        description: typeof body["description"] === "string" ? body["description"].slice(0, 5000) : "",
        priceCents,
        inventory,
        mediaUrls,
        splits,
        isActive: body["isActive"] === false ? false : true,
      })
      .returning();
    res.status(201).json({ product });
  } catch (err) {
    req.log.error({ err }, "group-profiles: product create failed");
    res.status(500).json({ error: "Could not add this product to the group store. Please try again." });
  }
});

/* ── The public page ──────────────────────────────────────────────── */
router.get("/group-profiles/:slug", async (req: Request, res: Response) => {
  try {
    const slug = normalizeGroupSlug(paramId(req.params["slug"]));
    if (!slug) {
      res.status(404).json({ error: "Group not found." });
      return;
    }
    const group = await getGroupProfileBySlug(slug);
    if (!group || !group.isPublished) {
      res.status(404).json({ error: "Group not found." });
      return;
    }
    const [members, products] = await Promise.all([
      creditedMembers(group),
      listGroupStoreProducts(group.id),
    ]);
    res.json({ group: publicGroupView(group), members, products });
  } catch (err) {
    req.log.error({ err }, "group-profiles: public view failed");
    res.status(500).json({ error: "Could not load this group. Please try again." });
  }
});

export default router;
