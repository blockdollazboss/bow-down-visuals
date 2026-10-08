import { useEffect, useRef, useState } from "react";
import { Heart, Repeat2, Share2, Download, Check, X, Globe, ListPlus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AddToPlaylist } from "@/components/player/AddToPlaylist";
import {
  copyText, formatCount, getMyReferralCode, shareUrl,
  toggleLike, toggleRepost, downloadCheckoutPath,
  type MediaKind,
} from "@/lib/streaming";

/* ─── Like / Repost / Share / Download action bar (Worker 2) ───
   Shared by the track page and the video watch page. Neutral copy:
   songs, podcast episodes, DJ mixes, voiceovers — any creator upload. */

export function MediaActions({
  kind, id, title, sharePath, artistName,
  likeCount, repostCount, liked: initialLiked, reposted: initialReposted,
  showRepost = true,
  downloadPriceCents = null,
  size = "md",
}: {
  kind: MediaKind;
  id: string;
  title: string;
  sharePath: string;
  artistName?: string;
  likeCount: number;
  repostCount?: number;
  liked?: boolean;
  reposted?: boolean;
  showRepost?: boolean;
  downloadPriceCents?: number | null;
  size?: "md" | "lg";
}) {
  const { user, getAccessToken } = useAuth();
  const [liked, setLiked] = useState(!!initialLiked);
  const [reposted, setReposted] = useState(!!initialReposted);
  const [likes, setLikes] = useState(likeCount);
  const [reposts, setReposts] = useState(repostCount ?? 0);
  const [shareOpen, setShareOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setLikes(likeCount); }, [likeCount]);
  useEffect(() => { setReposts(repostCount ?? 0); }, [repostCount]);
  useEffect(() => { setLiked(!!initialLiked); setReposted(!!initialReposted); }, [initialLiked, initialReposted, id]);

  useEffect(() => {
    if (!shareOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [shareOpen]);

  async function authed() {
    if (!user) return null;
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : null;
  }

  async function handleLike() {
    const headers = await authed();
    if (!headers) return;
    const prev = liked;
    setLiked(!prev);
    setLikes((n) => n + (prev ? -1 : 1));
    try {
      const res = await toggleLike(kind, id, prev, headers);
      setLiked(res.liked);
      if (res.count != null) setLikes(res.count);
    } catch {
      setLiked(prev);
      setLikes((n) => n + (prev ? 1 : -1));
    }
  }

  async function handleRepost() {
    const headers = await authed();
    if (!headers) return;
    const prev = reposted;
    setReposted(!prev);
    setReposts((n) => n + (prev ? -1 : 1));
    try {
      const res = await toggleRepost(id, prev, headers);
      setReposted(res.reposted);
      if (res.count != null) setReposts(res.count);
    } catch {
      setReposted(prev);
      setReposts((n) => n + (prev ? 1 : -1));
    }
  }

  const btn = size === "lg" ? "px-5 py-3 text-sm" : "px-4 py-2 text-sm";
  const icon = size === "lg" ? "h-5 w-5" : "h-4 w-4";

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        onClick={handleLike}
        title={user ? (liked ? "Unlike" : "Like") : "Sign in to like"}
        className={`${btn} rounded-full border font-semibold flex items-center gap-2 transition-colors ${
          liked
            ? "border-[#e8c86a] bg-[#e8c86a]/15 text-[#e8c86a]"
            : "border-white/15 text-white/70 hover:border-[#e8c86a]/60 hover:text-[#e8c86a]"
        }`}
      >
        <Heart className={`${icon} ${liked ? "fill-[#e8c86a]" : ""}`} />
        {formatCount(likes)}
      </button>

      {showRepost && (
        <button
          onClick={handleRepost}
          title={user ? (reposted ? "Undo repost" : "Repost to your profile") : "Sign in to repost"}
          className={`${btn} rounded-full border font-semibold flex items-center gap-2 transition-colors ${
            reposted
              ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
              : "border-white/15 text-white/70 hover:border-emerald-400/60 hover:text-emerald-300"
          }`}
        >
          <Repeat2 className={icon} />
          {formatCount(reposts)}
        </button>
      )}

      <div className="relative" ref={shareRef}>
        <button
          onClick={() => setShareOpen((v) => !v)}
          className={`${btn} rounded-full border border-white/15 text-white/70 hover:border-[#e8c86a]/60 hover:text-[#e8c86a] font-semibold flex items-center gap-2 transition-colors`}
        >
          <Share2 className={icon} /> Share
        </button>
        {shareOpen && (
          <ShareMenu
            title={title} artistName={artistName} sharePath={sharePath}
            onClose={() => setShareOpen(false)}
          />
        )}
      </div>

      <button
        data-min-stars="2"
        onClick={() => setAddOpen(true)}
        title={user ? "Save to a playlist" : "Sign in to save to playlists"}
        className={`${btn} rounded-full border border-white/15 text-white/70 hover:border-[#e8c86a]/60 hover:text-[#e8c86a] font-semibold flex items-center gap-2 transition-colors`}
      >
        <ListPlus className={icon} /> Save
      </button>
      <AddToPlaylist kind={kind} id={id} title={title} open={addOpen} onClose={() => setAddOpen(false)} />

      {downloadPriceCents != null && downloadPriceCents > 0 && (
        <a
          href={downloadCheckoutPath(kind, id)}
          className={`${btn} rounded-full bg-[#e8c86a] text-black font-bold flex items-center gap-2 hover:bg-[#f5d67e] transition-colors`}
        >
          <Download className={icon} />
          Own it — ${(downloadPriceCents / 100).toFixed(2)}
        </a>
      )}
    </div>
  );
}

