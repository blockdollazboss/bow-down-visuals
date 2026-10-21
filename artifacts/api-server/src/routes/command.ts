import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { storeSales, memberships, brandDeals, tips } from "./earnings";

/* ─── Home-base command view (Competitor program, social-platforms C3) ──
   One morning surface over the creator's HOME business, docked inside
   the creator dashboard. Five panels, five endpoints, so the dashboard
   resilience law holds end to end: each panel settles and retries on
   its own, and one panel's failure never blanks the others.

   Honesty contract (the earnings route's discipline, extended):
   - Every panel is built from REAL in-tree sources only — the same
     ledger readers /api/earnings uses (imported, never re-queried in
     parallel), plus follows, email subscribers, fan members, profile
     content, DMs, shoutout requests, and connected-account snapshots.
   - A source with no rows reads 0 / empty with status "ok". A source
     whose query fails reads status "error" with null numbers — never
     a fake 0 — and the panel carries partial: true. A panel answers
     500 ONLY when every one of its primary sources failed, so the
     client renders that panel's own failure note (never a page
     takeover, never a fake-empty panel).
   - Revenue is ALL-TIME per rail, exactly as /api/earnings reports it
     — these builders carry no period windows, so nothing here may be
     phrased as "this week / this month" revenue. Audience growth DOES
     carry a real 7-day window (created_at comparisons), and only the
     audience numbers are ever described as growth.
   - Off-platform numbers come ONLY from social_stat_snapshots — rows
     written by the analytics overview from the creator's own connected
     accounts. No connected account → no off-platform rows at all.
     Nothing is scraped; nothing is estimated.
   - The brief is a DRAFT, by construction: the endpoint is a GET, it
     writes nothing, calls no action rail, and its "next best move"
     href is mapped server-side from an allowlisted kind — the model
     cannot invent a destination, and approving the move is the
     creator's own click into the real surface. */

const router = Router();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const weekAgo = () => new Date(Date.now() - WEEK_MS);

/* A panel's primary sources ALL failed: the panel itself failed. */
class PanelFailedError extends Error {}

type SourceStatus = "ok" | "error";

async function settleSource<T>(
  panel: string,
  name: string,
  userId: string,
  fn: () => Promise<T>,
): Promise<{ status: SourceStatus; value: T | null }> {
  try {
    return { status: "ok", value: await fn() };
  } catch (err) {
    logger.error({ err, userId, panel, source: name }, "[command] source failed");
    return { status: "error", value: null };
  }
}

function rowsOf(r: unknown): any[] {
  return ((r as { rows?: any[] }).rows ?? []) as any[];
}

/* ─── AUDIENCE ───────────────────────────────────────────────────────
   Followers (follows → the creator's profiles), email subscribers
   (their lists, still subscribed), members (fan_members owned by the
   creator, active/trialing). Growth = rows created in the last 7 days.
   Off-platform: latest follower snapshot per connected platform plus
   the delta against the previous snapshot — real rows only. */

