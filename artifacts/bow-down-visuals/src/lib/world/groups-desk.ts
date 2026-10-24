/* ─── Groups + group forums in-world (stack-100 items 76 + 77) ─────
   The Community Hall's groups desk rides the SAME rails the 2D
   groups pages ride (artifacts/api-server/src/routes/community.ts,
   mounted at the router root — so the paths are /api/groups/*, the
   exact strings pages/groups.tsx and pages/group-detail.tsx call):

     GET    /api/groups?q= · ?member=<user_id>
     POST   /api/groups                                (create; creator = owner)
     GET    /api/groups/:slug                          (detail + viewer_role)
     POST   /api/groups/:slug/join · /leave
     GET    /api/groups/:slug/feed                     (posts + viewer_role)
     POST   /api/groups/:slug/posts                    (members only)
     DELETE /api/groups/:slug/posts/:postId            (owner/mod/author — rail decides)
     GET    /api/groups/:slug/forum/channels           (+ viewer caps)
     POST   /api/groups/:slug/forum/channels           (admin+ — rail decides)
     DELETE /api/groups/:slug/forum/channels/:id       (admin+)
     GET    /api/groups/:slug/forum/channels/:id/threads
     POST   /api/groups/:slug/forum/channels/:id/threads (members only)
     GET    /api/groups/:slug/forum/threads/:id        (thread + replies + caps)
     POST   /api/groups/:slug/forum/threads/:id/replies
     PATCH  /api/groups/:slug/forum/threads/:id        (pin/lock — moderator+)
     DELETE /api/groups/:slug/forum/threads/:id        (mod/author)
     DELETE /api/groups/:slug/forum/threads/:id/replies/:replyId (mod/author)

   Permission law: the rail computes everything — viewer_role on the
   group reads, can_post / can_moderate / can_manage_channels on the
   forum reads, can_delete per post/thread/reply. The desk SHOWS a
   verb only where the rail's own fields say the member may use it,
   and the server re-enforces on every call regardless. Guests get
   the public browse the rail itself allows (public groups only —
   the list route filters private groups out for non-members) and an
   honest sign-in pitch instead of dead join/post buttons. */

export const GROUPS_PATH = "/api/groups";

export function groupsSearchPath(query: string): string {
  const q = query.trim();
  return q ? `${GROUPS_PATH}?q=${encodeURIComponent(q)}` : GROUPS_PATH;
}

export function groupsMinePath(userId: string): string {
  return `${GROUPS_PATH}?member=${encodeURIComponent(userId)}`;
}

export function groupPath(slug: string): string {
  return `${GROUPS_PATH}/${encodeURIComponent(slug)}`;
}

export function groupJoinPath(slug: string): string {
  return `${groupPath(slug)}/join`;
}

export function groupLeavePath(slug: string): string {
  return `${groupPath(slug)}/leave`;
}

export function groupFeedPath(slug: string): string {
  return `${groupPath(slug)}/feed`;
}

export function groupPostsPath(slug: string): string {
  return `${groupPath(slug)}/posts`;
}

export function groupPostPath(slug: string, postId: string): string {
  return `${groupPostsPath(slug)}/${encodeURIComponent(postId)}`;
}

export function forumChannelsPath(slug: string): string {
  return `${groupPath(slug)}/forum/channels`;
}

export function forumChannelPath(slug: string, channelId: string): string {
  return `${forumChannelsPath(slug)}/${encodeURIComponent(channelId)}`;
}

export function forumChannelThreadsPath(slug: string, channelId: string): string {
  return `${forumChannelPath(slug, channelId)}/threads`;
}

export function forumThreadPath(slug: string, threadId: string): string {
  return `${groupPath(slug)}/forum/threads/${encodeURIComponent(threadId)}`;
}

export function forumThreadRepliesPath(slug: string, threadId: string): string {
  return `${forumThreadPath(slug, threadId)}/replies`;
}

export function forumReplyPath(slug: string, threadId: string, replyId: string): string {
  return `${forumThreadRepliesPath(slug, threadId)}/${encodeURIComponent(replyId)}`;
}

/* ─── DTO shapes (the rail's snake_case contracts) ───────────────── */

export interface WorldGroup {
  id: string;
  slug: string;
  name: string;
  description: string;
  cover_url: string | null;
  member_count: number;
  is_public: boolean;
}