/* ─── Share menu: referral link + social intents, cheat-code attribution ─── */
export function ShareMenu({
  title, artistName, sharePath, onClose,
}: {
  title: string;
  artistName?: string;
  sharePath: string;
  onClose: () => void;
}) {
  const { getAccessToken } = useAuth();
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyReferralCode(getAccessToken).then((code) => {
      if (alive) setUrl(shareUrl(sharePath, code));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharePath]);

  const text = `🔥 ${title}${artistName ? ` — ${artistName}` : ""} | Made with Bow Down Visuals`;

  async function handleCopy() {
    const ok = await copyText(`${text}\n${url}`);
    if (ok) {
      setCopied(true);
      setTimeout(() => { setCopied(false); onClose(); }, 1200);
    }
  }

  const intents = [
    { label: "X", href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    { label: "Threads", href: `https://www.threads.net/intent/post?text=${encodeURIComponent(text + " " + url)}` },
  ];

  return (
    <div className="absolute z-50 mt-2 w-72 rounded-2xl bg-[#14110b] border border-[#e8c86a]/30 shadow-[0_16px_50px_rgba(0,0,0,.7)] p-4 left-0">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-[#e8c86a]">Spread the cheat code</p>
        <button onClick={onClose} className="text-white/40 hover:text-white" aria-label="Close share">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-white/45 mb-3">
        Your referral link rides along — new creators who join through it earn you credits.
      </p>
      <button
        onClick={handleCopy}
        className="w-full rounded-xl bg-[#e8c86a] text-black text-sm font-bold px-3 py-2.5 hover:bg-[#f5d67e] transition-colors flex items-center justify-center gap-2"
      >
        {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
        {copied ? "Copied!" : "Copy link"}
      </button>
      <div className="grid grid-cols-3 gap-2 mt-2">
        {intents.map((s) => (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-white/10 text-white/70 hover:text-[#e8c86a] hover:border-[#e8c86a]/50 text-xs font-semibold py-2 text-center transition-colors flex items-center justify-center gap-1"
          >
            {s.label === "Facebook" && <Globe className="h-3.5 w-3.5" />}
            {s.label}
          </a>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-white/30 text-center">
        Shared cards carry "Made with Bow Down Visuals" attribution.
      </p>
    </div>
  );
}
