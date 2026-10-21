/**
 * Live social-proof sync (competitor-study C5) — verified audience
 * figures from a creator's ALREADY-CONNECTED social accounts, cached in
 * creator_social_proof (migration 0198) and shown on the Grand Stage
 * profile with source + last-updated labels.
 *
 * Honesty law for every figure that reaches a screen:
 *   - A figure exists ONLY when a connected rail actually returned that
 *     number. The fetchers (routes/analytics.ts, reused — never
 *     duplicated) report fields a provider didn't return as null, and
 *     nulls become ABSENT figures here: never estimated, never rounded
 *     up, never carried forward as if fresh.
 *   - A failed refresh keeps the old figure with its ORIGINAL
 *     fetchedAt — the label keeps saying when it was really measured.
 *   - A disconnected account's figures retire at read time, and any
 *     figure older than PROOF_MAX_PUBLIC_AGE_MS stops showing at all.
 *   - The creator holds a per-figure off switch (hidden_keys). A live
 *     figure defaults ON; a hidden figure shows nowhere, for anyone.
 *
 * Refresh cadence: lazy, on a PROOF_FRESH_MS threshold — the owner's
 * settings read, an explicit refresh action, or an opportunistic
 * background pass on a stale public profile read. No cron, and FREE:
 * there is deliberately no credits import anywhere in this feature.
 */
import { eq } from "drizzle-orm";
import {
  db,
  creatorProfilesTable,
  creatorSocialProofTable,
  socialAccountsTable,
  type SocialProofFigure,
} from "@workspace/db";
import { logger } from "./logger";

export type { SocialProofFigure };

/** A cached figure is "fresh" for 6 hours; refresh triggers past that. */
export const PROOF_FRESH_MS = 6 * 60 * 60 * 1000;
/** Past 7 days a figure stops displaying entirely — too old to vouch for. */
export const PROOF_MAX_PUBLIC_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/* ── Figure catalog ──────────────────────────────────────────────────────
   Which stats become public proof, per platform. Deliberately audience
   numbers only (followers / likes / post counts) — never `following`
   (that's who the creator follows, not proof of anything). Facebook's
   fetcher reads followers_count with a fan_count fallback, so the Page
   figure is one honest "Page followers" number, whatever the rail gave. */
export interface ProofStats {
  followers: number | null;
  following: number | null;
  mediaCount: number | null;
  totalLikes: number | null;
}

interface FigureDef {
  field: keyof ProofStats;
  key: string;
  label: string;
}

export const FIGURE_DEFS: Record<string, FigureDef[]> = {
  instagram: [
    { field: "followers", key: "instagram.followers", label: "Instagram followers" },
    { field: "mediaCount", key: "instagram.posts", label: "Instagram posts" },
  ],
  facebook: [
    { field: "followers", key: "facebook.followers", label: "Facebook Page followers" },
  ],
  tiktok: [
    { field: "followers", key: "tiktok.followers", label: "TikTok followers" },
    { field: "totalLikes", key: "tiktok.likes", label: "TikTok likes" },
    { field: "mediaCount", key: "tiktok.videos", label: "TikTok videos" },
  ],
};

export const KNOWN_FIGURE_KEYS: ReadonlySet<string> = new Set(
  Object.values(FIGURE_DEFS).flatMap((defs) => defs.map((d) => d.key)),
);

const PLATFORM_ORDER: Record<string, number> = { instagram: 0, facebook: 1, tiktok: 2 };

/* ── Account + fetcher shapes ────────────────────────────────────────────
   The fetcher is injected (routes/social-proof.ts passes the analytics
   overviewForAccount) so this lib never imports a routes module; the
   structural types match analytics' AccountRow / PlatformOverview. */
export interface ProofAccount {
  id: string;
  platform: string;
  username: string | null;
  page_name: string | null;
  page_id: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: Date | null;
}

export interface ProofOverview {
  status: string;
  stats: ProofStats | null;
  fetchedAt: string | null;
}

export type ProofOverviewFetcher = (account: ProofAccount) => Promise<ProofOverview>;

/* ── Pure shaping ──────────────────────────────────────────────────────── */

/** Stats → figures. ONLY finite, non-negative numbers the rail returned
    become figures; a missing field is a missing figure, full stop. */
export function figuresFromStats(
  platform: string,
  account: Pick<ProofAccount, "id" | "username" | "page_name">,
  stats: ProofStats | null,
  fetchedAt: string,
): SocialProofFigure[] {
  if (!stats) return [];
  const defs = FIGURE_DEFS[platform];
  if (!defs) return [];
  const accountLabel = account.page_name ?? account.username ?? "";
  const out: SocialProofFigure[] = [];
  for (const def of defs) {
    const v = stats[def.field];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out.push({
        key: def.key,
        platform: platform as SocialProofFigure["platform"],
        accountId: account.id,
        accountLabel,
        label: def.label,
        value: v,
        fetchedAt,
      });
    }
  }
  return out;
}