export interface GroupProfileCard {
  slug: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface GroupMemberRow {
  user_id: string;
  role: string;
  profile: GroupProfileCard | null;
}

export interface GroupDetail {
  group: WorldGroup;
  owner_profile: { slug: string; displayName: string } | null;
  members: GroupMemberRow[];
  viewer_role: string | null;
}

export interface GroupFeedPost {
  id: string;
  body: string;
  like_count: number;
  created_at: string;
  author_user_id: string;
  author: GroupProfileCard | null;
  can_delete: boolean;
}

export interface ForumCaps {
  viewer_role: string | null;
  can_post: boolean;
  can_moderate: boolean;
  can_manage_channels: boolean;
}

/* Tier-gated channels (#19): the rail's per-channel gate verdict.
   A locked viewer gets the knock — the same payload the 2D group
   page renders — so the World shows the door, never a dead end. */
export interface TierGateKnock {
  message: string;
  history_note: string;
  join_url: string | null;
  viewer_status: string;
  required_tier: { id: string; name: string } | null;
}

export interface ForumChannelGate {
  tier_id: string;
  tier_name: string | null;
  viewer_has_access: boolean;
  viewer_status: string | null;
  knock: TierGateKnock | null;
}

export interface ForumChannel {
  id: string;
  name: string;
  description: string;
  thread_count: number;
  gate: ForumChannelGate | null;
}

export interface ForumThread {
  id: string;
  channel_id: string;
  title: string;
  body: string;
  tags: string[];
  reply_count: number;
  is_pinned: boolean;
  is_locked: boolean;
  created_at: string;
  author: GroupProfileCard | null;
  can_delete: boolean;
  can_moderate: boolean;
}

export interface ForumReply {
  id: string;
  body: string;
  created_at: string;
  author: GroupProfileCard | null;
  can_delete: boolean;
}

/* ─── Normalizers (defensive: a malformed payload reads as empty,
   never as a crash — the desk renders its honest empty state) ───── */

function asGroup(raw: unknown): WorldGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  if (typeof g.slug !== "string" || typeof g.name !== "string") return null;
  return {
    id: typeof g.id === "string" ? g.id : g.slug,
    slug: g.slug,
    name: g.name,
    description: typeof g.description === "string" ? g.description : "",
    cover_url: typeof g.cover_url === "string" ? g.cover_url : null,
    member_count: typeof g.member_count === "number" ? g.member_count : 0,
    is_public: g.is_public !== false,
  };
}

export function normalizeGroups(data: unknown): WorldGroup[] {
  const rows = (data as { groups?: unknown })?.groups;
  if (!Array.isArray(rows)) return [];
  return rows.map(asGroup).filter((g): g is WorldGroup => g !== null);
}

function asCard(raw: unknown): GroupProfileCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.slug !== "string") return null;
  return {
    slug: c.slug,
    displayName: typeof c.displayName === "string" ? c.displayName : c.slug,
    avatarUrl: typeof c.avatarUrl === "string" ? c.avatarUrl : null,
  };
}

export function normalizeGroupDetail(data: unknown): GroupDetail | null {
  const d = data as {
    group?: unknown; owner_profile?: unknown; members?: unknown; viewer_role?: unknown;
  } | null;
  const group = asGroup(d?.group);
  if (!group) return null;
  const members = Array.isArray(d?.members)
    ? d.members.flatMap((m) => {
        const row = m as Record<string, unknown>;
        if (typeof row?.user_id !== "string") return [];
        return [{
          user_id: row.user_id,
          role: typeof row.role === "string" ? row.role : "member",
          profile: asCard(row.profile),
        }];
      })
    : [];
  const owner = d?.owner_profile as Record<string, unknown> | null | undefined;
  return {
    group,
    owner_profile:
      owner && typeof owner.slug === "string"
        ? { slug: owner.slug, displayName: typeof owner.displayName === "string" ? owner.displayName : owner.slug }
        : null,
    members,
    viewer_role: typeof d?.viewer_role === "string" ? d.viewer_role : null,
  };
}

