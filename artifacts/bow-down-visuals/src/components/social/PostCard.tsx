import { useState } from "react";
import { Link } from "wouter";
import { MessageCircle, Repeat2, Quote, Bookmark, Share2, Trash2, BadgeCheck, BarChart3, Check, ShieldAlert, Lock, Crown, AlertTriangle, Eye } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { apiFetch, apiJson, profileHref, revealPostContent, type FeedPost, type LooseAttachment, type PollData } from "@/lib/social-api";
import { contentWarningNames, revealedMediaThisSession } from "@/lib/content-warnings";
import { removalReasonLabel } from "@/lib/content-removal";
import { Avatar } from "./Avatar";
import { RichText } from "./RichText";
import { AttachmentView } from "./AttachmentView";
import { Composer } from "./Composer";
import { ReactionSticker } from "./KingEmoji";
import { ReportButton } from "./ReportButton";
import { REACTION_ART, REACTION_KEYS } from "@/lib/king-emoji";

/* Reactions: the five keys are the server's contract (routes/social.ts
   validates + stores the key) — unchanged. What renders is the King's
   own art now: REACTION_ART in lib/king-emoji maps each key to a
   sticker from the owner's set, theme-aware. */

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
  const isLight = useIsLightTheme();
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
  /* Content warnings (Wave 4 #40): a covered post arrives with NO
     media — the reveal fetches this one item's media through the
     reveal door, and the session registry remembers it (per item,
     per session; a reload covers everything again). */
  const cover = post.content_cover ?? null;
  const [revealedMedia, setRevealedMedia] = useState<LooseAttachment[] | null>(
    () => (revealedMediaThisSession(post.id) as LooseAttachment[] | null) ?? null,
  );
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const coveredNow = !!cover && !revealedMedia;

  async function reveal() {
    if (revealing) return;
    setRevealing(true);
    setRevealError(null);
    try {
      const media = await revealPostContent(getAccessToken, post.id);
      setRevealedMedia(media);
    } catch (e) {
      setRevealError(e instanceof Error ? e.message : "Couldn't reveal that media.");
    } finally {
      setRevealing(false);
    }
  }

  /* Delete/analytics are owner-gated server-side (403 otherwise) — no client
     hint needed; the buttons fail closed. `user` gates the Report action:
     reporting is members-only, and a self-report is refused server-side
     with the reason shown in the dialog. */

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
  /* Moderation removal (Stack-4): the server serves a removed post
     ONLY to its author, with moderation_removed set — this card is
     that author's honest view. Tombstone, not a vanishing act: the
     banner + recorded reason show, the author's own words stay
     readable to them, and every engagement surface (attachments,
     poll, quote embed, actions, composers, replies) is suppressed. */
  const removed = !!post.moderation_removed;
  /* Members-only teaser (Wave 4 #33): the server locked this post for
     the viewer — body/media never arrived, only member_lock did. The
     card renders the lock panel and nothing else content-bearing: no
     words, no attachments, no poll, no quote embed, no actions. */
  const locked = !!post.member_lock;

  return (
    <article id={`post-${post.id}`} className="rounded-2xl border border-[#2a2a2a] bg-[#111] p-4">
      <div className="flex items-start gap-3">
        <Avatar author={post.author} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={profileHref(post.author)} className="truncate min-w-0 text-sm font-bold text-white hover:text-[#d4af37]">
              {post.author?.display_name ?? "Creator"}
            </Link>
            {post.author?.is_verified && <BadgeCheck className="h-4 w-4 shrink-0 text-[#d4af37]" aria-label="Verified" />}
            {/* Co-post byline (Stack-100 #3, #24): the OTHER standing
                creator is named right beside the author — one post on
                both profiles. A withdrawn side is never bylined: their
                withdrawal removed their name along with the post from
                their profile. */}
            {!removed &&
              (post.co_authors ?? [])
                .filter((a) => a.status === "accepted" && a.profile_id !== post.profile_id)
                .map((a) => (
                  <span key={a.profile_id} className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 text-xs font-bold text-[#d4af37]">×</span>
                    <Link
                      href={a.slug ? `/artist/${a.slug}` : "#"}
                      className="truncate min-w-0 text-sm font-bold text-white hover:text-[#d4af37]"
                    >
                      {a.display_name ?? "Creator"}
                    </Link>
                    {a.is_verified && <BadgeCheck className="h-4 w-4 shrink-0 text-[#d4af37]" aria-label="Verified" />}
                  </span>
                ))}
            {!removed &&
              (post.co_authors ?? []).filter((a) => a.status === "accepted").length >= 2 && (
                <span
                  className="shrink-0 rounded-full border border-[#d4af37]/50 px-2 py-0.5 text-[10px] font-bold text-[#e8c86a]"
                  title="One post on both profiles — one shared set of likes and comments, never counted twice. Either creator can withdraw their own side: the post leaves their profile, and the other creator keeps theirs."
                >
                  Co-post
                </span>
              )}
            <span className="shrink-0 text-xs text-neutral-500">· {timeAgo(post.created_at)}</span>
            {post.audience === "followers" && (
              <span className="shrink-0 rounded-full border border-[#2a2a2a] px-2 py-0.5 text-[10px] text-neutral-400">followers</span>
            )}
            {post.audience === "close_friends" && (
              <span className="shrink-0 rounded-full border border-[#d4af37]/50 px-2 py-0.5 text-[10px] text-[#e8c86a]">close friends</span>
            )}
            {post.audience === "members" && (
              <span className="shrink-0 rounded-full border border-[#d4af37]/50 px-2 py-0.5 text-[10px] text-[#e8c86a]">
                members{post.min_tier ? ` · ${post.min_tier.name}+` : ""}
              </span>
            )}
            {!removed && (post.content_warnings?.length ?? 0) > 0 && (
              <span
                className="flex shrink-0 items-center gap-1 rounded-full border border-amber-400/50 px-2 py-0.5 text-[10px] text-amber-300"
                title="The creator labelled this post — its media stays covered until you tap to reveal it"
                data-testid="post-content-warning-chip"
              >
                <AlertTriangle className="h-3 w-3" /> {contentWarningNames(post.content_warnings ?? [])}
              </span>
            )}
          </div>

          {post.why && (
            <p className="mt-1 text-[11px] text-neutral-500" data-testid="post-why">{post.why.label}</p>
          )}
          {removed && (
            <div className="mt-2 rounded-xl border border-red-400/40 bg-red-400/10 px-3 py-2" data-testid="post-removed-banner">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-red-300">
                <ShieldAlert className="h-4 w-4 shrink-0" /> Removed by moderation
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-red-200/80">
                Reason: {removalReasonLabel(post.removal_reason)} · Only you can see this post now — it no longer appears in feeds, replies, or anywhere else on the site.
              </p>
            </div>
          )}
          {locked && post.member_lock && (
            <div className="mt-2 rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/5 px-3 py-3" data-testid="post-member-lock">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-[#e8c86a]">
                <Lock className="h-4 w-4 shrink-0" /> Members only
                {post.member_lock.required_tier && (
                  <span className="font-normal text-neutral-300">· {post.member_lock.required_tier.name} and up</span>
                )}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-neutral-300">{post.member_lock.message}</p>
              <Link
                href={post.member_lock.join_url}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black hover:bg-[#e8c86a]"
              >
                <Crown className="h-3.5 w-3.5" /> Join the fan club
              </Link>
            </div>
          )}
          {!locked && post.body && <RichText body={post.body} className="mt-1.5 text-[15px] leading-relaxed text-neutral-100" />}

          {!removed && !locked && (
            coveredNow && cover ? (
              /* The cover (Wave 4 #40): the media never arrived, so
                 there is nothing here to blur, fetch or autoplay —
                 a frosted panel names the warning and holds the one
                 door (this item's reveal, this session only). */
              <div className="relative mt-3 overflow-hidden rounded-xl border border-amber-400/40 px-3 py-3" data-testid="post-content-cover">
                <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_140%_at_20%_0%,rgba(217,164,65,0.28),rgba(20,16,8,0.92)_60%)] backdrop-blur-md" />
                <div className="relative">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> Content warning: {contentWarningNames(cover.labels)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-300">{cover.message}</p>
                  <p className="mt-1 text-[11px] text-neutral-400">
                    {cover.media_count} attachment{cover.media_count === 1 ? "" : "s"} covered
                  </p>
                  {cover.mode === "covered" ? (
                    <button
                      onClick={reveal}
                      disabled={revealing}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black hover:bg-[#e8c86a] disabled:opacity-50"
                    >
                      <Eye className="h-3.5 w-3.5" /> {revealing ? "Revealing…" : "Show media"}
                    </button>
                  ) : (
                    <Link
                      href="/settings"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 px-4 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-400/10"
                    >
                      Review my content warning settings
                    </Link>
                  )}
                  {revealError && <p className="mt-2 text-xs text-red-400">{revealError}</p>}
                </div>
              </div>
            ) : (
              <AttachmentView attachments={revealedMedia ?? post.media_urls ?? []} />
            )
          )}

          {/* poll */}
          {!removed && !locked && poll && (
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
                      mine ? `border-[#d4af37] ${isLight ? "text-[#7A5A12]" : "text-[#f5e08c]"}` : "border-[#2a2a2a] text-neutral-200"
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
          {!removed && !locked && post.quoted && (
            <div className="mt-3">
              <PostCard post={post.quoted} depth={depth + 1} />
            </div>
          )}

          {/* action row — a removed or locked post takes no engagement */}
          {!removed && !locked && (
          <div className="mt-3 flex items-center justify-between border-t border-[#1f1f1f] pt-2.5">
            <div className="flex items-center gap-1 sm:gap-2">
              {/* reactions — like stays the default, tap the count for the full set */}
              <div className="group relative">
                <button
                  onClick={() => react("like")}
                  aria-label="Like"
                  className="flex items-center gap-1 rounded-full px-2 py-1.5 text-sm text-neutral-400 transition hover:text-[#d4af37]"
                >
                  <ReactionSticker
                    reaction="like"
                    className={`h-6 w-6 object-contain transition ${emoji === "like" ? "" : "opacity-50 grayscale hover:opacity-80 hover:grayscale-0"}`}
                  />
                  {(counts["like"] ?? 0) > 0 && <span className="text-xs">{counts["like"]}</span>}
                </button>
                <div className="absolute bottom-full left-0 z-10 mb-1 hidden gap-1 rounded-full border border-[#2a2a2a] bg-[#1a1a1a] p-1.5 shadow-xl group-hover:flex">
                  {REACTION_KEYS.map((key) => (
                    <button
                      key={key}
                      onClick={() => react(key)}
                      title={REACTION_ART[key].label}
                      aria-label={REACTION_ART[key].label}
                      className={`rounded-full p-1 transition hover:scale-110 ${emoji === key ? "bg-[#d4af37]/20" : ""}`}
                    >
                      <ReactionSticker reaction={key} className="h-7 w-7 object-contain" />
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
              {user && (
                <ReportButton
                  targetType={post.kind === "thread_reply" ? "comment" : "post"}
                  targetId={post.id}
                />
              )}
              <button onClick={del} aria-label="Delete post" className="rounded-full p-2 text-neutral-500 hover:text-red-400">
                <Trash2 className="h-[16px] w-[16px]" />
              </button>
            </div>
          </div>
          )}
          {shareMsg && <p className="mt-1 break-all text-xs text-[#d4af37]">{shareMsg}</p>}

          {/* earning hint — guide them to the money */}
          {!removed && !locked && showAnalytics && earningHint && (
            <div className={`mt-2 rounded-xl border border-[#d4af37]/40 p-3 ${isLight ? "bg-gradient-to-r from-[#F4E7C3] to-[#FCF7EA]" : "bg-gradient-to-r from-[#1a1408] to-transparent"}`}>
              <p className={`text-xs leading-relaxed ${isLight ? "text-[#7A5A12]" : "text-[#f5e08c]"}`}>💰 {earningHint}</p>
            </div>
          )}

          {!removed && !locked && showReply && (
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
          {!removed && !locked && showQuote && (
            <div className="mt-2">
              <Composer
                quoteOf={{ id: post.id, body: post.body, authorName: post.author?.display_name ?? "Creator" }}
                placeholder="Add your take…"
                onPosted={() => setShowQuote(false)}
              />
            </div>
          )}

          {!removed && !locked && post.reply_count > 0 && depth === 0 && (
            <button onClick={loadReplies} className="mt-2 text-xs font-semibold text-[#d4af37] hover:underline">
              {showReplies ? "Hide replies" : `View ${post.reply_count} ${post.reply_count === 1 ? "reply" : "replies"}`}
            </button>
          )}
          {!removed && !locked && showReplies && (
            <div className="mt-2 space-y-2 border-l-2 border-[#d4af37]/30 pl-3">
              {replies.map((r) => (
                <PostCard key={r.id} post={r} depth={depth + 1} onDeleted={(id) => setReplies((x) => x.filter((p) => p.id !== id))} />
              ))}
            </div>
          )}

          {/* A removed post's only remaining action is the author's
              own delete — the moderation state itself is the admin's. */}
          {removed && (
            <div className="mt-3 flex justify-end border-t border-[#1f1f1f] pt-2.5">
              <button onClick={del} aria-label="Delete post" className="rounded-full p-2 text-neutral-500 hover:text-red-400">
                <Trash2 className="h-[16px] w-[16px]" />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