export async function commandAudience(userId: string) {
  const since = weekAgo();

  const followers = await settleSource("audience", "followers", userId, async () => {
    const r = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN f.created_at >= ${since} THEN 1 ELSE 0 END), 0)::int AS new7
      FROM follows f
      JOIN creator_profiles cp ON cp.id = f.profile_id
      WHERE cp.user_id = ${userId}
    `);
    const row = rowsOf(r)[0] ?? { total: 0, new7: 0 };
    return { total: Number(row.total), new7: Number(row.new7) };
  });

  const subscribers = await settleSource("audience", "subscribers", userId, async () => {
    const r = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN s.subscribed_at >= ${since} THEN 1 ELSE 0 END), 0)::int AS new7
      FROM email_subscribers s
      JOIN email_lists l ON l.id = s.list_id
      WHERE l.user_id = ${userId} AND s.unsubscribed_at IS NULL
    `);
    const row = rowsOf(r)[0] ?? { total: 0, new7: 0 };
    return { total: Number(row.total), new7: Number(row.new7) };
  });

  const members = await settleSource("audience", "members", userId, async () => {
    const r = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN joined_at >= ${since} THEN 1 ELSE 0 END), 0)::int AS new7
      FROM fan_members
      WHERE user_id = ${userId} AND status IN ('active', 'trialing')
    `);
    const row = rowsOf(r)[0] ?? { total: 0, new7: 0 };
    return { total: Number(row.total), new7: Number(row.new7) };
  });

  /* Auxiliary: off-platform presence. Its failure can only mark the
     panel partial — it never fails the panel. */
  const offPlatform = await settleSource("audience", "offPlatform", userId, async () => {
    const accounts = rowsOf(await db.execute(sql`
      SELECT platform, username FROM social_accounts WHERE user_id = ${userId}
    `));
    if (accounts.length === 0) return { connected: false, platforms: [] as any[] };
    const snaps = rowsOf(await db.execute(sql`
      SELECT platform, followers, recorded_at
      FROM social_stat_snapshots
      WHERE user_id = ${userId} AND followers IS NOT NULL
      ORDER BY recorded_at DESC
      LIMIT 100
    `));
    const byPlatform = new Map<string, number[]>();
    for (const s of snaps) {
      const list = byPlatform.get(s.platform) ?? [];
      if (list.length < 2) list.push(Number(s.followers));
      byPlatform.set(s.platform, list);
    }
    return {
      connected: true,
      platforms: accounts.map((a) => {
        const list = byPlatform.get(a.platform) ?? [];
        const followers = list.length > 0 ? list[0]! : null;
        const delta = list.length > 1 ? list[0]! - list[1]! : null;
        return { platform: a.platform, username: a.username ?? null, followers, delta };
      }),
    };
  });

  const sources = {
    followers: followers.status,
    subscribers: subscribers.status,
    members: members.status,
    offPlatform: offPlatform.status,
  };
  if (followers.status === "error" && subscribers.status === "error" && members.status === "error") {
    throw new PanelFailedError("audience");
  }
  return {
    followers: followers.value,
    subscribers: subscribers.value,
    members: members.value,
    offPlatform: offPlatform.value ?? { connected: false, platforms: [] },
    sources,
    partial: Object.values(sources).some((s) => s === "error"),
  };
}

/* ─── REVENUE ────────────────────────────────────────────────────────
   The earnings readers, imported — one money picture, never a parallel
   query — plus the beats rail (completed licenses, net of commission),
   which /api/earnings does not carry. All-time per rail. Tips stay in
   Visual Bucs and are NEVER folded into the USD total. */

export async function beatsRail(userId: string) {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(price_cents - commission_cents), 0)::int AS cents, COUNT(*)::int AS n
    FROM beat_licenses
    WHERE producer_id = ${userId} AND status = 'completed'
  `);
  const row = rowsOf(r)[0] ?? { cents: 0, n: 0 };
  return { status: "ok" as const, totalCents: Number(row.cents), count: Number(row.n) };
}

export async function commandRevenue(userId: string) {
  const store = await settleSource("revenue", "storeSales", userId, () => storeSales(userId));
  const memb = await settleSource("revenue", "memberships", userId, () => memberships(userId));
  const deals = await settleSource("revenue", "brandDeals", userId, () => brandDeals(userId));
  const beats = await settleSource("revenue", "beats", userId, () => beatsRail(userId));
  const tip = await settleSource("revenue", "tips", userId, () => tips(userId));

  const rails = {
    store: store.value,
    memberships: memb.value,
    brandDeals: deals.value,
    beats: beats.value,
    tips: tip.value,
  };
  const sources = {
    store: store.status,
    memberships: memb.status,
    brandDeals: deals.status,
    beats: beats.status,
    tips: tip.status,
  };
  if (Object.values(sources).every((s) => s === "error")) {
    throw new PanelFailedError("revenue");
  }
  /* The USD total sums only the rails that loaded — with partial: true
     the client labels it a floor, exactly as /api/earnings does. */
  const totalCents =
    (store.value?.totalCents ?? 0) +
    (memb.value?.totalCents ?? 0) +
    (deals.value?.totalCents ?? 0) +
    (beats.value?.totalCents ?? 0);
  return {
    totalCents,
    totalTipsVb: tip.value?.streamTipsVb ?? null,
    rails,
    sources,
    partial: Object.values(sources).some((s) => s === "error"),
  };
}