/**
 * Merge one refresh pass into the cached figures.
 * freshByAccount maps accountId → figures on a successful fetch (an
 * EMPTY array means the rail answered but returned no usable numbers —
 * the old figures for that account retire rather than posing as
 * current), or null on a failed fetch (old figures keep their original
 * fetchedAt and decay by the normal staleness rules). Figures whose
 * account is no longer connected are dropped.
 */
export function mergeFigures(
  existing: SocialProofFigure[],
  freshByAccount: Map<string, SocialProofFigure[] | null>,
  currentAccountIds: ReadonlySet<string>,
): SocialProofFigure[] {
  const out: SocialProofFigure[] = [];
  const replaced = new Set<string>();
  for (const [accountId, figs] of freshByAccount) {
    if (figs === null) continue;
    replaced.add(accountId);
    out.push(...figs);
  }
  for (const f of existing) {
    if (!currentAccountIds.has(f.accountId)) continue; // disconnected → retired
    if (replaced.has(f.accountId)) continue; // fresh fetch wins (incl. OK-but-empty)
    out.push(f); // fetch failed → keep, timestamp untouched
  }
  return out;
}

export interface PublicProofFigure {
  key: string;
  platform: string;
  label: string;
  value: number;
  accountLabel: string;
  /** ISO time the rail actually returned this number. */
  updatedAt: string;
  /** True when the figure is past the fresh window — shown WITH its date. */
  stale: boolean;
}

/**
 * The ONLY path from cache to a public screen. Hides: creator-hidden
 * figures, figures from disconnected accounts, and figures older than
 * the max public age. Everything that survives carries its real
 * updatedAt; nothing is relabeled, rounded, or re-dated here.
 */
export function shapePublicProof(
  figures: SocialProofFigure[],
  hiddenKeys: readonly string[],
  connectedAccountIds: ReadonlySet<string>,
  nowMs: number,
): PublicProofFigure[] {
  const hidden = new Set(hiddenKeys);
  return figures
    .filter((f) => !hidden.has(f.key))
    .filter((f) => connectedAccountIds.has(f.accountId))
    .map((f) => ({ f, age: nowMs - Date.parse(f.fetchedAt) }))
    .filter(({ age }) => Number.isFinite(age) && age >= 0 && age <= PROOF_MAX_PUBLIC_AGE_MS)
    .sort(
      (a, b) =>
        (PLATFORM_ORDER[a.f.platform] ?? 9) - (PLATFORM_ORDER[b.f.platform] ?? 9) ||
        a.f.key.localeCompare(b.f.key),
    )
    .map(({ f, age }) => ({
      key: f.key,
      platform: f.platform,
      label: f.label,
      value: f.value,
      accountLabel: f.accountLabel,
      updatedAt: f.fetchedAt,
      stale: age > PROOF_FRESH_MS,
    }));
}

export function isProofStale(refreshedAt: Date | null | undefined, nowMs: number): boolean {
  if (!refreshedAt) return true;
  return nowMs - refreshedAt.getTime() > PROOF_FRESH_MS;
}

/* ── DB layer ──────────────────────────────────────────────────────────── */

async function profileIdForUser(userId: string): Promise<string | null> {
  const [profile] = await db
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return profile?.id ?? null;
}

async function accountsForUser(userId: string): Promise<ProofAccount[]> {
  return db
    .select({
      id: socialAccountsTable.id,
      platform: socialAccountsTable.platform,
      username: socialAccountsTable.username,
      page_name: socialAccountsTable.page_name,
      page_id: socialAccountsTable.page_id,
      access_token_encrypted: socialAccountsTable.access_token_encrypted,
      refresh_token_encrypted: socialAccountsTable.refresh_token_encrypted,
      token_expires_at: socialAccountsTable.token_expires_at,
    })
    .from(socialAccountsTable)
    .where(eq(socialAccountsTable.user_id, userId));
}

export interface OwnerProofFigure extends SocialProofFigure {
  /** Creator's switch: false = hidden everywhere, for everyone. */
  visible: boolean;
  /** False once the source account is disconnected (figure retired). */
  connected: boolean;
}

export interface OwnerProofState {
  hasProfile: boolean;
  figures: OwnerProofFigure[];
  hiddenKeys: string[];
  refreshedAt: string | null;
  stale: boolean;
  connectedPlatforms: string[];
}

export async function getOwnerProofState(userId: string): Promise<OwnerProofState> {
  const [profileId, accounts] = await Promise.all([
    profileIdForUser(userId),
    accountsForUser(userId),
  ]);
  const connectedPlatforms = [...new Set(accounts.map((a) => a.platform))];
  if (!profileId) {
    return {
      hasProfile: false,
      figures: [],
      hiddenKeys: [],
      refreshedAt: null,
      stale: true,
      connectedPlatforms,
    };
  }
  const [row] = await db
    .select()
    .from(creatorSocialProofTable)
    .where(eq(creatorSocialProofTable.profileId, profileId))
    .limit(1);
  const connectedIds = new Set(accounts.map((a) => a.id));
  const hidden = new Set(row?.hiddenKeys ?? []);
  return {
    hasProfile: true,
    figures: (row?.figures ?? []).map((f) => ({
      ...f,
      visible: !hidden.has(f.key),
      connected: connectedIds.has(f.accountId),
    })),
    hiddenKeys: row?.hiddenKeys ?? [],
    refreshedAt: row?.refreshedAt ? row.refreshedAt.toISOString() : null,
    stale: isProofStale(row?.refreshedAt ?? null, Date.now()),
    connectedPlatforms,
  };
}