export function normalizeGroupFeed(data: unknown): { posts: GroupFeedPost[]; viewer_role: string | null } {
  const d = data as { posts?: unknown; viewer_role?: unknown } | null;
  const posts = Array.isArray(d?.posts)
    ? d.posts.flatMap((p) => {
        const row = p as Record<string, unknown>;
        if (typeof row?.id !== "string" || typeof row?.body !== "string") return [];
        return [{
          id: row.id,
          body: row.body,
          like_count: typeof row.like_count === "number" ? row.like_count : 0,
          created_at: typeof row.created_at === "string" ? row.created_at : "",
          author_user_id: typeof row.author_user_id === "string" ? row.author_user_id : "",
          author: asCard(row.author),
          can_delete: row.can_delete === true,
        }];
      })
    : [];
  return { posts, viewer_role: typeof d?.viewer_role === "string" ? d.viewer_role : null };
}

export function forumCapsOf(data: unknown): ForumCaps {
  const d = data as Record<string, unknown> | null;
  return {
    viewer_role: typeof d?.viewer_role === "string" ? d.viewer_role : null,
    can_post: d?.can_post === true,
    can_moderate: d?.can_moderate === true,
    can_manage_channels: d?.can_manage_channels === true,
  };
}

function asKnock(raw: unknown): TierGateKnock | null {
  if (!raw || typeof raw !== "object") return null;
  const k = raw as Record<string, unknown>;
  if (typeof k.message !== "string") return null;
  const tier = k.required_tier as Record<string, unknown> | null | undefined;
  return {
    message: k.message,
    history_note: typeof k.history_note === "string" ? k.history_note : "",
    join_url: typeof k.join_url === "string" ? k.join_url : null,
    viewer_status: typeof k.viewer_status === "string" ? k.viewer_status : "not_member",
    required_tier:
      tier && typeof tier.id === "string" && typeof tier.name === "string"
        ? { id: tier.id, name: tier.name }
        : null,
  };
}

function asGate(raw: unknown): ForumChannelGate | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  if (typeof g.tier_id !== "string") return null;
  return {
    tier_id: g.tier_id,
    tier_name: typeof g.tier_name === "string" ? g.tier_name : null,
    viewer_has_access: g.viewer_has_access === true,
    viewer_status: typeof g.viewer_status === "string" ? g.viewer_status : null,
    knock: asKnock(g.knock),
  };
}

export function normalizeForumChannels(data: unknown): {
  channels: ForumChannel[];
  caps: ForumCaps;
  gateOptions: { id: string; name: string }[];
} {
  const d = data as { channels?: unknown; gate_options?: unknown } | null;
  const channels = Array.isArray(d?.channels)
    ? d.channels.flatMap((c) => {
        const row = c as Record<string, unknown>;
        if (typeof row?.id !== "string" || typeof row?.name !== "string") return [];
        return [{
          id: row.id,
          name: row.name,
          description: typeof row.description === "string" ? row.description : "",
          thread_count: typeof row.thread_count === "number" ? row.thread_count : 0,
          gate: asGate(row.gate),
        }];
      })
    : [];
  const gateOptions = Array.isArray(d?.gate_options)
    ? d.gate_options.flatMap((t) => {
        const row = t as Record<string, unknown>;
        if (typeof row?.id !== "string" || typeof row?.name !== "string") return [];
        return [{ id: row.id, name: row.name }];
      })
    : [];
  return { channels, caps: forumCapsOf(data), gateOptions };
}

/** The knock door for a channel this viewer cannot enter, or null
 *  when the channel is open to them. The desk renders this instead
 *  of opening a thread list the rail would refuse. */
export function forumChannelKnock(channel: ForumChannel): TierGateKnock | null {
  if (!channel.gate || channel.gate.viewer_has_access) return null;
  return channel.gate.knock;
}

function asThread(raw: unknown): ForumThread | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "string" || typeof t.title !== "string") return null;
  return {
    id: t.id,
    channel_id: typeof t.channel_id === "string" ? t.channel_id : "",
    title: t.title,
    body: typeof t.body === "string" ? t.body : "",
    tags: Array.isArray(t.tags) ? t.tags.filter((x): x is string => typeof x === "string") : [],
    reply_count: typeof t.reply_count === "number" ? t.reply_count : 0,
    is_pinned: t.is_pinned === true,
    is_locked: t.is_locked === true,
    created_at: typeof t.created_at === "string" ? t.created_at : "",
    author: asCard(t.author),
    can_delete: t.can_delete === true,
    can_moderate: t.can_moderate === true,
  };
}

