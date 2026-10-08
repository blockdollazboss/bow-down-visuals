import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Link } from "wouter";
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, ListMusic,
  Heart, Share2, X, Trash2, Music2, ChevronUp,
} from "lucide-react";
import { useStreamingPlayer, type QueueItem } from "@/contexts/StreamingPlayerContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  copyText, formatCount, formatDuration, getMyReferralCode, shareUrl,
  toggleLike, type MediaKind,
} from "@/lib/streaming";

/* ─── Site-wide streaming player bar (Worker 2) ───
   Mounted above the router in AppShell so audio survives page navigation.
   Desktop: full control bar. Mobile: mini player that expands on tap.
   Media-neutral: songs, podcast episodes, DJ mixes, voiceovers — any audio. */

const GOLD = "#e8c86a";

function SeekBar({ value, max, onSeek }: { value: number; max: number; onSeek: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const toValue = (clientX: number) => {
    const el = ref.current;
    if (!el || !max) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * max;
  };

  const onDown = (e: RPointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    onSeek(toValue(e.clientX));
  };
  const onMove = (e: RPointerEvent) => {
    if (dragging) onSeek(toValue(e.clientX));
  };
  const onUp = () => setDragging(false);

  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      ref={ref}
      className="group relative h-4 flex items-center cursor-pointer touch-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      role="slider"
      aria-valuenow={Math.round(value)}
      aria-valuemax={Math.round(max)}
      aria-label="Seek"
    >
      <div className="relative h-1 w-full rounded-full bg-white/15 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, #8a6a1f, ${GOLD})` }}
        />
      </div>
      <div
        className="absolute h-3 w-3 rounded-full bg-[#e8c86a] shadow-[0_0_8px_rgba(232,200,106,.7)] opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ left: `calc(${pct}% - 6px)` }}
      />
    </div>
  );
}