/**
 * One refresh pass: fetch every connected account live (through the
 * injected analytics fetcher), merge honestly, persist. Per-account
 * failures never fail the pass — they keep their old figures. Returns
 * the new owner state, or null when the user has no creator profile.
 */
export async function refreshSocialProof(
  userId: string,
  fetchOverview: ProofOverviewFetcher,
): Promise<OwnerProofState | null> {
  const profileId = await profileIdForUser(userId);
  if (!profileId) return null;
  const accounts = await accountsForUser(userId);
  const [existing] = await db
    .select()
    .from(creatorSocialProofTable)
    .where(eq(creatorSocialProofTable.profileId, profileId))
    .limit(1);

  const freshByAccount = new Map<string, SocialProofFigure[] | null>();
  for (const account of accounts) {
    try {
      const overview = await fetchOverview(account);
      if (overview.status === "ok" && overview.stats) {
        freshByAccount.set(
          account.id,
          figuresFromStats(
            account.platform,
            account,
            overview.stats,
            overview.fetchedAt ?? new Date().toISOString(),
          ),
        );
      } else if (overview.status === "ok") {
        /* Answered but no stats payload — retire, don't carry forward. */
        freshByAccount.set(account.id, []);
      } else {
        freshByAccount.set(account.id, null);
      }
    } catch (err) {
      logger.warn({ err, platform: account.platform }, "[social-proof] account fetch failed");
      freshByAccount.set(account.id, null);
    }
  }

  const merged = mergeFigures(
    existing?.figures ?? [],
    freshByAccount,
    new Set(accounts.map((a) => a.id)),
  );
  const now = new Date();
  await db
    .insert(creatorSocialProofTable)
    .values({
      profileId,
      userId,
      figures: merged,
      hiddenKeys: existing?.hiddenKeys ?? [],
      refreshedAt: now,
    })
    .onConflictDoUpdate({
      target: creatorSocialProofTable.profileId,
      set: { figures: merged, refreshedAt: now, updatedAt: now },
    });
  return getOwnerProofState(userId);
}

/* In-flight guard: a public profile under traffic must not stampede the
   providers — one background refresh per creator at a time. */
const refreshInFlight = new Set<string>();

export function maybeRefreshSocialProof(
  userId: string,
  fetchOverview: ProofOverviewFetcher,
): void {
  if (refreshInFlight.has(userId)) return;
  refreshInFlight.add(userId);
  void (async () => {
    try {
      const state = await getOwnerProofState(userId);
      if (state.hasProfile && state.stale) {
        await refreshSocialProof(userId, fetchOverview);
      }
    } catch (err) {
      logger.warn({ err }, "[social-proof] background refresh failed (non-fatal)");
    } finally {
      refreshInFlight.delete(userId);
    }
  })();
}

/**
 * Public profile read path: shaped figures from cache ONLY (no provider
 * calls on a page view). When the cache is stale and a fetcher is
 * supplied, a background refresh is kicked so the NEXT read is fresh.
 */
export async function getPublicSocialProof(
  profileId: string,
  userId: string,
  fetchOverview?: ProofOverviewFetcher,
): Promise<PublicProofFigure[]> {
  const [row, accounts] = await Promise.all([
    db
      .select()
      .from(creatorSocialProofTable)
      .where(eq(creatorSocialProofTable.profileId, profileId))
      .limit(1)
      .then((r) => r[0]),
    accountsForUser(userId),
  ]);
  if (!row) {
    /* Never measured yet — kick a first background pass if we can, and
       show nothing rather than anything unverified. */
    if (fetchOverview && accounts.length > 0) maybeRefreshSocialProof(userId, fetchOverview);
    return [];
  }
  if (fetchOverview && isProofStale(row.refreshedAt, Date.now())) {
    maybeRefreshSocialProof(userId, fetchOverview);
  }
  return shapePublicProof(
    row.figures ?? [],
    row.hiddenKeys ?? [],
    new Set(accounts.map((a) => a.id)),
    Date.now(),
  );
}

/** Persist the creator's per-figure off switch. Keys are validated
    against the figure catalog — unknown keys are refused, not stored. */
export async function setProofHiddenKeys(
  userId: string,
  hiddenKeys: string[],
): Promise<OwnerProofState | null> {
  const profileId = await profileIdForUser(userId);
  if (!profileId) return null;
  const clean = [...new Set(hiddenKeys)].filter((k) => KNOWN_FIGURE_KEYS.has(k));
  const now = new Date();
  await db
    .insert(creatorSocialProofTable)
    .values({ profileId, userId, figures: [], hiddenKeys: clean })
    .onConflictDoUpdate({
      target: creatorSocialProofTable.profileId,
      set: { hiddenKeys: clean, updatedAt: now },
    });
  return getOwnerProofState(userId);
}