export function normalizeForumThreads(data: unknown): { threads: ForumThread[]; caps: ForumCaps } {
  const d = data as { threads?: unknown } | null;
  const threads = Array.isArray(d?.threads)
    ? d.threads.map(asThread).filter((t): t is ForumThread => t !== null)
    : [];
  return { threads, caps: forumCapsOf(data) };
}

export function normalizeForumThreadDetail(
  data: unknown,
): { thread: ForumThread; replies: ForumReply[]; caps: ForumCaps } | null {
  const d = data as { thread?: unknown; replies?: unknown } | null;
  const thread = asThread(d?.thread);
  if (!thread) return null;
  const replies = Array.isArray(d?.replies)
    ? d.replies.flatMap((r) => {
        const row = r as Record<string, unknown>;
        if (typeof row?.id !== "string" || typeof row?.body !== "string") return [];
        return [{
          id: row.id,
          body: row.body,
          created_at: typeof row.created_at === "string" ? row.created_at : "",
          author: asCard(row.author),
          can_delete: row.can_delete === true,
        }];
      })
    : [];
  return { thread, replies, caps: forumCapsOf(data) };
}

/* ─── Verbs the desk may show (rail fields decide, never the role
   string alone — except membership, where viewer_role IS the rail's
   answer on the detail/feed reads) ──────────────────────────────── */

export type GroupMembershipAction = "owner" | "leave" | "join" | "sign-in";

export function groupMembershipAction(viewerRole: string | null, isGuest: boolean): GroupMembershipAction {
  if (isGuest) return "sign-in";
  if (viewerRole === "owner") return "owner";
  if (viewerRole) return "leave";
  return "join";
}

/** Posting to a group feed is members-only on the rail (403 without
 *  a role) — the composer shows only for members; guests and
 *  non-members get the honest line instead. */
export function groupFeedCanPost(viewerRole: string | null, isGuest: boolean): boolean {
  return !isGuest && viewerRole != null;
}

/** A locked thread is closed to regular members; the rail still lets
 *  moderator+ post (can_moderate is the rail's own ladder answer). */
export function forumReplyAllowed(thread: ForumThread, caps: ForumCaps, isGuest: boolean): boolean {
  if (isGuest || !caps.can_post) return false;
  if (thread.is_locked && !caps.can_moderate) return false;
  return true;
}

/** Pin/lock buttons exist only where the rail says this viewer
 *  moderates (thread.can_moderate comes from the rail's DTO). */
export function forumModerationVisible(thread: ForumThread, isGuest: boolean): boolean {
  return !isGuest && thread.can_moderate === true;
}

/* ─── Create-a-group form ────────────────────────────────────────── */

/** The rail's slug law: 3–40 chars, lowercase letters/numbers/
 *  hyphens, no leading/trailing hyphen. The form derives a slug
 *  from the name so the creator never has to know the law exists. */
export function groupSlugFromName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base;
}

export function groupSlugValid(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug);
}

export function groupCreateReady(name: string, slug: string): boolean {
  return name.trim().length >= 1 && name.trim().length <= 80 && groupSlugValid(slug);
}

export function buildGroupCreateBody(name: string, slug: string, description: string, isPublic: boolean) {
  return {
    name: name.trim(),
    slug: slug.trim().toLowerCase(),
    description: description.trim(),
    is_public: isPublic,
  };
}

/* ─── Notification deep-open hint ──────────────────────────────────
   The chrome bell (item 78) parks the group slug a notification
   pointed at; the groups desk picks it up on mount and opens that
   group, so a "joined your group" tap lands INSIDE the group, not
   on a directory. sessionStorage keeps it across the panel mount;
   it is consumed (cleared) on read so it fires exactly once. */

export const PENDING_GROUP_KEY = "world-open-group-slug";

export function stashPendingGroupSlug(storage: Pick<Storage, "setItem">, slug: string): void {
  try {
    storage.setItem(PENDING_GROUP_KEY, slug);
  } catch {
    /* private mode — the desk just opens on the directory */
  }
}

export function takePendingGroupSlug(storage: Pick<Storage, "getItem" | "removeItem">): string | null {
  try {
    const slug = storage.getItem(PENDING_GROUP_KEY);
    if (slug) storage.removeItem(PENDING_GROUP_KEY);
    return slug && groupSlugValid(slug) ? slug : null;
  } catch {
    return null;
  }
}