function VolumeControl({ volume, muted, setVolume, toggleMute }: {
  volume: number; muted: boolean; setVolume: (v: number) => void; toggleMute: () => void;
}) {
  return (
    <div className="hidden md:flex items-center gap-2">
      <button onClick={toggleMute} className="text-white/60 hover:text-[#e8c86a] transition-colors" aria-label={muted ? "Unmute" : "Mute"}>
        {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <input
        type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="w-20 accent-[#e8c86a] cursor-pointer"
        aria-label="Volume"
      />
    </div>
  );
}

function QueueDrawer() {
  const p = useStreamingPlayer();
  if (!p.queueOpen) return null;
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-label="Queue">
      <div className="absolute inset-0 bg-black/60" onClick={() => p.setQueueOpen(false)} />
      <aside className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-[#0d0b08] border-l border-[#e8c86a]/25 flex flex-col shadow-[0_0_60px_rgba(0,0,0,.8)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h2 className="text-sm font-bold text-[#e8c86a] tracking-wide uppercase">Up next</h2>
            <p className="text-xs text-white/40">Your cheat-code queue — it rides with you</p>
          </div>
          <div className="flex items-center gap-2">
            {p.queue.length > 0 && (
              <button
                onClick={p.clearQueue}
                className="flex items-center gap-1 text-xs text-white/50 hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            )}
            <button onClick={() => p.setQueueOpen(false)} className="text-white/60 hover:text-white" aria-label="Close queue">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {p.queue.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-8 gap-3">
              <ListMusic className="h-10 w-10 text-[#e8c86a]/40" />
              <p className="text-white/70 font-semibold">The queue is empty. Suspiciously quiet.</p>
              <p className="text-sm text-white/40">
                Hit play on any audio or video upload and it lands here —
                the cheat code keeps the vibe rolling while you browse.
              </p>
            </div>
          ) : (
            <ul>
              {p.queue.map((q, i) => (
                <QueueRow key={`${q.kind}:${q.id}:${i}`} item={q} active={i === p.index} position={i} />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function QueueRow({ item, active, position }: { item: QueueItem; active: boolean; position: number }) {
  const p = useStreamingPlayer();
  return (
    <li
      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer border-l-2 transition-colors hover:bg-white/5 ${
        active ? "border-[#e8c86a] bg-[#e8c86a]/10" : "border-transparent"
      }`}
      onClick={() => {
        p.playItems(p.queue, position);
      }}
    >
      {item.artwork ? (
        <img src={item.artwork} alt="" className="h-10 w-10 rounded object-cover shrink-0" />
      ) : (
        <div className="h-10 w-10 rounded bg-[#e8c86a]/10 flex items-center justify-center shrink-0">
          <Music2 className="h-5 w-5 text-[#e8c86a]/50" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-sm truncate ${active ? "text-[#e8c86a] font-semibold" : "text-white/85"}`}>{item.title}</p>
        <p className="text-xs text-white/40 truncate">{item.artistName}</p>
      </div>
      {active && p.playing && (
        <span className="flex items-end gap-0.5 h-4" aria-hidden>
          {[0, 1, 2].map((b) => (
            <span key={b} className="w-1 rounded-full bg-[#e8c86a] animate-pulse" style={{ height: `${8 + b * 4}px`, animationDelay: `${b * 150}ms` }} />
          ))}
        </span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); p.removeFromQueue(position); }}
        className="text-white/30 hover:text-red-400 transition-colors p-1"
        aria-label="Remove from queue"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

export function StreamingPlayerBar() {
  const p = useStreamingPlayer();
  const { user, getAccessToken } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [liked, setLiked] = useState(false);
  const [copied, setCopied] = useState(false);
  const current = p.current;

  /* Keep page content clear of the bar while it is visible. */
  useEffect(() => {
    if (!current) {
      document.body.style.paddingBottom = "";
      return;
    }
    const apply = () => {
      const mobile = window.innerWidth < 768;
      document.body.style.paddingBottom = mobile ? (expanded ? "172px" : "60px") : "84px";
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      document.body.style.paddingBottom = "";
    };
  }, [current, expanded]);

  useEffect(() => { setLiked(false); }, [current?.id, current?.kind]);

  if (!current) return null;

  const trackPath = `/track/${current.id}`;
  const sharePath = current.kind === "track" ? trackPath : `/watch/${current.id}`;

  async function handleLike() {
    if (!user || !current) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };
      const res = await toggleLike(current.kind as MediaKind, current.id, liked, headers);
      setLiked(res.liked);
    } catch { /* bar must never crash */ }
  }

  async function handleShare() {
    const code = await getMyReferralCode(getAccessToken);
    const ok = await copyText(shareUrl(sharePath, code));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const Icon = p.playing ? Pause : Play;
  const progress = p.duration > 0 ? (p.currentTime / p.duration) * 100 : 0;

  return (
    <>
      <QueueDrawer />
      {/* Mobile mini player */}
      <div className="fixed bottom-0 inset-x-0 z-[60] md:hidden">
        {!expanded && (
          <div className="bg-[#0d0b08]/95 backdrop-blur border-t border-[#e8c86a]/25">
            <div className="h-0.5 bg-white/10">
              <div className="h-full" style={{ width: `${progress}%`, background: GOLD }} />
            </div>
            <div className="flex items-center gap-3 px-3 py-2">
              <button onClick={() => setExpanded(true)} className="flex items-center gap-3 flex-1 min-w-0 text-left" aria-label="Expand player">
                {current.artwork ? (
                  <img src={current.artwork} alt="" className="h-10 w-10 rounded object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded bg-[#e8c86a]/10 flex items-center justify-center">
                    <Music2 className="h-5 w-5 text-[#e8c86a]/60" />
                  </div>
                )}
                <span className="min-w-0">
                  <span className="block text-sm text-white/90 truncate">{current.title}</span>
                  <span className="block text-xs text-white/45 truncate">{current.artistName}</span>
                </span>
              </button>
              <button onClick={handleLike} className={`${liked ? "text-[#e8c86a]" : "text-white/50"} p-1`} aria-label="Like">
                <Heart className={`h-5 w-5 ${liked ? "fill-[#e8c86a]" : ""}`} />
              </button>
              <button onClick={p.toggle} className="h-10 w-10 rounded-full bg-[#e8c86a] text-black flex items-center justify-center" aria-label={p.playing ? "Pause" : "Play"}>
                <Icon className="h-5 w-5 fill-black" />
              </button>
              <button onClick={p.next} className="text-white/60 p-1" aria-label="Next">
                <SkipForward className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
        {expanded && (
          <div className="bg-[#0d0b08] border-t border-[#e8c86a]/25 px-5 pt-2 pb-4">
            <button onClick={() => setExpanded(false)} className="mx-auto flex text-white/40" aria-label="Collapse player">
              <ChevronUp className="h-5 w-5 rotate-180" />
            </button>
            <div className="flex items-center gap-3 mt-1">
              {current.artwork ? (
                <img src={current.artwork} alt="" className="h-14 w-14 rounded-lg object-cover" />
              ) : (
                <div className="h-14 w-14 rounded-lg bg-[#e8c86a]/10 flex items-center justify-center">
                  <Music2 className="h-7 w-7 text-[#e8c86a]/60" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-white font-semibold truncate">{current.title}</p>
                <p className="text-sm text-white/50 truncate">{current.artistName}</p>
              </div>
              <button onClick={handleShare} className="text-white/50 hover:text-[#e8c86a] p-2" aria-label="Share">
                <Share2 className="h-5 w-5" />
              </button>
              <button onClick={() => p.setQueueOpen(true)} className="text-white/50 hover:text-[#e8c86a] p-2" aria-label="Queue">
                <ListMusic className="h-5 w-5" />
              </button>
            </div>
            <SeekBar value={p.currentTime} max={p.duration} onSeek={p.seek} />
            <div className="flex justify-between text-[11px] text-white/40 -mt-1 mb-2">
              <span>{formatDuration(p.currentTime)}</span>
              <span>{formatDuration(p.duration)}</span>
            </div>
            <div className="flex items-center justify-center gap-6">
              <button onClick={p.prev} className="text-white/70" aria-label="Previous"><SkipBack className="h-7 w-7" /></button>
              <button onClick={p.toggle} className="h-14 w-14 rounded-full bg-[#e8c86a] text-black flex items-center justify-center shadow-[0_0_24px_rgba(232,200,106,.4)]" aria-label={p.playing ? "Pause" : "Play"}>
                <Icon className="h-7 w-7 fill-black" />
              </button>
              <button onClick={p.next} className="text-white/70" aria-label="Next"><SkipForward className="h-7 w-7" /></button>
            </div>
            {copied && <p className="text-center text-xs text-[#e8c86a] mt-2">Link copied — spread the cheat code 🔗</p>}
          </div>
        )}
      </div>

      {/* Desktop full bar */}
      <div className="hidden md:block fixed bottom-0 inset-x-0 z-[60] bg-[#0d0b08]/95 backdrop-blur border-t border-[#e8c86a]/25">
        <SeekBar value={p.currentTime} max={p.duration} onSeek={p.seek} />
        <div className="flex items-center gap-4 px-5 py-2.5">
          <Link href={trackPath} className="flex items-center gap-3 min-w-0 w-64 group">
            {current.artwork ? (
              <img src={current.artwork} alt="" className="h-12 w-12 rounded-md object-cover" />
            ) : (
              <div className="h-12 w-12 rounded-md bg-[#e8c86a]/10 flex items-center justify-center">
                <Music2 className="h-6 w-6 text-[#e8c86a]/60" />
              </div>
            )}
            <span className="min-w-0">
              <span className="block text-sm text-white/90 truncate group-hover:text-[#e8c86a]">{current.title}</span>
              <span className="block text-xs text-white/45 truncate">{current.artistName}</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <button onClick={p.prev} className="text-white/60 hover:text-[#e8c86a] p-1.5 transition-colors" aria-label="Previous">
              <SkipBack className="h-5 w-5 fill-current" />
            </button>
            <button onClick={p.toggle} className="h-10 w-10 rounded-full bg-[#e8c86a] text-black flex items-center justify-center hover:bg-[#f5d67e] transition-colors shadow-[0_0_20px_rgba(232,200,106,.35)]" aria-label={p.playing ? "Pause" : "Play"}>
              <Icon className="h-5 w-5 fill-black" />
            </button>
            <button onClick={p.next} className="text-white/60 hover:text-[#e8c86a] p-1.5 transition-colors" aria-label="Next">
              <SkipForward className="h-5 w-5 fill-current" />
            </button>
          </div>
          <div className="hidden lg:flex items-center gap-2 text-xs text-white/40 tabular-nums">
            <span>{formatDuration(p.currentTime)}</span>
            <span className="text-white/20">/</span>
            <span>{formatDuration(p.duration)}</span>
          </div>
          <div className="flex-1" />
          <button onClick={handleLike} className={`${liked ? "text-[#e8c86a]" : "text-white/45 hover:text-[#e8c86a]"} p-2 transition-colors`} aria-label="Like" title={user ? "Like" : "Sign in to like"}>
            <Heart className={`h-4 w-4 ${liked ? "fill-[#e8c86a]" : ""}`} />
          </button>
          <button onClick={handleShare} className="text-white/45 hover:text-[#e8c86a] p-2 transition-colors" aria-label="Share with referral link" title="Share">
            <Share2 className={`h-4 w-4 ${copied ? "text-emerald-400" : ""}`} />
          </button>
          <button
            onClick={() => p.setQueueOpen(true)}
            className={`p-2 transition-colors ${p.queueOpen ? "text-[#e8c86a]" : "text-white/45 hover:text-[#e8c86a]"}`}
            aria-label="Toggle queue"
            title={`Queue (${p.queue.length})`}
          >
            <ListMusic className="h-4 w-4" />
          </button>
          <VolumeControl volume={p.volume} muted={p.muted} setVolume={p.setVolume} toggleMute={p.toggleMute} />
          <span className="hidden xl:block text-[11px] text-white/30 border border-white/10 rounded px-1.5 py-0.5">
            {formatCount(p.queue.length)} in queue
          </span>
        </div>
      </div>
    </>
  );
}
