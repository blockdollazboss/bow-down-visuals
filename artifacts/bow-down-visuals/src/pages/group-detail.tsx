import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Users, Crown, Trash2, Send, Megaphone, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCommunityApi, ShareButton, Loading, ErrorBox, profileLink, timeAgo,
  goldInput, goldButton, ghostButton,
} from "@/lib/community-ui";

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

export default function GroupDetail() {
  const [, params] = useRoute("/groups/:slug");
  const slug = params?.slug ?? "";
  const api = useCommunityApi();
  const { user } = useAuth();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<{ slug: string; displayName: string } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const [tab, setTab] = useState<"about" | "feed" | "members">("feed");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [broadcast, setBroadcast] = useState("");
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const d = (await api.get(`/api/groups/${slug}`)) as {
        group: GroupDetail; owner_profile: { slug: string; displayName: string } | null;
        members: Member[]; viewer_role: string | null;
      };
      setGroup(d.group); setOwnerProfile(d.owner_profile); setMembers(d.members); setViewerRole(d.viewer_role);
      const f = (await api.get(`/api/groups/${slug}/feed`)) as { posts: Post[]; viewer_role: string | null };
      setPosts(f.posts);
      if (f.viewer_role) setViewerRole(f.viewer_role);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the group.");
    } finally { setLoading(false); }
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

  if (loading) return <div className="min-h-screen bg-black text-white"><Loading label="Loading the crew" /></div>;
  if (error || !group) return (
    <div className="min-h-screen bg-black px-6 py-16 text-white"><ErrorBox message={error ?? "Group not found."} /></div>
  );

  const isOwner = viewerRole === "owner";
  const isMod = viewerRole === "owner" || viewerRole === "mod";
  const isMember = !!viewerRole;

  return (
    <div className="min-h-screen bg-black text-white">
      {group.cover_url && <img src={group.cover_url} alt="" className="h-56 w-full object-cover" />}
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

        <div className="mt-6 flex gap-2 border-b border-white/10">
          {(["about", "feed", "members"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-semibold capitalize transition ${tab === t ? "border-b-2 border-[#e8c86a] text-[#e8c86a]" : "text-white/60 hover:text-white"}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === "about" && (
          <div className="mt-6 space-y-4">
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
            {posts.map((p) => (
              <div key={p.id} className="rounded-xl border border-white/10 bg-[#0d0a02] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {p.author?.avatarUrl && <img src={p.author.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />}
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
          </div>
        )}

        {tab === "members" && (
          <div className="mt-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0d0a02] p-3">
                  <div className="flex items-center gap-3">
                    {m.profile?.avatarUrl && <img src={m.profile.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />}
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
