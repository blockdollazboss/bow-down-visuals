import { useState } from "react";
import { Link } from "wouter";
import { MessageCircle, Repeat2, Quote, Bookmark, Share2, Trash2, BadgeCheck, BarChart3, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, apiJson, profileHref, type FeedPost, type PollData } from "@/lib/social-api";
import { Avatar } from "./Avatar";
import { RichText } from "./RichText";
import { AttachmentView } from "./AttachmentView";
import { Composer } from "./Composer";

const REACTIONS = [
  { emoji: "like", icon: "❤️", label: "Like" },
  { emoji: "love", icon: "😍", label: "Love" },
  { emoji: "fire", icon: "🔥", label: "Fire" },
  { emoji: "clap", icon: "👏", label: "Clap" },
  { emoji: "mindblown", icon: "🤯", label: "Mindblown" },
] as const;

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

async function authed(getAccessToken: () => Promise<string | null>): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function PostCard({
  post,
  onDeleted,
  onReposted,
  depth = 0,
}: {
  post: FeedPost;
  onDeleted?: (id: string) => void;
  onReposted?: () => void;
  depth?: number;
}) {
  const { getAccessToken, user } = useAuth();
  const [emoji, setEmoji] = useState<string | null>(post.viewer_emoji);
  const [counts, setCounts] = useState<Record<string, number>>(post.reaction_counts ?? {});
  const [saved, setSaved] = useState(post.viewer_saved);
  const [reposted, setReposted] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState<FeedPost[]>([]);
  const [repliesLoaded, setRepliesLoaded] = useState(false);
  const [poll, setPoll] = useState<PollData | null>(post.poll);
  const [voting, setVoting] = useState(false);
  const [earningHint, setEarningHint] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  /* Delete/analytics are owner-gated server-side (403 otherwise) — no client
     hint needed; the buttons fail closed. */
  void user;

  async function react(next: string) {
    const prev = emoji;
    const removing = prev === next;
    setEmoji(removing ? null : next);
    setCounts((c) => {
      const n = { ...c };
      if (prev) n[prev] = Math.max(0, (n[prev] ?? 1) - 1);
      if (!removing) n[next] = (n[next] ?? 0) + 1;
      return n;
    });
    try {
      if (removing) {
        await apiFetch(getAccessToken, `/api/react?target_kind=post&target_id=${post.id}`, {
          method: "DELETE",
          headers: await authed(getAccessToken),
        });
      } else {
        await apiJson(getAccessToken, "/api/react", {
          method: "POST",
          body: JSON.stringify({ target_kind: "post", target_id: post.id, emoji: next }),
        });
      }
    } catch {
      setEmoji(prev);
    }
  }

  async function toggleSave() {
    const next = !saved;
    setSaved(next);
    try {
      if (next) {
        await apiJson(getAccessToken, "/api/saves", {
          method: "POST",
          body: JSON.stringify({ kind: "post", target_id: post.id }),
        });
      } else {
        await apiFetch(getAccessToken, `/api/saves/post/${post.id}`, {
          method: "DELETE",
          headers: await authed(getAccessToken),
        });
      }
    } catch {
      setSaved(!next);
    }
  }

  async function repost() {
    if (reposted) return;
    try {
      await apiJson(getAccessToken, `/api/posts/${post.id}/repost`, { method: "POST" });
      setReposted(true);
      onReposted?.();
    } catch { /* already reposted or failed — stay quiet */ }
  }

  async function loadReplies() {
    if (repliesLoaded) {
      setShowReplies((v) => !v);
      return;
    }
    try {
      const data = await apiJson<{ replies: FeedPost[] }>(getAccessToken, `/api/posts/${post.id}/replies`);
      setReplies(data.replies);
      setRepliesLoaded(true);
      setShowReplies(true);
    } catch { /* ignore */ }
  }

  async function vote(optionId: string) {
    if (voting || poll?.viewer_option_id) return;
    setVoting(true);
    try {
      const data = await apiJson<{ poll: PollData }>(getAccessToken, `/api/posts/${post.id}/poll/vote`, {
        method: "POST",
        body: JSON.stringify({ option_id: optionId }),
      });
      setPoll(data.poll);
    } catch { /* ignore */ } finally {
      setVoting(false);
    }
  }

  async function loadAnalytics() {
    if (showAnalytics) {
      setShowAnalytics(false);
      return;
    }
    try {
      const data = await apiJson<{ analytics: { earning_hint: string } }>(getAccessToken, `/api/posts/${post.id}/analytics`);
      setEarningHint(data.analytics.earning_hint);
      setShowAnalytics(true);
    } catch {
      /* not your post — API 403s, stay quiet */
    }
  }

  async function del() {
    if (!window.confirm("Delete this post?")) return;
    try {
      await apiFetch(getAccessToken, `/api/posts/${post.id}`, {
        method: "DELETE",
        headers: await authed(getAccessToken),
      });
      onDeleted?.(post.id);
    } catch { /* ignore */ }
  }

  async function share() {
    /* ?ref=CODE — referral link rides along on every share. */
    let ref = "";
    try {
      const data = await apiJson<{ code?: string }>(getAccessToken, "/api/referrals/me").catch(() => null);
      ref = data?.code ? `?ref=${data.code}` : "";
    } catch { /* no referral code — share plain */ }
    const url = `${window.location.origin}/home${ref}#post-${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareMsg("Link copied — your ref code rides along 🦈");
    } catch {
      setShareMsg(url);
    }
    window.setTimeout(() => setShareMsg(null), 3000);
  }

  const totalReactions = Object.values(counts).reduce((a, b) => a + b, 0);
  const pollTotal = poll ? poll.options.reduce((a, o) => a + o.vote_count, 0) : 0;

  return (
    <article id={`post-${post.id}`} className="rounded-2xl border border-[#2a2a2a] bg-[#111] p-4">
      <div className="flex items-start gap-3">
        <Avatar author={post.author} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={profileHref(post.author)} className="truncate text-sm font-bold text-white hover:text-[#d4af37]">
              {post.author?.display_name ?? "Creator"}
            </Link>
            {post.author?.is_verified && <BadgeCheck className="h-4 w-4 shrink-0 text-[#d4af37]" aria-label="Verified" />}
            <span className="shrink-0 text-xs text-neutral-500">· {timeAgo(post.created_at)}</span>
            {post.audience === "followers" && (
              <span className="shrink-0 rounded-full border border-[#2a2a2a] px-2 py-0.5 text-[10px] text-neutral-400">followers</span>
            )}
          </div>

          {post.body && <RichText body={post.body} className="mt-1.5 text-[15px] leading-relaxed text-neutral-100" />}

          <AttachmentView attachments={post.media_urls ?? []} />

          {/* poll */}
          {poll && (
            <div className="mt-3 space-y-2">
              {poll.options.map((o) => {
                const pct = pollTotal > 0 ? Math.round((o.vote_count / pollTotal) * 100) : 0;
                const mine = poll.viewer_option_id === o.id;
                return (
                  <button
                    key={o.id}
                    onClick={() => vote(o.id)}
                    disabled={!!poll.viewer_option_id || voting}
                    className={`relative w-full overflow-hidden rounded-xl border px-3 py-2 text-left text-sm ${
                      mine ? "border-[#d4af37] text-[#f5e08c]" : "border-[#2a2a2a] text-neutral-200"
                    } ${poll.viewer_option_id ? "" : "hover:border-[#d4af37]/60"}`}
                  >
                    <span className="absolute inset-y-0 left-0 bg-[#d4af37]/15" style={{ width: `${pct}%` }} />
                    <span className="relative flex items-center justify-between">
                      <span className="flex items-center gap-2">{mine && <Check className="h-4 w-4" />}{o.option_text}</span>
                      <span className="text-xs text-neutral-400">{pct}%</span>
                    </span>
                  </button>
                );
              })}
              <p className="text-[11px] text-neutral-500">{pollTotal} vote{pollTotal === 1 ? "" : "s"}</p>
            </div>
          )}

          {/* quoted post */}
          {post.quoted && (
            <div className="mt-3">
              <PostCard post={post.quoted} depth={depth + 1} />
            </div>
          )}

          {/* action row */}
          <div className="mt-3 flex items-center justify-between border-t border-[#1f1f1f] pt-2.5">
            <div className="flex items-center gap-1 sm:gap-2">
              {/* reactions — like stays the default, tap the count for the full set */}
              <div className="group relative">
                <button
                  onClick={() => react("like")}
                  aria-label="Like"
                  className={`flex items-center gap-1 rounded-full px-2 py-1.5 text-sm ${emoji === "like" ? "text-red-400" : "text-neutral-400 hover:text-red-400"}`}
                >
                  <span className="text-base">{emoji === "like" ? "❤️" : "🤍"}</span>
                  {(counts["like"] ?? 0) > 0 && <span className="text-xs">{counts["like"]}</span>}
                </button>
                <div className="absolute bottom-full left-0 z-10 mb-1 hidden gap-1 rounded-full border border-[#2a2a2a] bg-[#1a1a1a] p-1.5 shadow-xl group-hover:flex">
                  {REACTIONS.map((r) => (
                    <button
                      key={r.emoji}
                      onClick={() => react(r.emoji)}
                      title={r.label}
                      className={`rounded-full p-1.5 text-lg transition hover:scale-125 ${emoji === r.emoji ? "bg-[#d4af37]/20" : ""}`}
                    >
                      {r.icon}
                    </button>
                  ))}
                </div>
              </div>
              {totalReactions > (counts["like"] ?? 0) && (
                <span className="text-xs text-neutral-500">+{totalReactions - (counts["like"] ?? 0)}</span>
              )}

              <button onClick={() => { setShowReply((v) => !v); }} aria-label="Reply" className="flex items-center gap-1 rounded-full px-2 py-1.5 text-sm text-neutral-400 hover:text-[#d4af37]">
                <MessageCircle className="h-[18px] w-[18px]" />
                {post.reply_count > 0 && <span className="text-xs">{post.reply_count}</span>}
              </button>

              <button onClick={repost} aria-label="Repost" className={`flex items-center gap-1 rounded-full px-2 py-1.5 text-sm ${reposted ? "text-[#d4af37]" : "text-neutral-400 hover:text-[#d4af37]"}`}>
                <Repeat2 className="h-[18px] w-[18px]" />
                {(post.repost_count + (reposted ? 1 : 0)) > 0 && <span className="text-xs">{post.repost_count + (reposted ? 1 : 0)}</span>}
              </button>

              <button onClick={() => setShowQuote((v) => !v)} aria-label="Quote" className="rounded-full p-2 text-sm text-neutral-400 hover:text-[#d4af37]">
                <Quote className="h-[18px] w-[18px]" />
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button onClick={loadAnalytics} aria-label="Post analytics" title="How's this post doing?" className="rounded-full p-2 text-neutral-400 hover:text-[#d4af37]">
                <BarChart3 className="h-[18px] w-[18px]" />
              </button>
              <button onClick={toggleSave} aria-label="Save" className={`rounded-full p-2 ${saved ? "text-[#d4af37]" : "text-neutral-400 hover:text-[#d4af37]"}`}>
                <Bookmark className={`h-[18px] w-[18px] ${saved ? "fill-[#d4af37]" : ""}`} />
              </button>
              <button onClick={share} aria-label="Share" className="rounded-full p-2 text-neutral-400 hover:text-[#d4af37]">
                <Share2 className="h-[18px] w-[18px]" />
              </button>
              <button onClick={del} aria-label="Delete post" className="rounded-full p-2 text-neutral-500 hover:text-red-400">
                <Trash2 className="h-[16px] w-[16px]" />
              </button>
            </div>
          </div>
          {shareMsg && <p className="mt-1 break-all text-xs text-[#d4af37]">{shareMsg}</p>}

          {/* earning hint — guide them to the money */}
          {showAnalytics && earningHint && (
            <div className="mt-2 rounded-xl border border-[#d4af37]/40 bg-gradient-to-r from-[#1a1408] to-transparent p-3">
              <p className="text-xs leading-relaxed text-[#f5e08c]">💰 {earningHint}</p>
            </div>
          )}

          {showReply && (
            <div className="mt-2">
              <Composer
                replyTo={post.id}
                placeholder="Write your reply…"
                onPosted={(p) => {
                  setReplies((r) => [...r, p]);
                  setRepliesLoaded(true);
                  setShowReplies(true);
                  setShowReply(false);
                }}
              />
              <p className="mt-1 text-[11px] text-neutral-500">Replies post as a thread under this post.</p>
            </div>
          )}
          {showQuote && (
            <div className="mt-2">
              <Composer
                quoteOf={{ id: post.id, body: post.body, authorName: post.author?.display_name ?? "Creator" }}
                placeholder="Add your take…"
                onPosted={() => setShowQuote(false)}
              />
            </div>
          )}

          {post.reply_count > 0 && depth === 0 && (
            <button onClick={loadReplies} className="mt-2 text-xs font-semibold text-[#d4af37] hover:underline">
              {showReplies ? "Hide replies" : `View ${post.reply_count} ${post.reply_count === 1 ? "reply" : "replies"}`}
            </button>
          )}
          {showReplies && (
            <div className="mt-2 space-y-2 border-l-2 border-[#d4af37]/30 pl-3">
              {replies.map((r) => (
                <PostCard key={r.id} post={r} depth={depth + 1} onDeleted={(id) => setReplies((x) => x.filter((p) => p.id !== id))} />
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