/* ─── CONTENT ────────────────────────────────────────────────────────
   The creator's stage: profile totals plus their top track and top
   video by the play/view counts the profile rails already keep.
   No profile yet is an honest ABSENT, not an error and not zeros. */

export async function commandContent(userId: string) {
  const profile = await settleSource("content", "profile", userId, async () => {
    const r = await db.execute(sql`
      SELECT id, slug, total_plays, follower_count
      FROM creator_profiles
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
      LIMIT 1
    `);
    const row = rowsOf(r)[0];
    if (!row) return null;
    return {
      id: row.id as string,
      slug: row.slug as string,
      totalPlays: Number(row.total_plays ?? 0),
      followerCount: Number(row.follower_count ?? 0),
    };
  });
  if (profile.status === "error") throw new PanelFailedError("content");
  if (!profile.value) {
    return { hasProfile: false, profile: null, topTrack: null, topVideo: null, totals: null, partial: false };
  }
  const profileId = profile.value.id;

  const topTrack = await settleSource("content", "topTrack", userId, async () => {
    const r = await db.execute(sql`
      SELECT title, play_count FROM profile_tracks
      WHERE profile_id = ${profileId}
      ORDER BY play_count DESC, created_at DESC
      LIMIT 1
    `);
    const row = rowsOf(r)[0];
    return row ? { title: row.title as string, playCount: Number(row.play_count ?? 0) } : null;
  });
  const topVideo = await settleSource("content", "topVideo", userId, async () => {
    const r = await db.execute(sql`
      SELECT title, view_count FROM profile_videos
      WHERE profile_id = ${profileId}
      ORDER BY view_count DESC, created_at DESC
      LIMIT 1
    `);
    const row = rowsOf(r)[0];
    return row ? { title: row.title as string, viewCount: Number(row.view_count ?? 0) } : null;
  });
  const totals = await settleSource("content", "totals", userId, async () => {
    const t = rowsOf(await db.execute(sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(play_count), 0)::int AS plays
      FROM profile_tracks WHERE profile_id = ${profileId}
    `))[0] ?? { n: 0, plays: 0 };
    const v = rowsOf(await db.execute(sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(view_count), 0)::int AS views
      FROM profile_videos WHERE profile_id = ${profileId}
    `))[0] ?? { n: 0, views: 0 };
    return {
      trackCount: Number(t.n), trackPlays: Number(t.plays),
      videoCount: Number(v.n), videoViews: Number(v.views),
    };
  });

  return {
    hasProfile: true,
    profile: profile.value,
    topTrack: topTrack.value,
    topVideo: topVideo.value,
    totals: totals.value,
    partial: topTrack.status === "error" || topVideo.status === "error" || totals.status === "error",
  };
}

/* ─── ACTIONS ────────────────────────────────────────────────────────
   What needs the creator's hand today, counted from the queues that
   actually exist: unread DMs, past-due members, shoutouts waiting to
   be delivered. (Store orders carry no pending queue — they complete
   at purchase with per-kind fulfillment notes — so no order item is
   invented here.) A failed count is omitted + partial, never a 0. */

