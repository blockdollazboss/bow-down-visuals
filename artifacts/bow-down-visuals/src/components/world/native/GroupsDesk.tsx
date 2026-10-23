import { useCallback, useEffect, useState } from "react";
import {
  Users, Search, Plus, ArrowLeft, Lock, Globe, Pin, Trash2, MessageSquare,
  Hash, Send, Loader2, Crown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  NativeCard, NativeLoadingState, NativeEmptyState, NativeErrorState,
} from "@/components/world/native";
import {
  groupsSearchPath, groupsMinePath, GROUPS_PATH, groupPath, groupJoinPath,
  groupLeavePath, groupFeedPath, groupPostsPath, groupPostPath,
  forumChannelsPath, forumChannelPath, forumChannelThreadsPath,
  forumThreadPath, forumThreadRepliesPath, forumReplyPath,
  normalizeGroups, normalizeGroupDetail, normalizeGroupFeed,
  normalizeForumChannels, normalizeForumThreads, normalizeForumThreadDetail,
  groupMembershipAction, groupFeedCanPost, forumReplyAllowed,
  forumModerationVisible, groupSlugFromName, groupCreateReady,
  buildGroupCreateBody, takePendingGroupSlug,
  type WorldGroup, type GroupDetail, type GroupFeedPost, type ForumCaps,
  type ForumChannel, type ForumThread, type ForumReply,
} from "@/lib/world/groups-desk";

