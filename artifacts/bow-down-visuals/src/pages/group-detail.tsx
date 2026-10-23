import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Users, Crown, Trash2, Send, Megaphone, ShieldAlert, Hash, MessagesSquare, Pin, Lock, ArrowLeft, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCommunityApi, ShareButton, Loading, ErrorBox, profileLink, timeAgo,
  goldInput, goldButton, ghostButton,
  friendlyLoadError,
} from "@/lib/community-ui";
import { usePageTitle } from "@/hooks/use-page-title";
import { GroupOnboarding } from "@/components/trust/GroupOnboarding";

/* ─── /groups/:slug — group detail ─────────────────────────────────────────
   About / feed / members. Join & chat never gated (1 star). Moderation tools
   (remove member, delete posts) sit at 4+ stars; broadcast DMs at 5+.
   Money path: owners get the paid-tier nudge -> /memberships. */

interface ProfileCard { slug: string; displayName: string; avatarUrl: string | null }
interface GroupDetail {
  id: string; slug: string; name: string; description: string;
  cover_url: string | null; member_count: number; is_public: boolean;
}
interface Member { user_id: string; role: string; joined_at: string; profile: ProfileCard | null }
interface Post {
  id: string; body: string; like_count: number; created_at: string;
  author_user_id: string; author: ProfileCard | null; can_delete: boolean;
}

/* Group forums (0185): channels inside the group, threads inside a
   channel, replies inside a thread. The server computes what the
   viewer may do (can_post / can_moderate / can_manage_channels) from
   the group's role ladder — the page never re-derives permissions. */
interface ForumChannel {
  id: string; name: string; description: string; position: number;
  thread_count: number; created_at: string;
}
interface ForumThread {
  id: string; channel_id: string; title: string; body: string; tags: string[];
  reply_count: number; last_reply_at: string | null;
  is_pinned: boolean; is_locked: boolean; created_at: string;
  author_user_id: string; author: ProfileCard | null;
  can_delete: boolean; can_moderate: boolean;
}
interface ForumReply {
  id: string; thread_id: string; body: string; created_at: string;
  author_user_id: string; author: ProfileCard | null; can_delete: boolean;
}
interface ForumCaps { can_post: boolean; can_moderate: boolean; can_manage_channels: boolean }

