import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Send, BadgeCheck } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { apiJson, markStorySeen, profileHref, type Story } from "@/lib/social-api";
import { Avatar } from "./Avatar";

const STORY_MS = 5000;

/* Full-screen story viewer: progress bars, tap zones (prev/next), 24h
   countdown, reply → DM. Header links to the creator's profile. */
export function StoryViewer({
  stories,
  startIndex,
  onClose,
}: {
  stories: Story[];
  startIndex: number;
  onClose: () => void;
}) {
  const { getAccessToken } = useAuth();
  const [idx, setIdx] = useState(startIndex);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const timer = useRef<number | null>(null);
  const story = stories[idx];

  const markViewed = useCallback(
    async (s: Story) => {
      markStorySeen(s.id);
      try {
        const token = await getAccessToken();
        fetch(`/api/stories/${s.id}/view`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).catch(() => {});
      } catch { /* ignore */ }
    },
    [getAccessToken],
  );

  useEffect(() => {
    if (story) markViewed(story);
  }, [idx, story, markViewed]);

  useEffect(() => {
    setProgress(0);
    setSent(false);
    setReply("");
    if (timer.current) window.clearInterval(timer.current);
    const step = 50;
    timer.current = window.setInterval(() => {
      if (paused) return;
      setProgress((p) => {
        const next = p + step / STORY_MS;
        if (next >= 1) {
          if (idx < stories.length - 1) setIdx(idx + 1);
          else onClose();
          return 0;
        }
        return next;
      });
    }, step);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && idx < stories.length - 1) setIdx(idx + 1);
      if (e.key === "ArrowLeft" && idx > 0) setIdx(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, stories.length, onClose]);

  if (!story) return null;
  const author = story.author;
  const msLeft = Math.max(0, new Date(story.expires_at).getTime() - Date.now());
  const hrsLeft = Math.floor(msLeft / 3600_000);
  const minsLeft = Math.floor((msLeft % 3600_000) / 60_000);

  async function sendReply() {
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      await apiJson(getAccessToken, `/api/stories/${story.id}/reply`, {
        method: "POST",
        body: JSON.stringify({ body: reply.trim() }),
      });
      setSent(true);
      setReply("");
    } catch {
      /* keep the reply text so they can retry */
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95" role="dialog" aria-label="Story viewer">
      <div className="relative h-full w-full max-w-[480px] overflow-hidden bg-black sm:h-[92vh] sm:rounded-2xl">
        {/* media */}
        {story.media_kind === "video" ? (
          <video src={story.media_url} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <img src={story.media_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/80" />

        {/* progress bars */}
        <div className="absolute left-0 right-0 top-0 flex gap-1 p-3">
          {stories.map((s, i) => (
            <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full rounded-full bg-[#d4af37]"
                style={{ width: i < idx ? "100%" : i === idx ? `${Math.min(100, progress * 100)}%` : "0%" }}
              />
            </div>
          ))}
        </div>

        {/* header → creator profile */}
        <div className="absolute left-0 right-0 top-5 flex items-center gap-3 px-4">
          <Link href={profileHref(author)} className="flex min-w-0 flex-1 items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
            <Avatar author={author} size={40} showBadge={false} />
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-sm font-semibold text-white">
                <span className="truncate">{author?.display_name ?? "Creator"}</span>
                {author?.is_verified && <BadgeCheck className="h-4 w-4 shrink-0 text-[#d4af37]" />}
              </span>
              <span className="block text-[11px] text-neutral-300">
                {hrsLeft > 0 ? `${hrsLeft}h ${minsLeft}m left` : `${minsLeft}m left`} · tap to visit profile
              </span>
            </span>
          </Link>
          <button onClick={onClose} aria-label="Close stories" className="rounded-full bg-black/50 p-2 text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* tap zones */}
        <button aria-label="Previous story" className="absolute inset-y-0 left-0 w-1/3" onClick={() => idx > 0 && setIdx(idx - 1)} />
        <button
          aria-label="Next story"
          className="absolute inset-y-0 right-0 w-1/3"
          onClick={() => (idx < stories.length - 1 ? setIdx(idx + 1) : onClose())}
        />
        <div className="absolute inset-y-0 left-1/3 right-1/3" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)} />

        {/* caption */}
        {story.caption && (
          <p className="absolute bottom-24 left-0 right-0 px-5 text-center text-sm text-white" style={{ textShadow: "0 1px 8px black" }}>
            {story.caption}
          </p>
        )}

        {/* reply → DM */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 p-4">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendReply()}
            placeholder={sent ? "Sent! 🦈" : `Reply to ${author?.display_name ?? "creator"}…`}
            maxLength={500}
            className="flex-1 rounded-full border border-white/30 bg-black/50 px-4 py-2.5 text-sm text-white placeholder:text-neutral-400 focus:border-[#d4af37] focus:outline-none"
          />
          <button
            onClick={sendReply}
            disabled={!reply.trim() || sending}
            aria-label="Send reply"
            className="rounded-full bg-[#d4af37] p-2.5 text-black disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        {/* desktop arrows */}
        <button aria-label="Previous" onClick={() => idx > 0 && setIdx(idx - 1)} className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 p-2 text-white sm:block">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button aria-label="Next" onClick={() => (idx < stories.length - 1 ? setIdx(idx + 1) : onClose())} className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 p-2 text-white sm:block">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