export async function commandActions(userId: string) {
  const unread = await settleSource("actions", "unreadMessages", userId, async () => {
    const r = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE (c.participant_a = ${userId} OR c.participant_b = ${userId})
        AND m.sender_user_id <> ${userId}
        AND m.is_read = false
    `);
    return Number(rowsOf(r)[0]?.n ?? 0);
  });
  const pastDue = await settleSource("actions", "pastDueMembers", userId, async () => {
    const r = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM fan_members
      WHERE user_id = ${userId} AND status = 'past_due'
    `);
    return Number(rowsOf(r)[0]?.n ?? 0);
  });
  const shoutouts = await settleSource("actions", "shoutoutsToDeliver", userId, async () => {
    const r = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM shoutout_requests
      WHERE creator_user_id = ${userId} AND status IN ('accepted', 'in_progress')
    `);
    return Number(rowsOf(r)[0]?.n ?? 0);
  });

  const sources = {
    unreadMessages: unread.status,
    pastDueMembers: pastDue.status,
    shoutoutsToDeliver: shoutouts.status,
  };
  if (Object.values(sources).every((s) => s === "error")) {
    throw new PanelFailedError("actions");
  }
  const items: { key: string; count: number; href: string }[] = [];
  if (unread.value !== null) items.push({ key: "unreadMessages", count: unread.value, href: "/messages" });
  if (pastDue.value !== null) items.push({ key: "pastDueMembers", count: pastDue.value, href: "/memberships" });
  if (shoutouts.value !== null) items.push({ key: "shoutoutsToDeliver", count: shoutouts.value, href: "/shoutouts" });
  return {
    items,
    total: items.reduce((s, i) => s + i.count, 0),
    sources,
    partial: Object.values(sources).some((s) => s === "error"),
  };
}

/* ─── BRIEF ──────────────────────────────────────────────────────────
   Thy Cheat Code's morning brief: a plain-words summary of what the
   panels actually say, plus ONE next best move, drafted for the
   creator to approve. The move's destination is mapped HERE from an
   allowlisted kind — the model's href is never trusted — and nothing
   in this endpoint sends, posts, charges, or writes. */

export const COMMAND_MOVE_HREFS: Record<string, string> = {
  post: "/scheduler",
  winback: "/memberships",
  reply: "/messages",
  deliver: "/shoutouts",
  price_check: "/earnings",
  create: "/create",
};
export const COMMAND_MOVE_KINDS = Object.keys(COMMAND_MOVE_HREFS);

export async function buildCommandDigest(userId: string) {
  const [audience, revenue, content, actions] = await Promise.all([
    commandAudience(userId).catch(() => null),
    commandRevenue(userId).catch(() => null),
    commandContent(userId).catch(() => null),
    commandActions(userId).catch(() => null),
  ]);
  return { audience, revenue, content, actions };
}

function panelRoute(
  path: string,
  build: (userId: string) => Promise<unknown>,
) {
  router.get(path, requireAuth, async (req, res) => {
    try {
      res.json(await build(req.userId!));
    } catch (err) {
      if (err instanceof PanelFailedError) {
        res.status(500).json({ error: "command_panel_failed", panel: path });
        return;
      }
      logger.error({ err, userId: req.userId, panel: path }, "[command] panel failed");
      res.status(500).json({ error: "command_panel_failed", panel: path });
    }
  });
}

panelRoute("/command/audience", commandAudience);
panelRoute("/command/revenue", commandRevenue);
panelRoute("/command/content", commandContent);
panelRoute("/command/actions", commandActions);

router.get("/command/brief", requireAuth, async (req, res) => {
  const userId = req.userId!;
  /* Resilience contract (dashboard law, extended to this panel): the
     digest is built FIRST because it is both the model's evidence and
     the fallback payload. The written narrative is the only part of
     this panel the AI provider can kill — when it fails (no key,
     provider error, unusable output) the panel serves the digest
     itself, flagged narrativeUnavailable, instead of failing. The
     endpoint answers an error ONLY when the digest itself cannot be
     built at all: the build threw, or every panel inside it failed,
     leaving no real data to show. */
  let digest: Awaited<ReturnType<typeof buildCommandDigest>>;
  try {
    digest = await buildCommandDigest(userId);
  } catch (err) {
    logger.error({ err, userId }, "[command] brief digest failed");
    res.status(502).json({ error: "brief_unavailable" });
    return;
  }
  if (!digest.audience && !digest.revenue && !digest.content && !digest.actions) {
    res.status(502).json({ error: "brief_unavailable" });
    return;
  }

  let completion;
  try {
    completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are Thy Cheat Code, the operator of Bow Down Visuals, giving ONE creator their " +
            "morning brief on their OWN business at home. Ground every claim in the digest JSON — " +
            "never invent numbers, names, sales, or events that are not in it. Revenue figures in " +
            "the digest are ALL-TIME totals: phrase them as totals, never as weekly or monthly " +
            "gains. Audience new7 figures are real 7-day growth and may be called this week's " +
            "growth. Tips are Visual Bucs, a separate unit from dollars — never add them together. " +
            "A null panel or a source marked partial means that data could not load: do not quote " +
            "numbers from it. If the digest shows a brand-new creator (no profile, no audience, no " +
            "revenue), say so warmly and make the move kind \"create\". " +
            "Write the summary in at most 3 short, plain sentences. Then choose the SINGLE next " +
            "best move from these kinds only: post (draft a post announcing or promoting something " +
            "real in the digest), winback (draft a short message to past-due members — only when " +
            "pastDueMembers > 0), reply (the creator has unread messages — only when " +
            "unreadMessages > 0), deliver (shoutouts waiting — only when shoutoutsToDeliver > 0), " +
            "price_check (look at pricing/earnings), create (make something new). For post, " +
            "winback, and reply, the draft is the actual ready-to-use message text, written in " +
            "the creator's voice, short enough to post as-is. For the other kinds, the draft is " +
            "the concrete first step in one or two sentences. The draft is a DRAFT: the creator " +
            "reviews and sends it themselves; never write as if you already sent or posted " +
            "anything. Respond ONLY with JSON: " +
            '{ "summary": "<the brief>", "move": { "kind": "<kind>", "title": "<short move title>", "draft": "<the draft>" } }.',
        },
        { role: "user", content: JSON.stringify(digest) },
      ],
    });
  } catch (err) {
    logger.error({ err, userId }, "[command] brief generation failed");
    completion = null;
  }

  const text = completion?.choices[0]?.message?.content ?? "";
  let parsed: { summary?: unknown; move?: { kind?: unknown; title?: unknown; draft?: unknown } } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    const stripped = text.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
    try { parsed = JSON.parse(stripped); } catch { parsed = {}; }
  }
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 600) : "";
  const kind = typeof parsed.move?.kind === "string" && COMMAND_MOVE_KINDS.includes(parsed.move.kind)
    ? parsed.move.kind
    : "create";
  const title = typeof parsed.move?.title === "string" && parsed.move.title.trim()
    ? parsed.move.title.trim().slice(0, 120)
    : "Your next move";
  const draft = typeof parsed.move?.draft === "string" ? parsed.move.draft.trim().slice(0, 1000) : "";
  if (!summary || !draft) {
    /* The narrative couldn't be written — provider down, no key, or
       output we can't use. Serve the digest itself, flagged, rather
       than failing the panel: summary stays honestly empty, move is
       null (no draft exists), and the client renders the real numbers
       and doors from the digest. Nothing here is cached or invented —
       this response is built from this request's own digest. */
    res.json({
      summary: "",
      move: null,
      digest,
      generatedAt: new Date().toISOString(),
      narrativeUnavailable: true,
    });
    return;
  }
  res.json({
    summary,
    move: { kind, title, draft, href: COMMAND_MOVE_HREFS[kind]! },
    generatedAt: new Date().toISOString(),
  });
});

export default router;