export default function GroupDetail() {
  const isLight = useIsLightTheme();
  const [, params] = useRoute("/groups/:slug");
  const slug = params?.slug ?? "";
  const api = useCommunityApi();
  const { user } = useAuth();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  usePageTitle(group?.name ?? "Group", "A creator community on Bow Down Visuals.");
  const [ownerProfile, setOwnerProfile] = useState<{ slug: string; displayName: string } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const [tab, setTab] = useState<"about" | "feed" | "forum" | "members">("feed");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [broadcast, setBroadcast] = useState("");
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /* Forum state: channel list -> threads of the open channel -> one
     open thread with its replies. Loaded lazily on first forum visit. */
  const [channels, setChannels] = useState<ForumChannel[]>([]);
  const [forumCaps, setForumCaps] = useState<ForumCaps>({ can_post: false, can_moderate: false, can_manage_channels: false });
  const [forumLoaded, setForumLoaded] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [openThread, setOpenThread] = useState<{ thread: ForumThread; replies: ForumReply[] } | null>(null);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelDesc, setChannelDesc] = useState("");
  const [showThreadForm, setShowThreadForm] = useState(false);
  const [threadTitle, setThreadTitle] = useState("");
  const [threadBody, setThreadBody] = useState("");
  const [threadTags, setThreadTags] = useState("");
  const [replyDraft, setReplyDraft] = useState("");

  /* The feed settles on its own (dashboard pattern): a feed failure
     shows its own error inside the feed tab — it must never replace
     the group that already loaded with a full-page error. */
  const [feedError, setFeedError] = useState<string | null>(null);

  async function loadFeed() {
    try {
      const f = (await api.get(`/api/groups/${slug}/feed`)) as { posts: Post[]; viewer_role: string | null };
      setPosts(f.posts);
      if (f.viewer_role) setViewerRole(f.viewer_role);
      setFeedError(null);
    } catch (e) {
      setFeedError(friendlyLoadError(e, "the group feed"));
    }
  }

  async function load() {
    setLoading(true); setError(null); setFeedError(null);
    try {
      const d = (await api.get(`/api/groups/${slug}`)) as {
        group: GroupDetail; owner_profile: { slug: string; displayName: string } | null;
        members: Member[]; viewer_role: string | null;
      };
      setGroup(d.group); setOwnerProfile(d.owner_profile); setMembers(d.members); setViewerRole(d.viewer_role);
    } catch (e) {
      setError(friendlyLoadError(e, "this group"));
      setLoading(false);
      return;
    }
    await loadFeed();
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slug]);

  async function join() {
    setBusy(true);
    try { await api.post(`/api/groups/${slug}/join`); setNotice("You're in. Make some noise. 🦈"); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't join."); }
    finally { setBusy(false); }
  }
  async function leave() {
    setBusy(true);
    try { await api.post(`/api/groups/${slug}/leave`); setNotice("You left the crew."); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't leave."); }
    finally { setBusy(false); }
  }
  async function post() {
    if (!draft.trim()) return;
    setBusy(true);
    try { await api.post(`/api/groups/${slug}/posts`, { body: draft.trim() }); setDraft(""); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't post."); }
    finally { setBusy(false); }
  }
  async function deletePost(id: string) {
    if (!window.confirm("Delete this post?")) return;
    try { await api.del(`/api/groups/${slug}/posts/${id}`); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't delete."); }
  }
  async function removeMember(userId: string) {
    if (!window.confirm("Remove this member from the group?")) return;
    try { await api.del(`/api/groups/${slug}/members/${userId}`); setNotice("Member removed."); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't remove them."); }
  }
  async function sendBroadcast() {
    if (!broadcast.trim()) return;
    setBusy(true);
    try {
      const d = (await api.post(`/api/groups/${slug}/broadcast`, { body: broadcast.trim() })) as { sent: number };
      setNotice(`Broadcast sent to ${d.sent} members. 📣`);
      setBroadcast(""); setShowBroadcast(false);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't broadcast."); }
    finally { setBusy(false); }
  }

  /* ── Forum actions ─────────────────────────────────────────────────── */
  async function loadThreadsFor(id: string) {
    const d = (await api.get(`/api/groups/${slug}/forum/channels/${id}/threads`)) as { threads: ForumThread[] };
    setThreads(d.threads);
  }
  async function loadForum(openFirst = true) {
    try {
      const d = (await api.get(`/api/groups/${slug}/forum/channels`)) as {
        channels: ForumChannel[]; can_post: boolean; can_moderate: boolean; can_manage_channels: boolean;
      };
      setChannels(d.channels);
      setForumCaps({ can_post: d.can_post, can_moderate: d.can_moderate, can_manage_channels: d.can_manage_channels });
      setForumLoaded(true);
      const target = (channelId && d.channels.some((c) => c.id === channelId)) ? channelId : d.channels[0]?.id ?? null;
      setChannelId(target);
      if (target && openFirst) await loadThreadsFor(target);
      if (!target) setThreads([]);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't load the forum."); }
  }
  useEffect(() => {
    if (tab === "forum" && !forumLoaded) { void loadForum(); }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab, forumLoaded]);
  async function openChannel(id: string) {
    setChannelId(id); setOpenThread(null); setShowThreadForm(false);
    try { await loadThreadsFor(id); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't load threads."); }
  }
  async function createChannel() {
    if (!channelName.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/groups/${slug}/forum/channels`, { name: channelName.trim(), description: channelDesc.trim() });
      setChannelName(""); setChannelDesc(""); setShowChannelForm(false);
      setForumLoaded(false); await loadForum();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't open the channel."); }
    finally { setBusy(false); }
  }
  async function closeChannel(id: string) {
    if (!window.confirm("Close this channel? Its threads and replies go with it.")) return;
    try {
      await api.del(`/api/groups/${slug}/forum/channels/${id}`);
      if (channelId === id) { setChannelId(null); setThreads([]); setOpenThread(null); }
      setForumLoaded(false); await loadForum(false);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't close the channel."); }
  }
  async function createThread() {
    if (!channelId || !threadTitle.trim() || !threadBody.trim()) return;
    setBusy(true);
    try {
      const tags = threadTags.split(",").map((t) => t.trim()).filter(Boolean);
      await api.post(`/api/groups/${slug}/forum/channels/${channelId}/threads`, {
        title: threadTitle.trim(), body: threadBody.trim(), tags,
      });
      setThreadTitle(""); setThreadBody(""); setThreadTags(""); setShowThreadForm(false);
      await loadThreadsFor(channelId);
      setForumLoaded(false); await loadForum(false);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't start the thread."); }
    finally { setBusy(false); }
  }
  async function openThreadView(id: string) {
    try {
      const d = (await api.get(`/api/groups/${slug}/forum/threads/${id}`)) as { thread: ForumThread; replies: ForumReply[] };
      setOpenThread(d); setReplyDraft("");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't load the thread."); }
  }
  async function postReply() {
    if (!openThread || !replyDraft.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/groups/${slug}/forum/threads/${openThread.thread.id}/replies`, { body: replyDraft.trim() });
      setReplyDraft("");
      await openThreadView(openThread.thread.id);
      if (channelId) await loadThreadsFor(channelId);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't post your reply."); }
    finally { setBusy(false); }
  }
  async function deleteThread(id: string) {
    if (!window.confirm("Delete this thread and its replies?")) return;
    try {
      await api.del(`/api/groups/${slug}/forum/threads/${id}`);
      if (openThread?.thread.id === id) setOpenThread(null);
      if (channelId) await loadThreadsFor(channelId);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't delete the thread."); }
  }
  async function deleteReply(threadId: string, replyId: string) {
    if (!window.confirm("Delete this reply?")) return;
    try {
      await api.del(`/api/groups/${slug}/forum/threads/${threadId}/replies/${replyId}`);
      await openThreadView(threadId);
      if (channelId) await loadThreadsFor(channelId);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't delete the reply."); }
  }
  async function moderateThread(t: ForumThread, patch: { is_pinned?: boolean; is_locked?: boolean }) {
    try {
      const d = (await api.patch(`/api/groups/${slug}/forum/threads/${t.id}`, patch)) as { thread: ForumThread };
      setThreads((prev) => prev.map((x) => (x.id === t.id ? d.thread : x)));
      if (openThread?.thread.id === t.id) setOpenThread({ thread: d.thread, replies: openThread.replies });
      if (channelId) await loadThreadsFor(channelId);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't update the thread."); }
  }

  if (loading) return <div className="min-h-screen bg-black text-white"><Loading label="Loading the crew" /></div>;
  if (error || !group) return (
    <div className="min-h-screen bg-black px-6 py-16 text-white"><ErrorBox message={error ?? "Group not found."} onRetry={load} /></div>
  );

  const isOwner = viewerRole === "owner";
  const isMod = viewerRole === "owner" || viewerRole === "admin" || viewerRole === "mod" || viewerRole === "moderator";
  const isMember = !!viewerRole;

  return (
    <div className="min-h-screen bg-black text-white">
      {group.cover_url && <img src={group.cover_url} onError={(e) => { e.currentTarget.style.display = "none"; }} alt="" className="h-56 w-full object-cover" />}
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold">{group.name}</h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-white/60">
              <Users className="h-4 w-4" /> {group.member_count.toLocaleString()} members
              {ownerProfile && (
                <span>· run by <Link href={profileLink(ownerProfile.slug)} className="text-[#e8c86a] hover:underline">{ownerProfile.displayName}</Link></span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ShareButton path={`/groups/${group.slug}`} />
            {user && !isMember && (
              <button type="button" onClick={join} disabled={busy} className={goldButton}>
                {busy ? "Joining…" : "Join the crew"}
              </button>
            )}
            {user && isMember && !isOwner && (
              <button type="button" onClick={leave} disabled={busy} className={ghostButton}>Leave</button>
            )}
          </div>
        </div>

        {notice && (
          <div className="mt-4 rounded-lg border border-[#e8c86a]/30 bg-[#e8c86a]/10 px-4 py-2 text-sm text-[#e8c86a]">
            {notice}
          </div>
        )}

        {isOwner && (
          <div className="mt-4 rounded-xl border border-[#e8c86a]/25 bg-[#0d0a02] p-4 text-sm">
            <p className="font-semibold text-[#e8c86a]">💰 Owner move: monetize this crew</p>
            <p className="mt-1 text-white/60">Free members build the movement — paid tiers pay for it. Add a VIP tier, exclusive drops, early access.</p>
            <Link href="/memberships" className="mt-2 inline-block text-[#e8c86a] hover:underline">Set up paid tiers →</Link>
          </div>
        )}

        <div className="mt-6">
          <GroupOnboarding slug={slug} members={members} />
        </div>

        <div className="mt-6 flex gap-2 border-b border-white/10">
          {(["about", "feed", "forum", "members"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-semibold capitalize transition ${tab === t ? "border-b-2 border-[#e8c86a] text-[#e8c86a]" : "text-white/60 hover:text-white"}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === "about" && (
          <div className={`mt-6 space-y-4 rounded-3xl border p-5 sm:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <p className="whitespace-pre-wrap text-white/80">{group.description || "No description yet — the vibe speaks for itself."}</p>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href="/events" className="text-[#e8c86a]/80 hover:text-[#e8c86a]">→ Upcoming events</Link>
              <Link href="/explore" className="text-[#e8c86a]/80 hover:text-[#e8c86a]">→ Explore everything</Link>
            </div>
          </div>
        )}

        {tab === "feed" && (
          <div className="mt-6 space-y-4">
            {user && isMember && (
              <div className="rounded-xl border border-white/10 bg-[#0d0a02] p-4">
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={2000}
                  placeholder="Say something to the crew…" className={goldInput} />
                <div className="mt-2 flex justify-end">
                  <button type="button" onClick={post} disabled={busy || !draft.trim()} className={goldButton}>
                    <span className="inline-flex items-center gap-2"><Send className="h-4 w-4" /> Post</span>
                  </button>
                </div>
              </div>
            )}
            {feedError ? (
              <ErrorBox message={feedError} onRetry={loadFeed} />
            ) : (<>
            {posts.map((p) => (
              <div key={p.id} className="rounded-xl border border-white/10 bg-[#0d0a02] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {p.author?.avatarUrl && <img src={p.author.avatarUrl} onError={(e) => { e.currentTarget.style.display = "none"; }} alt="" className="h-8 w-8 rounded-full object-cover" />}
                    <div>
                      {p.author
                        ? <Link href={profileLink(p.author.slug)} className="text-sm font-semibold text-[#e8c86a] hover:underline">{p.author.displayName}</Link>
                        : <span className="text-sm font-semibold text-white/70">A member</span>}
                      <p className="text-xs text-white/40">{timeAgo(p.created_at)}</p>
                    </div>
                  </div>
                  {p.can_delete && (
                    <button type="button" onClick={() => deletePost(p.id)} data-min-stars={isMod && p.author_user_id !== user?.id ? "4" : "1"}
                      className="text-white/40 hover:text-red-400" title="Delete post">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-white/85">{p.body}</p>
              </div>
            ))}
            {posts.length === 0 && <p className="py-8 text-center text-white/40">Quiet in here… break the ice. 🧊</p>}
            </>)}
          </div>
        )}

        {tab === "forum" && (
          <div className="mt-6">
            {!forumLoaded ? (
              <Loading label="Loading the forum" />
            ) : openThread ? (
              /* ── One thread, with its replies ─────────────────────── */
              <div>
                <button type="button" onClick={() => setOpenThread(null)} className="inline-flex items-center gap-1 text-sm text-[#e8c86a] hover:underline">
                  <ArrowLeft className="h-4 w-4" /> Back to threads
                </button>
                <div className="mt-4 rounded-xl border border-white/10 bg-[#0d0a02] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold">
                      {openThread.thread.is_pinned && <Pin className="h-4 w-4 text-[#e8c86a]" />}
                      {openThread.thread.title}
                      {openThread.thread.is_locked && <Lock className="h-4 w-4 text-white/50" />}
                    </h2>
                    <div className="flex items-center gap-2">
                      {openThread.thread.can_moderate && (
                        <>
                          <button type="button" onClick={() => moderateThread(openThread.thread, { is_pinned: !openThread.thread.is_pinned })}
                            className="text-xs text-white/50 hover:text-[#e8c86a]">
                            {openThread.thread.is_pinned ? "Unpin" : "Pin"}
                          </button>
                          <button type="button" onClick={() => moderateThread(openThread.thread, { is_locked: !openThread.thread.is_locked })}
                            className="text-xs text-white/50 hover:text-[#e8c86a]">
                            {openThread.thread.is_locked ? "Unlock" : "Lock"}
                          </button>
                        </>
                      )}
                      {openThread.thread.can_delete && (
                        <button type="button" onClick={() => deleteThread(openThread.thread.id)} className="text-white/40 hover:text-red-400" title="Delete thread">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-white/40">
                    {openThread.thread.author
                      ? <Link href={profileLink(openThread.thread.author.slug)} className="text-[#e8c86a] hover:underline">{openThread.thread.author.displayName}</Link>
                      : "A member"} · {timeAgo(openThread.thread.created_at)}
                  </p>
                  {openThread.thread.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {openThread.thread.tags.map((tag) => (
                        <span key={tag} className="rounded-full border border-[#e8c86a]/30 bg-[#e8c86a]/10 px-2 py-0.5 text-xs text-[#e8c86a]">#{tag}</span>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 whitespace-pre-wrap text-white/85">{openThread.thread.body}</p>
                </div>

                <div className="mt-4 space-y-3">
                  {openThread.replies.map((r) => (
                    <div key={r.id} className="rounded-xl border border-white/10 bg-[#0d0a02] p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {r.author?.avatarUrl && <img src={r.author.avatarUrl} onError={(e) => { e.currentTarget.style.display = "none"; }} alt="" className="h-8 w-8 rounded-full object-cover" />}
                          <div>
                            {r.author
                              ? <Link href={profileLink(r.author.slug)} className="text-sm font-semibold text-[#e8c86a] hover:underline">{r.author.displayName}</Link>
                              : <span className="text-sm font-semibold text-white/70">A member</span>}
                            <p className="text-xs text-white/40">{timeAgo(r.created_at)}</p>
                          </div>
                        </div>
                        {r.can_delete && (
                          <button type="button" onClick={() => deleteReply(openThread.thread.id, r.id)} className="text-white/40 hover:text-red-400" title="Delete reply">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-white/85">{r.body}</p>
                    </div>
                  ))}
                  {openThread.replies.length === 0 && (
                    <p className="py-6 text-center text-white/40">No replies yet — be the first to answer.</p>
                  )}
                </div>

                {openThread.thread.is_locked && !forumCaps.can_moderate ? (
                  <p className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d0a02] p-4 text-sm text-white/50">
                    <Lock className="h-4 w-4" /> This thread is locked by the crew's moderators — no new replies.
                  </p>
                ) : forumCaps.can_post ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-[#0d0a02] p-4">
                    <textarea value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)} rows={3} maxLength={5000}
                      placeholder="Write your reply…" className={goldInput} />
                    <div className="mt-2 flex justify-end">
                      <button type="button" onClick={postReply} disabled={busy || !replyDraft.trim()} className={goldButton}>
                        <span className="inline-flex items-center gap-2"><Send className="h-4 w-4" /> Reply</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl border border-white/10 bg-[#0d0a02] p-4 text-sm text-white/50">
                    {user ? "Join the crew to reply in this thread." : "Sign in and join the crew to reply in this thread."}
                  </p>
                )}
              </div>
            ) : (
              /* ── Channel list + the open channel's threads ──────── */
              <div className="flex flex-col gap-4 md:flex-row">
                <div className="shrink-0 space-y-2 md:w-64">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white/70">Channels</p>
                    {forumCaps.can_manage_channels && (
                      <button type="button" onClick={() => setShowChannelForm(!showChannelForm)} className={ghostButton}>
                        <span className="inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> New</span>
                      </button>
                    )}
                  </div>
                  {showChannelForm && forumCaps.can_manage_channels && (
                    <div className="rounded-xl border border-[#e8c86a]/25 bg-[#0d0a02] p-3">
                      <input value={channelName} onChange={(e) => setChannelName(e.target.value)} maxLength={60}
                        placeholder="Channel name" className={goldInput} />
                      <input value={channelDesc} onChange={(e) => setChannelDesc(e.target.value)} maxLength={500}
                        placeholder="What's it for? (optional)" className={`${goldInput} mt-2`} />
                      <div className="mt-2 flex justify-end">
                        <button type="button" onClick={createChannel} disabled={busy || !channelName.trim()} className={goldButton}>
                          Open channel
                        </button>
                      </div>
                    </div>
                  )}
                  {channels.length === 0 && (
                    <p className="rounded-xl border border-white/10 bg-[#0d0a02] p-4 text-sm text-white/40">
                      No channels yet — this crew hasn't opened its forum boards.
                      {forumCaps.can_manage_channels
                        ? " Open the first channel above to get the conversation organized."
                        : " Check back once the crew's admins set them up."}
                    </p>
                  )}
                  {channels.map((c) => (
                    <div key={c.id} className={`flex w-full items-center gap-2 rounded-xl border p-3 text-left transition ${
                      c.id === channelId ? "border-[#e8c86a]/50 bg-[#e8c86a]/10" : "border-white/10 bg-[#0d0a02] hover:border-white/25"}`}>
                      <button type="button" onClick={() => openChannel(c.id)} className="flex min-w-0 flex-1 items-center gap-2">
                        <Hash className="h-4 w-4 shrink-0 text-[#e8c86a]" />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{c.name}</span>
                          {c.description && <span className="block truncate text-xs text-white/40">{c.description}</span>}
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-white/40">{c.thread_count} threads</span>
                      </button>
                      {forumCaps.can_manage_channels && (
                        <button type="button" onClick={() => closeChannel(c.id)} className="shrink-0 text-white/30 hover:text-red-400" title="Close channel">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="min-w-0 flex-1 space-y-3">
                  {!forumCaps.can_post && channels.length > 0 && (
                    <p className="rounded-xl border border-white/10 bg-[#0d0a02] p-3 text-sm text-white/50">
                      {user ? "You're reading the forum — join the crew to start threads and reply." : "You're reading as a guest — sign in and join the crew to post."}
                    </p>
                  )}
                  {forumCaps.can_post && channelId && (
                    <div className="flex justify-end">
                      <button type="button" onClick={() => setShowThreadForm(!showThreadForm)} className={goldButton}>
                        <span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Start a thread</span>
                      </button>
                    </div>
                  )}
                  {showThreadForm && forumCaps.can_post && channelId && (
                    <div className="rounded-xl border border-[#e8c86a]/25 bg-[#0d0a02] p-4">
                      <input value={threadTitle} onChange={(e) => setThreadTitle(e.target.value)} maxLength={120}
                        placeholder="Thread title" className={goldInput} />
                      <textarea value={threadBody} onChange={(e) => setThreadBody(e.target.value)} rows={4} maxLength={5000}
                        placeholder="Start the conversation…" className={`${goldInput} mt-2`} />
                      <input value={threadTags} onChange={(e) => setThreadTags(e.target.value)}
                        placeholder="Tags (optional, comma-separated — e.g. releases, feedback)" className={`${goldInput} mt-2`} />
                      <div className="mt-2 flex justify-end">
                        <button type="button" onClick={createThread} disabled={busy || !threadTitle.trim() || !threadBody.trim()} className={goldButton}>
                          Post thread
                        </button>
                      </div>
                    </div>
                  )}
                  {threads.map((t) => (
                    <div key={t.id} className="rounded-xl border border-white/10 bg-[#0d0a02] p-4">
                      <div className="flex items-start justify-between gap-2">
                        <button type="button" onClick={() => openThreadView(t.id)} className="min-w-0 text-left">
                          <span className="flex flex-wrap items-center gap-2 font-semibold hover:text-[#e8c86a]">
                            {t.is_pinned && <Pin className="h-3.5 w-3.5 text-[#e8c86a]" />}
                            {t.title}
                            {t.is_locked && <Lock className="h-3.5 w-3.5 text-white/50" />}
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-2">
                          {t.can_moderate && (
                            <>
                              <button type="button" onClick={() => moderateThread(t, { is_pinned: !t.is_pinned })} className="text-xs text-white/50 hover:text-[#e8c86a]">
                                {t.is_pinned ? "Unpin" : "Pin"}
                              </button>
                              <button type="button" onClick={() => moderateThread(t, { is_locked: !t.is_locked })} className="text-xs text-white/50 hover:text-[#e8c86a]">
                                {t.is_locked ? "Unlock" : "Lock"}
                              </button>
                            </>
                          )}
                          {t.can_delete && (
                            <button type="button" onClick={() => deleteThread(t.id)} className="text-white/40 hover:text-red-400" title="Delete thread">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-white/40">
                        {t.author
                          ? <Link href={profileLink(t.author.slug)} className="text-[#e8c86a] hover:underline">{t.author.displayName}</Link>
                          : "A member"} · {timeAgo(t.last_reply_at ?? t.created_at)} ·{" "}
                        <span className="inline-flex items-center gap-1"><MessagesSquare className="h-3 w-3" /> {t.reply_count} replies</span>
                      </p>
                      {t.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {t.tags.map((tag) => (
                            <span key={tag} className="rounded-full border border-[#e8c86a]/30 bg-[#e8c86a]/10 px-2 py-0.5 text-xs text-[#e8c86a]">#{tag}</span>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-white/70">{t.body}</p>
                    </div>
                  ))}
                  {channelId && threads.length === 0 && (
                    <p className="py-8 text-center text-white/40">
                      No threads in this channel yet.{forumCaps.can_post ? " Start the first one above." : ""}
                    </p>
                  )}
                  {!channelId && channels.length > 0 && (
                    <p className="py-8 text-center text-white/40">Pick a channel to see its threads.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "members" && (
          <div className="mt-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0d0a02] p-3">
                  <div className="flex items-center gap-3">
                    {m.profile?.avatarUrl && <img src={m.profile.avatarUrl} onError={(e) => { e.currentTarget.style.display = "none"; }} alt="" className="h-9 w-9 rounded-full object-cover" />}
                    <div>
                      {m.profile
                        ? <Link href={profileLink(m.profile.slug)} className="font-semibold hover:text-[#e8c86a]">{m.profile.displayName}</Link>
                        : <span className="font-semibold text-white/70">Member</span>}
                      <p className="flex items-center gap-1 text-xs text-white/40">
                        {m.role === "owner" && <Crown className="h-3 w-3 text-[#e8c86a]" />}
                        {m.role}
                      </p>
                    </div>
                  </div>
                  {isOwner && m.role !== "owner" && (
                    <button type="button" onClick={() => removeMember(m.user_id)} data-min-stars="4"
                      className="text-xs text-white/40 hover:text-red-400" title="Remove member">
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isOwner && (
              <div className="mt-6 rounded-xl border border-[#e8c86a]/25 bg-[#0d0a02] p-4" data-min-stars="5">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 font-semibold text-[#e8c86a]">
                    <Megaphone className="h-4 w-4" /> Broadcast DM <span className="text-xs font-normal text-white/40">(5★ power tool)</span>
                  </p>
                  <button type="button" onClick={() => setShowBroadcast(!showBroadcast)} className={ghostButton}>
                    {showBroadcast ? "Hide" : "Compose"}
                  </button>
                </div>
                {showBroadcast && (
                  <div className="mt-3">
                    <textarea value={broadcast} onChange={(e) => setBroadcast(e.target.value)} rows={3} maxLength={2000}
                      placeholder="One message to every member's DMs…" className={goldInput} />
                    <div className="mt-2 flex justify-end">
                      <button type="button" onClick={sendBroadcast} disabled={busy || !broadcast.trim()} className={goldButton}>
                        {busy ? "Sending…" : "Broadcast"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isMod && (
              <p className="mt-4 flex items-center gap-2 text-xs text-white/40" data-min-stars="4">
                <ShieldAlert className="h-3.5 w-3.5" /> Moderation tools unlock at 4 stars — remove members, delete posts.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