/* ─── Groups + group forums, in-world (stack-100 items 76 + 77) ────
   The Community Hall groups desk, on the community router's own
   rails — the same /api/groups/* endpoints pages/groups.tsx and
   pages/group-detail.tsx call. Browse/search/create/join/leave,
   the group feed, and the full forum (channels, threads, replies,
   pin/lock) complete HERE; nothing ejects the walker to the 2D
   groups pages. Verbs render only where the rail's own fields
   allow them (viewer_role, forum caps, per-row can_delete /
   can_moderate) and the server re-enforces every call. Guests
   browse the public directory the rail itself serves them and get
   the honest sign-in pitch for member verbs. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

async function apiJson<T>(
  authHeaders: () => Promise<Record<string, string>>,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string; message?: string;
  };
  if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
  return data as T;
}

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

export function GroupsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useAuthHeaders();
  const { user } = useAuth();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const [groups, setGroups] = useState<WorldGroup[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const [openSlug, setOpenSlug] = useState<string | null>(null);

  /* ── directory ── */
  useEffect(() => {
    let cancelled = false;
    setListFailed(false);
    (async () => {
      try {
        const path = mineOnly && user?.id ? groupsMinePath(user.id) : groupsSearchPath(query);
        const d = await apiJson(authHeaders, path);
        if (!cancelled) setGroups(normalizeGroups(d));
      } catch {
        if (!cancelled) setListFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, query, mineOnly, user?.id]);

  /* A notification tap (item 78) parks the group to open here. */
  useEffect(() => {
    const pending = takePendingGroupSlug(window.sessionStorage);
    if (pending) setOpenSlug(pending);
  }, []);

  /* ── create ── */
  const [showCreate, setShowCreate] = useState(false);
  const [cName, setCName] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cPublic, setCPublic] = useState(true);
  const [creating, setCreating] = useState(false);
  const cSlug = groupSlugFromName(cName);

  const createGroup = async () => {
    if (!groupCreateReady(cName, cSlug) || creating) return;
    setCreating(true);
    setNotice(null);
    try {
      const d = await apiJson<{ group: WorldGroup }>(authHeaders, GROUPS_PATH, {
        method: "POST",
        body: buildGroupCreateBody(cName, cSlug, cDesc, cPublic),
      });
      setCName(""); setCDesc(""); setShowCreate(false);
      setNotice("Your group is live — you're its owner.");
      setTick((t) => t + 1);
      if (d.group?.slug) setOpenSlug(d.group.slug);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't start the group — try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div data-testid="world-groups-desk" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <h3 className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
          <Users className="h-4 w-4 text-[#d4af37]" /> Groups at the Hall
        </h3>
        <span className={`text-xs ${muted}`}>
          Crews with their own feeds and forums — browse, join, and talk without leaving the palace.
        </span>
        {!isGuest && (
          <button type="button" data-testid="world-groups-create-toggle" onClick={() => setShowCreate((s) => !s)} className={`${goldBtn} ml-auto`}>
            <Plus className="h-3.5 w-3.5" /> Start a group
          </button>
        )}
      </div>

      {notice && (
        <p data-testid="world-groups-notice" className={`px-1 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-[#e8c86a]"}`}>{notice}</p>
      )}

      {openSlug ? (
        <GroupRoom
          slug={openSlug}
          isLight={isLight}
          isGuest={isGuest}
          authHeaders={authHeaders}
          onBack={() => { setOpenSlug(null); setTick((t) => t + 1); }}
          onNotice={setNotice}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 px-1">
            <label className={`inline-flex flex-1 min-w-[180px] items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/60" : "border-white/10 bg-white/5"}`}>
              <Search className={`h-4 w-4 ${muted}`} />
              <input
                data-testid="world-groups-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search groups…"
                className={`w-full bg-transparent text-sm outline-none ${strong} placeholder:text-current placeholder:opacity-40`}
              />
            </label>
            {!isGuest && user?.id && (
              <button type="button" data-testid="world-groups-mine" onClick={() => setMineOnly((m) => !m)} className={chipBtn(isLight)} aria-pressed={mineOnly}>
                {mineOnly ? "✓ My groups" : "My groups"}
              </button>
            )}
          </div>

          {showCreate && !isGuest && (
            <NativeCard isLight={isLight}>
              <div className="flex flex-col gap-2" data-testid="world-groups-create-form">
                <input data-testid="world-groups-create-name" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Group name" maxLength={80} className={inputCls(isLight)} />
                {cName.trim() && (
                  <p className={`text-xs ${muted}`}>Its palace address: <span className="font-bold">/groups/{cSlug || "…"}</span></p>
                )}
                <textarea value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder="What's this crew about?" rows={2} maxLength={2000} className={inputCls(isLight)} />
                <label className={`inline-flex items-center gap-2 text-xs font-semibold ${muted}`}>
                  <input type="checkbox" checked={cPublic} onChange={(e) => setCPublic(e.target.checked)} />
                  {cPublic ? "Public — anyone can browse and join" : "Private — only members see inside"}
                </label>
                <button type="button" data-testid="world-groups-create-submit" disabled={!groupCreateReady(cName, cSlug) || creating} onClick={() => void createGroup()} className={goldBtn}>
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create the group
                </button>
              </div>
            </NativeCard>
          )}

          {listFailed ? (
            <NativeErrorState isLight={isLight} message="The group directory wouldn't open." onRetry={() => setTick((t) => t + 1)} />
          ) : groups === null ? (
            <NativeLoadingState isLight={isLight} message="Opening the group directory…" />
          ) : groups.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={mineOnly ? "You're not in any groups yet." : "No groups match — yet."}
              detail={isGuest ? "Sign in to start the first crew." : "Start the first crew with the button above."}
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {groups.map((g) => (
                <NativeCard key={g.id} isLight={isLight}>
                  <button type="button" data-testid={`world-group-open-${g.slug}`} onClick={() => setOpenSlug(g.slug)} className="flex w-full flex-col gap-1 text-left">
                    <span className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
                      {g.name}
                      {g.is_public ? <Globe className="h-3.5 w-3.5 text-[#d4af37]" /> : <Lock className="h-3.5 w-3.5 text-[#d4af37]" />}
                    </span>
                    {g.description && <span className={`line-clamp-2 text-xs ${muted}`}>{g.description}</span>}
                    <span className={`text-xs font-semibold ${muted}`}>{g.member_count} member{g.member_count === 1 ? "" : "s"}</span>
                  </button>
                </NativeCard>
              ))}
            </div>
          )}
          {isGuest && (
            <p className={`px-1 text-xs ${muted}`}>You're browsing as a guest — public groups are open to read; joining and posting are for signed-in members.</p>
          )}
        </>
      )}
    </div>
  );
}

/* ─── One group: detail + feed + forum ───────────────────────────── */

function GroupRoom({
  slug, isLight, isGuest, authHeaders, onBack, onNotice,
}: {
  slug: string;
  isLight: boolean;
  isGuest: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  onBack: () => void;
  onNotice: (n: string | null) => void;
}) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<"feed" | "forum">("feed");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const d = await apiJson(authHeaders, groupPath(slug));
      const parsed = normalizeGroupDetail(d);
      if (!parsed) throw new Error("Couldn't load the group — try again.");
      setDetail(parsed);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Couldn't load the group — try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, reloadKey]);

  useEffect(() => { void load(); }, [load]);

  const membership = detail ? groupMembershipAction(detail.viewer_role, isGuest) : null;

  const joinLeave = async () => {
    if (busy || !detail) return;
    setBusy(true);
    onNotice(null);
    try {
      if (membership === "join") {
        await apiJson(authHeaders, groupJoinPath(slug), { method: "POST" });
        onNotice(`You're in ${detail.group.name}. Make some noise.`);
      } else if (membership === "leave") {
        await apiJson(authHeaders, groupLeavePath(slug), { method: "POST" });
        onNotice(`You left ${detail.group.name}.`);
      }
      setReloadKey((k) => k + 1);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="world-group-room" className="flex flex-col gap-3">
      <button type="button" onClick={onBack} className={`inline-flex items-center gap-1.5 self-start px-1 text-xs font-bold ${muted} hover:opacity-80`}>
        <ArrowLeft className="h-3.5 w-3.5" /> All groups
      </button>
      {failed ? (
        <NativeErrorState isLight={isLight} message={failed} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !detail ? (
        <NativeLoadingState isLight={isLight} message="Opening the group…" />
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-3 px-1">
            <div className="min-w-0 flex-1">
              <h4 className={`flex items-center gap-2 text-base font-black ${strong}`}>
                {detail.group.name}
                {detail.group.is_public ? <Globe className="h-4 w-4 text-[#d4af37]" /> : <Lock className="h-4 w-4 text-[#d4af37]" />}
              </h4>
              {detail.group.description && <p className={`mt-1 text-sm ${muted}`}>{detail.group.description}</p>}
              <p className={`mt-1 text-xs font-semibold ${muted}`}>
                {detail.group.member_count} member{detail.group.member_count === 1 ? "" : "s"}
                {detail.owner_profile && <> · led by {detail.owner_profile.displayName}</>}
                {detail.viewer_role && <> · you're {detail.viewer_role === "owner" ? "the owner" : `a ${detail.viewer_role}`}</>}
              </p>
              {detail.members.length > 0 && (
                <p className={`mt-1 text-xs ${muted}`}>
                  In the crew: {detail.members.slice(0, 8).map((m) => m.profile?.displayName ?? "A creator").join(", ")}
                  {detail.members.length > 8 ? "…" : ""}
                </p>
              )}
            </div>
            {membership === "join" && (
              <button type="button" data-testid="world-group-join" disabled={busy} onClick={() => void joinLeave()} className={goldBtn}>Join the group</button>
            )}
            {membership === "leave" && (
              <button type="button" data-testid="world-group-leave" disabled={busy} onClick={() => void joinLeave()} className={chipBtn(isLight)}>Leave</button>
            )}
            {membership === "owner" && (
              <span className={`inline-flex items-center gap-1.5 rounded-full border border-[#d4af37]/40 px-3 py-1.5 text-xs font-bold ${strong}`}>
                <Crown className="h-3.5 w-3.5 text-[#d4af37]" /> Your group
              </span>
            )}
            {membership === "sign-in" && (
              <span className={`text-xs font-semibold ${muted}`}>Sign in to join this crew.</span>
            )}
          </div>

          <div className="flex gap-2 px-1" role="tablist" aria-label="Group sections">
            {(["feed", "forum"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                data-testid={`world-group-tab-${t}`}
                onClick={() => setTab(t)}
                className={tab === t ? goldBtn : chipBtn(isLight)}
              >
                {t === "feed" ? <MessageSquare className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" />}
                {t === "feed" ? "Group feed" : "Forum"}
              </button>
            ))}
          </div>

          {tab === "feed" ? (
            <GroupFeed slug={slug} isLight={isLight} isGuest={isGuest} authHeaders={authHeaders} viewerRole={detail.viewer_role} onNotice={onNotice} />
          ) : (
            <GroupForum slug={slug} isLight={isLight} isGuest={isGuest} authHeaders={authHeaders} onNotice={onNotice} />
          )}
        </>
      )}
    </div>
  );
}

/* ─── The group feed ─────────────────────────────────────────────── */

function GroupFeed({
  slug, isLight, isGuest, authHeaders, viewerRole, onNotice,
}: {
  slug: string;
  isLight: boolean;
  isGuest: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  viewerRole: string | null;
  onNotice: (n: string | null) => void;
}) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const [posts, setPosts] = useState<GroupFeedPost[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const canPost = groupFeedCanPost(viewerRole, isGuest);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const d = await apiJson(authHeaders, groupFeedPath(slug));
        if (!cancelled) setPosts(normalizeGroupFeed(d).posts);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, tick]);

  const post = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await apiJson(authHeaders, groupPostsPath(slug), { method: "POST", body: { body: draft.trim() } });
      setDraft("");
      setTick((t) => t + 1);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Couldn't post — try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await apiJson(authHeaders, groupPostPath(slug, id), { method: "DELETE" });
      setTick((t) => t + 1);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Couldn't delete that post.");
    }
  };

  if (failed) return <NativeErrorState isLight={isLight} message="The group feed wouldn't open." onRetry={() => setTick((t) => t + 1)} />;
  if (posts === null) return <NativeLoadingState isLight={isLight} message="Loading the group feed…" />;

  return (
    <div data-testid="world-group-feed" className="flex flex-col gap-2">
      {canPost ? (
        <div className="flex items-start gap-2 px-1">
          <textarea
            data-testid="world-group-feed-composer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Say it to the crew…"
            rows={2}
            maxLength={2000}
            className={inputCls(isLight)}
          />
          <button type="button" data-testid="world-group-feed-post" disabled={!draft.trim() || busy} onClick={() => void post()} className={goldBtn}>
            <Send className="h-3.5 w-3.5" /> Post
          </button>
        </div>
      ) : (
        <p className={`px-1 text-xs ${muted}`}>
          {isGuest ? "Sign in and join the group to post in its feed." : "Join the group to post in its feed — members talk, visitors listen."}
        </p>
      )}
      {posts.length === 0 ? (
        <NativeEmptyState isLight={isLight} message="Nothing on this feed yet." detail={canPost ? "Be the first voice in the crew." : undefined} />
      ) : (
        posts.map((p) => (
          <NativeCard key={p.id} isLight={isLight}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-bold ${strong}`}>
                  {p.author?.displayName ?? "A creator"}
                  <span className={`ml-2 font-semibold ${muted}`}>{p.created_at ? new Date(p.created_at).toLocaleDateString() : ""}</span>
                </p>
                <p className={`mt-1 whitespace-pre-wrap text-sm ${strong}`}>{p.body}</p>
              </div>
              {p.can_delete && !isGuest && (
                <button type="button" data-testid={`world-group-feed-delete-${p.id}`} onClick={() => void remove(p.id)} className={chipBtn(isLight)} aria-label="Delete post">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </NativeCard>
        ))
      )}
    </div>
  );
}

/* ─── The group forum (item 77) ──────────────────────────────────── */

function GroupForum({
  slug, isLight, isGuest, authHeaders, onNotice,
}: {
  slug: string;
  isLight: boolean;
  isGuest: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  onNotice: (n: string | null) => void;
}) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const [channels, setChannels] = useState<ForumChannel[] | null>(null);
  const [caps, setCaps] = useState<ForumCaps | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);

  const [chName, setChName] = useState("");
  const [chDesc, setChDesc] = useState("");
  const [chBusy, setChBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const d = await apiJson(authHeaders, forumChannelsPath(slug));
        if (cancelled) return;
        const parsed = normalizeForumChannels(d);
        setChannels(parsed.channels);
        setCaps(parsed.caps);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, tick]);

  const createChannel = async () => {
    if (!chName.trim() || chBusy) return;
    setChBusy(true);
    try {
      await apiJson(authHeaders, forumChannelsPath(slug), {
        method: "POST",
        body: { name: chName.trim(), description: chDesc.trim() },
      });
      setChName(""); setChDesc("");
      setTick((t) => t + 1);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Couldn't open the channel.");
    } finally {
      setChBusy(false);
    }
  };

  const deleteChannel = async (id: string) => {
    try {
      await apiJson(authHeaders, forumChannelPath(slug, id), { method: "DELETE" });
      if (channelId === id) { setChannelId(null); setThreadId(null); }
      setTick((t) => t + 1);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Couldn't close the channel.");
    }
  };

  if (failed) return <NativeErrorState isLight={isLight} message="The forum wouldn't open." onRetry={() => setTick((t) => t + 1)} />;
  if (channels === null || caps === null) return <NativeLoadingState isLight={isLight} message="Opening the forum…" />;

  if (threadId && channelId) {
    return (
      <ForumThreadView
        slug={slug}
        threadId={threadId}
        isLight={isLight}
        isGuest={isGuest}
        authHeaders={authHeaders}
        onBack={() => setThreadId(null)}
        onNotice={onNotice}
      />
    );
  }

  if (channelId) {
    const channel = channels.find((c) => c.id === channelId);
    return (
      <ForumChannelView
        slug={slug}
        channelId={channelId}
        channelName={channel?.name ?? "Channel"}
        isLight={isLight}
        isGuest={isGuest}
        authHeaders={authHeaders}
        onBack={() => setChannelId(null)}
        onOpenThread={setThreadId}
        onNotice={onNotice}
      />
    );
  }

  return (
    <div data-testid="world-group-forum" className="flex flex-col gap-2">
      {channels.length === 0 ? (
        <NativeEmptyState
          isLight={isLight}
          message="No forum channels yet."
          detail={caps.can_manage_channels ? "Open the first channel below." : "The crew's admins open the channels here."}
        />
      ) : (
        channels.map((c) => (
          <NativeCard key={c.id} isLight={isLight}>
            <div className="flex items-center gap-2">
              <button type="button" data-testid={`world-forum-channel-${c.id}`} onClick={() => setChannelId(c.id)} className="min-w-0 flex-1 text-left">
                <span className={`flex items-center gap-2 text-sm font-black ${strong}`}><Hash className="h-4 w-4 text-[#d4af37]" /> {c.name}</span>
                {c.description && <span className={`mt-0.5 block truncate text-xs ${muted}`}>{c.description}</span>}
                <span className={`text-xs font-semibold ${muted}`}>{c.thread_count} thread{c.thread_count === 1 ? "" : "s"}</span>
              </button>
              {caps.can_manage_channels && !isGuest && (
                <button type="button" data-testid={`world-forum-channel-delete-${c.id}`} onClick={() => void deleteChannel(c.id)} className={chipBtn(isLight)} aria-label={`Close ${c.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </NativeCard>
        ))
      )}
      {caps.can_manage_channels && !isGuest && (
        <div className="flex flex-col gap-2 px-1" data-testid="world-forum-channel-create">
          <div className="flex gap-2">
            <input value={chName} onChange={(e) => setChName(e.target.value)} placeholder="New channel name" maxLength={60} className={inputCls(isLight)} />
            <button type="button" data-testid="world-forum-channel-create-submit" disabled={!chName.trim() || chBusy} onClick={() => void createChannel()} className={goldBtn}>
              <Plus className="h-3.5 w-3.5" /> Open channel
            </button>
          </div>
          <input value={chDesc} onChange={(e) => setChDesc(e.target.value)} placeholder="What's this channel for? (optional)" maxLength={500} className={inputCls(isLight)} />
        </div>
      )}
      {!caps.can_post && (
        <p className={`px-1 text-xs ${muted}`}>
          {isGuest ? "Sign in and join the group to post in its forum." : "Join the group to post in its forum — the channels stay readable here."}
        </p>
      )}
    </div>
  );
}

function ForumChannelView({
  slug, channelId, channelName, isLight, isGuest, authHeaders, onBack, onOpenThread, onNotice,
}: {
  slug: string;
  channelId: string;
  channelName: string;
  isLight: boolean;
  isGuest: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  onBack: () => void;
  onOpenThread: (id: string) => void;
  onNotice: (n: string | null) => void;
}) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const [threads, setThreads] = useState<ForumThread[] | null>(null);
  const [caps, setCaps] = useState<ForumCaps | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const d = await apiJson(authHeaders, forumChannelThreadsPath(slug, channelId));
        if (cancelled) return;
        const parsed = normalizeForumThreads(d);
        setThreads(parsed.threads);
        setCaps(parsed.caps);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, channelId, tick]);

  const startThread = async () => {
    if (!title.trim() || !body.trim() || busy) return;
    setBusy(true);
    try {
      const d = await apiJson<{ thread: ForumThread }>(authHeaders, forumChannelThreadsPath(slug, channelId), {
        method: "POST",
        body: {
          title: title.trim(),
          body: body.trim(),
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 5),
        },
      });
      setTitle(""); setBody(""); setTags("");
      if (d.thread?.id) onOpenThread(d.thread.id);
      else setTick((t) => t + 1);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Couldn't start the thread.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="world-forum-channel" className="flex flex-col gap-2">
      <button type="button" onClick={onBack} className={`inline-flex items-center gap-1.5 self-start px-1 text-xs font-bold ${muted}`}>
        <ArrowLeft className="h-3.5 w-3.5" /> All channels
      </button>
      <h5 className={`flex items-center gap-2 px-1 text-sm font-black ${strong}`}><Hash className="h-4 w-4 text-[#d4af37]" /> {channelName}</h5>
      {failed ? (
        <NativeErrorState isLight={isLight} message="The threads wouldn't open." onRetry={() => setTick((t) => t + 1)} />
      ) : threads === null ? (
        <NativeLoadingState isLight={isLight} message="Loading threads…" />
      ) : (
        <>
          {threads.length === 0 ? (
            <NativeEmptyState isLight={isLight} message="No threads in this channel yet." detail={caps?.can_post ? "Start the first one below." : undefined} />
          ) : (
            threads.map((t) => (
              <NativeCard key={t.id} isLight={isLight}>
                <button type="button" data-testid={`world-forum-thread-${t.id}`} onClick={() => onOpenThread(t.id)} className="flex w-full flex-col gap-1 text-left">
                  <span className={`flex items-center gap-2 text-sm font-black ${strong}`}>
                    {t.is_pinned && <Pin className="h-3.5 w-3.5 text-[#d4af37]" />}
                    {t.title}
                    {t.is_locked && <Lock className="h-3.5 w-3.5 text-[#d4af37]" />}
                  </span>
                  <span className={`text-xs font-semibold ${muted}`}>
                    by {t.author?.displayName ?? "A creator"} · {t.reply_count} repl{t.reply_count === 1 ? "y" : "ies"}
                    {t.tags.length > 0 && <> · {t.tags.map((x) => `#${x}`).join(" ")}</>}
                  </span>
                </button>
              </NativeCard>
            ))
          )}
          {caps?.can_post && !isGuest && (
            <div className="flex flex-col gap-2 px-1" data-testid="world-forum-thread-create">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Thread title" maxLength={120} className={inputCls(isLight)} />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Open the conversation…" rows={3} maxLength={5000} className={inputCls(isLight)} />
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma-separated (optional)" className={inputCls(isLight)} />
              <button type="button" data-testid="world-forum-thread-create-submit" disabled={!title.trim() || !body.trim() || busy} onClick={() => void startThread()} className={`${goldBtn} self-start`}>
                <Plus className="h-3.5 w-3.5" /> Start thread
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ForumThreadView({
  slug, threadId, isLight, isGuest, authHeaders, onBack, onNotice,
}: {
  slug: string;
  threadId: string;
  isLight: boolean;
  isGuest: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  onBack: () => void;
  onNotice: (n: string | null) => void;
}) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const [thread, setThread] = useState<ForumThread | null>(null);
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [caps, setCaps] = useState<ForumCaps | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const d = await apiJson(authHeaders, forumThreadPath(slug, threadId));
        if (cancelled) return;
        const parsed = normalizeForumThreadDetail(d);
        if (!parsed) { setFailed(true); return; }
        setThread(parsed.thread);
        setReplies(parsed.replies);
        setCaps(parsed.caps);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, threadId, tick]);

  const reply = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await apiJson(authHeaders, forumThreadRepliesPath(slug, threadId), { method: "POST", body: { body: draft.trim() } });
      setDraft("");
      setTick((t) => t + 1);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Couldn't post your reply.");
    } finally {
      setBusy(false);
    }
  };

  const moderate = async (patch: { is_pinned?: boolean; is_locked?: boolean }) => {
    try {
      await apiJson(authHeaders, forumThreadPath(slug, threadId), { method: "PATCH", body: patch });
      setTick((t) => t + 1);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "That moderation didn't go through.");
    }
  };

  const deleteThread = async () => {
    try {
      await apiJson(authHeaders, forumThreadPath(slug, threadId), { method: "DELETE" });
      onNotice("Thread removed.");
      onBack();
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Couldn't delete the thread.");
    }
  };

  const deleteReply = async (replyId: string) => {
    try {
      await apiJson(authHeaders, forumReplyPath(slug, threadId, replyId), { method: "DELETE" });
      setTick((t) => t + 1);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Couldn't delete that reply.");
    }
  };

  if (failed) return <NativeErrorState isLight={isLight} message="The thread wouldn't open." onRetry={() => setTick((t) => t + 1)} />;
  if (!thread || !caps) return <NativeLoadingState isLight={isLight} message="Opening the thread…" />;

  const canReply = forumReplyAllowed(thread, caps, isGuest);
  const showMod = forumModerationVisible(thread, isGuest);

  return (
    <div data-testid="world-forum-thread" className="flex flex-col gap-2">
      <button type="button" onClick={onBack} className={`inline-flex items-center gap-1.5 self-start px-1 text-xs font-bold ${muted}`}>
        <ArrowLeft className="h-3.5 w-3.5" /> Back to threads
      </button>
      <NativeCard isLight={isLight}>
        <div className="flex flex-col gap-1">
          <p className={`flex items-center gap-2 text-sm font-black ${strong}`}>
            {thread.is_pinned && <Pin className="h-4 w-4 text-[#d4af37]" />}
            {thread.title}
            {thread.is_locked && <Lock className="h-4 w-4 text-[#d4af37]" />}
          </p>
          <p className={`text-xs font-semibold ${muted}`}>by {thread.author?.displayName ?? "A creator"}</p>
          <p className={`whitespace-pre-wrap text-sm ${strong}`}>{thread.body}</p>
          {(showMod || thread.can_delete) && (
            <div className="mt-1 flex flex-wrap gap-2">
              {showMod && (
                <>
                  <button type="button" data-testid="world-forum-thread-pin" onClick={() => void moderate({ is_pinned: !thread.is_pinned })} className={chipBtn(isLight)}>
                    <Pin className="h-3.5 w-3.5" /> {thread.is_pinned ? "Unpin" : "Pin"}
                  </button>
                  <button type="button" data-testid="world-forum-thread-lock" onClick={() => void moderate({ is_locked: !thread.is_locked })} className={chipBtn(isLight)}>
                    <Lock className="h-3.5 w-3.5" /> {thread.is_locked ? "Unlock" : "Lock"}
                  </button>
                </>
              )}
              {thread.can_delete && (
                <button type="button" data-testid="world-forum-thread-delete" onClick={() => void deleteThread()} className={chipBtn(isLight)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete thread
                </button>
              )}
            </div>
          )}
        </div>
      </NativeCard>

      {replies.map((r) => (
        <NativeCard key={r.id} isLight={isLight}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-bold ${strong}`}>{r.author?.displayName ?? "A creator"}</p>
              <p className={`mt-0.5 whitespace-pre-wrap text-sm ${strong}`}>{r.body}</p>
            </div>
            {r.can_delete && !isGuest && (
              <button type="button" data-testid={`world-forum-reply-delete-${r.id}`} onClick={() => void deleteReply(r.id)} className={chipBtn(isLight)} aria-label="Delete reply">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </NativeCard>
      ))}

      {canReply ? (
        <div className="flex items-start gap-2 px-1">
          <textarea
            data-testid="world-forum-reply-composer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply to the thread…"
            rows={2}
            maxLength={5000}
            className={inputCls(isLight)}
          />
          <button type="button" data-testid="world-forum-reply-post" disabled={!draft.trim() || busy} onClick={() => void reply()} className={goldBtn}>
            <Send className="h-3.5 w-3.5" /> Reply
          </button>
        </div>
      ) : (
        <p className={`px-1 text-xs ${muted}`}>
          {thread.is_locked && caps.can_post
            ? "This thread is locked by the crew's moderators."
            : isGuest
              ? "Sign in and join the group to reply here."
              : "Join the group to reply in its forum."}
        </p>
      )}
    </div>
  );
}
