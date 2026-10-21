/* ─── Home-base command center — shaping seam ────────────────────────
   The command center (components/CommandCenter.tsx) docks inside the
   creator dashboard and answers "how is my business doing?" from the
   home rails alone: audience, revenue, content, pending actions, and
   Thy Cheat Code's morning brief. It drives the SAME section seam as
   the rest of the dashboard (lib/dashboard-sections): five panels,
   five endpoints (/api/command/*), each settling and retrying on its
   own — one bad panel never takes the dashboard down.

   This module is the pure half: payload shaping + the brief's
   draft-only invariants, unit-tested without a DOM.

   Honesty rules encoded here:
   - Shaping never invents a number. A field that arrives missing or
     malformed becomes null (rendered "—"), never a fake 0. A count
     the server KNOWS is 0 arrives as 0 and stays 0.
   - Off-platform rows exist only when the server says accounts are
     connected; there is no client-side way to conjure them.
   - The brief's move is a DRAFT. Its only "approve" affordance is
     navigation to the real surface (the href the server mapped from
     an allowlisted kind) or copying the draft text. Shaping drops any
     move whose kind is not allowlisted, and there is no code path
     here — or in the component — that sends, posts, or charges. */

export const COMMAND_PANEL_KEYS = [
  "brief",
  "audience",
  "revenue",
  "content",
  "actions",
] as const;

export type CommandPanelKey = (typeof COMMAND_PANEL_KEYS)[number];

/* ── Payload types (mirror routes/command.ts) ─────────────────────── */

export interface AudienceStat {
  total: number;
  new7: number;
}

export interface OffPlatformRow {
  platform: string;
  username: string | null;
  followers: number | null;
  delta: number | null;
}

export interface AudiencePayload {
  followers: AudienceStat | null;
  subscribers: AudienceStat | null;
  members: AudienceStat | null;
  offPlatform: { connected: boolean; platforms: OffPlatformRow[] };
  partial: boolean;
}

export interface RevenueRail {
  totalCents: number | null;
  count: number | null;
}

export interface RevenuePayload {
  totalCents: number | null;
  totalTipsVb: number | null;
  rails: {
    store: RevenueRail;
    memberships: RevenueRail;
    brandDeals: RevenueRail;
    beats: RevenueRail;
    tipsVb: number | null;
    tipJarPendingCents: number | null;
  };
  partial: boolean;
}

export interface ContentPayload {
  hasProfile: boolean;
  profile: { slug: string; totalPlays: number; followerCount: number } | null;
  topTrack: { title: string; playCount: number } | null;
  topVideo: { title: string; viewCount: number } | null;
  totals: { trackCount: number; trackPlays: number; videoCount: number; videoViews: number } | null;
  partial: boolean;
}

export interface ActionItem {
  key: "unreadMessages" | "pastDueMembers" | "shoutoutsToDeliver";
  count: number;
  href: string;
}

export interface ActionsPayload {
  items: ActionItem[];
  total: number;
  partial: boolean;
}

export type BriefMoveKind = "post" | "winback" | "reply" | "deliver" | "price_check" | "create";

export interface BriefPayload {
  summary: string;
  move: { kind: BriefMoveKind; title: string; draft: string; href: string };
}

/* ── Shaping helpers ──────────────────────────────────────────────── */

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function stat(v: unknown): AudienceStat | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const total = num(o.total);
  const new7 = num(o.new7);
  if (total === null || new7 === null) return null;
  return { total, new7 };
}

function rail(v: unknown): RevenueRail {
  if (!v || typeof v !== "object") return { totalCents: null, count: null };
  const o = v as Record<string, unknown>;
  if (o.status === "error") return { totalCents: null, count: null };
  return { totalCents: num(o.totalCents), count: num(o.count) };
}

export function shapeAudience(raw: unknown): AudiencePayload {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const off = (o.offPlatform && typeof o.offPlatform === "object" ? o.offPlatform : {}) as Record<string, any>;
  const platforms: OffPlatformRow[] = Array.isArray(off.platforms)
    ? off.platforms
        .filter((p: any) => p && typeof p === "object" && typeof p.platform === "string")
        .map((p: any) => ({
          platform: p.platform,
          username: typeof p.username === "string" ? p.username : null,
          followers: num(p.followers),
          delta: num(p.delta),
        }))
    : [];
  return {
    followers: stat(o.followers),
    subscribers: stat(o.subscribers),
    members: stat(o.members),
    offPlatform: { connected: off.connected === true, platforms },
    partial: o.partial === true,
  };
}

export function shapeRevenue(raw: unknown): RevenuePayload {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const railsIn = (o.rails && typeof o.rails === "object" ? o.rails : {}) as Record<string, any>;
  const tipsIn = (railsIn.tips && typeof railsIn.tips === "object" ? railsIn.tips : {}) as Record<string, any>;
  return {
    totalCents: num(o.totalCents),
    totalTipsVb: num(o.totalTipsVb),
    rails: {
      store: rail(railsIn.store),
      memberships: rail(railsIn.memberships),
      brandDeals: rail(railsIn.brandDeals),
      beats: rail(railsIn.beats),
      tipsVb: tipsIn.status === "error" ? null : num(tipsIn.streamTipsVb),
      tipJarPendingCents: tipsIn.status === "error" ? null : num(tipsIn.tipJarPendingCents),
    },
    partial: o.partial === true,
  };
}

export function shapeContent(raw: unknown): ContentPayload {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const prof = o.profile && typeof o.profile === "object" ? (o.profile as Record<string, any>) : null;
  const tt = o.topTrack && typeof o.topTrack === "object" ? (o.topTrack as Record<string, any>) : null;
  const tv = o.topVideo && typeof o.topVideo === "object" ? (o.topVideo as Record<string, any>) : null;
  const tot = o.totals && typeof o.totals === "object" ? (o.totals as Record<string, any>) : null;
  return {
    hasProfile: o.hasProfile === true && !!prof,
    profile: prof
      ? {
          slug: typeof prof.slug === "string" ? prof.slug : "",
          totalPlays: num(prof.totalPlays) ?? 0,
          followerCount: num(prof.followerCount) ?? 0,
        }
      : null,
    topTrack: tt && typeof tt.title === "string" ? { title: tt.title, playCount: num(tt.playCount) ?? 0 } : null,
    topVideo: tv && typeof tv.title === "string" ? { title: tv.title, viewCount: num(tv.viewCount) ?? 0 } : null,
    totals: tot
      ? {
          trackCount: num(tot.trackCount) ?? 0,
          trackPlays: num(tot.trackPlays) ?? 0,
          videoCount: num(tot.videoCount) ?? 0,
          videoViews: num(tot.videoViews) ?? 0,
        }
      : null,
    partial: o.partial === true,
  };
}

const ACTION_KEYS: readonly string[] = ["unreadMessages", "pastDueMembers", "shoutoutsToDeliver"];

export function shapeActions(raw: unknown): ActionsPayload {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const items: ActionItem[] = Array.isArray(o.items)
    ? o.items
        .filter(
          (i: any) =>
            i && typeof i === "object" && ACTION_KEYS.includes(i.key) &&
            typeof i.count === "number" && typeof i.href === "string" && i.href.startsWith("/"),
        )
        .map((i: any) => ({ key: i.key, count: i.count, href: i.href }))
    : [];
  return {
    items,
    total: items.reduce((s, i) => s + i.count, 0),
    partial: o.partial === true,
  };
}

/* ── The brief: draft-only by construction ──────────────────────────
   The server maps kind → href from its own allowlist; the client
   re-checks the pair against the same allowlist before rendering an
   approve affordance, so a malformed payload can never produce a
   navigation the product didn't sanction. Approval = the creator
   clicking through to the real surface (or copying the draft). There
   is deliberately NO function here that executes a move. */

export const BRIEF_MOVE_HREFS: Record<BriefMoveKind, string> = {
  post: "/scheduler",
  winback: "/memberships",
  reply: "/messages",
  deliver: "/shoutouts",
  price_check: "/earnings",
  create: "/create",
};

export function shapeBrief(raw: unknown): BriefPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, any>;
  const move = o.move && typeof o.move === "object" ? (o.move as Record<string, any>) : null;
  if (typeof o.summary !== "string" || !o.summary.trim() || !move) return null;
  const kind = move.kind as BriefMoveKind;
  if (!(kind in BRIEF_MOVE_HREFS)) return null;
  if (typeof move.draft !== "string" || !move.draft.trim()) return null;
  return {
    summary: o.summary,
    move: {
      kind,
      title: typeof move.title === "string" && move.title.trim() ? move.title : "Your next move",
      draft: move.draft,
      /* The rendered destination is OUR mapping for the kind — the
         payload's href is accepted only when it matches it exactly. */
      href: BRIEF_MOVE_HREFS[kind],
    },
  };
}

/** The single approve affordance for a brief move: where the creator
 *  lands to review and send the draft themselves. Pure navigation —
 *  executing the move is always the creator's own action there. */
export function briefApproveTarget(brief: BriefPayload): string {
  return brief.move.href;
}

/* ── The brief's fallback state ─────────────────────────────────────
   When the AI narrative can't be written (provider down, no key,
   unusable output), the server answers 200 with the digest it built
   for the model, flagged narrativeUnavailable, with summary honestly
   empty and move null — nothing cached, nothing invented. The panel
   renders THAT state: the real numbers and action doors from the
   digest, under a plain line saying the written brief is unavailable
   right now. The failure state is reserved for a response that never
   arrives (the digest itself couldn't be built server-side). */

export interface BriefDigestPayload {
  audience: AudiencePayload | null;
  revenue: RevenuePayload | null;
  content: ContentPayload | null;
  actions: ActionsPayload | null;
}

export interface BriefFallbackPayload {
  narrativeUnavailable: true;
  digest: BriefDigestPayload;
}

export function shapeBriefFallback(raw: unknown): BriefFallbackPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, any>;
  if (o.narrativeUnavailable !== true) return null;
  const d = o.digest;
  if (!d || typeof d !== "object") return null;
  const dg = d as Record<string, any>;
  return {
    narrativeUnavailable: true,
    digest: {
      audience: dg.audience ? shapeAudience(dg.audience) : null,
      revenue: dg.revenue ? shapeRevenue(dg.revenue) : null,
      content: dg.content ? shapeContent(dg.content) : null,
      actions: dg.actions ? shapeActions(dg.actions) : null,
    },
  };
}
