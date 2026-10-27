import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  Heart, MessageCircle, Share2, Plus, Check, Music2, Volume2, VolumeX,
  Play, Scissors, Columns2, BarChart3, Trophy, HandCoins,
  ShoppingBag, X, Loader2, Send, ChevronDown, Sparkles, AlertTriangle, RotateCcw, Crown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatBucs } from "@/lib/visual-bucs";
import { jarPath } from "@/lib/one-tip-jar";
import { normalizeShortsFeed, normalizeShortItem } from "@/lib/shorts-data";
import {
  postShortPublishHref,
  duetEditorHref,
  stitchEditorHref,
  shortSoundEditorHref,
} from "@/lib/short-publish";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Shorts — the For You feed, but you own it ─────────────────────────────
   /shorts — vertical full-screen snap feed. Every element is tappable to
   somewhere real: creator profile, sound page, challenge page, duet/stitch
   parents AND children, comments, share with ?ref=CODE, tip jar, buy page.
   Money flows everywhere: tip + buy in the action rail, "this sound is
   earning" when a priced product rides the sound, challenge chips carry the
   prize angle.
   Creator Level ladder (data-min-stars — never gates watching or posting):
   1 star: pure feed + big record button. 2 stars: duet/stitch controls.
   3 stars: sound tools (use-this-sound, trending sounds). 4 stars: analytics.
*/

interface CreatorRef { id: string; slug: string; display_name: string; avatar_url: string | null; is_official?: boolean }
interface SoundRef { id: string; title: string | null; url: string | null; use_count: number }
interface ChallengeChip { slug: string; title: string; hashtag: string }

export interface ShortItem {
  id: string; profile_id: string; title: string; video_url: string;
  thumbnail_url: string | null; thumbnail_alt_text?: string | null; description: string; tags: string[];
  duration_sec: number; view_count: number; like_count: number;
  repost_count: number; comment_count: number; download_price_cents: number;
  duet_with: string | null; stitch_with: string | null; sound: SoundRef | null;
  /* Duet Rails (#173): the creator's per-video duet switch (false =
     no duet door is offered; the API refuses at POST too) and the
     King's featured-pick stamp (N3 — a house pick, labeled as such). */
  duets_enabled: boolean; king_featured_at: string | null;
  score: number; creator: CreatorRef;
  duet_parent: { id: string; title: string | null; creator_slug: string | null } | null;
  stitch_parent: { id: string; title: string | null; creator_slug: string | null } | null;
  duet_count: number; stitch_count: number; challenges: ChallengeChip[];
  viewer_liked: boolean; viewer_following: boolean; created_at: string;
}

interface FeedResponse { items: ShortItem[]; next_cursor: string | null }

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Render #hashtags as links into the hashtag hub. */
function CaptionText({ text }: { text: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_]+)/gu);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("#") && p.length > 1 ? (
          <Link key={i} href={`/hashtag/${encodeURIComponent(p.slice(1))}`}
            className="text-primary font-semibold hover:underline">#{p.slice(1)}</Link>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

async function apiGet(path: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

export default function ShortsFeed() {
  usePageTitle("Shorts", "Watch creator shorts on Bow Down Visuals.");
  const search = useSearch();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<ShortItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The toast on failure was a half-fix: items stayed empty, so the
  // genuine "No shorts yet" state still rendered once loading ended.
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [refCode, setRefCode] = useState<string>("");
  /* #173: my own profile id — the duet switch renders on MY shorts
     (the switch is held by the original creator, per video). */
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const seenViews = useRef<Set<string>>(new Set());

  const startId = new URLSearchParams(search).get("start");

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  useEffect(() => {
    if (!user) { setMyProfileId(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch("/api/creator-profiles/me", { headers: { Authorization: `Bearer ${token}` } });
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data?.id) setMyProfileId(String(data.id));
        }
      } catch { /* owner controls simply stay hidden */ }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken]);

  /* referral code for share links (?ref=CODE) */
  useEffect(() => {
    (async () => {
      if (!user) return;
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/referrals/me", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (res.ok) {
          const data = await res.json();
          if (data?.code) setRefCode(String(data.code));
        }
      } catch { /* share works without ref */ }
    })();
  }, [user, getAccessToken]);

  const loadFeed = useCallback(async (cursorIn: string | null, seedStartId?: string | null): Promise<FeedResponse> => {
    const url = cursorIn ? `/api/shorts/feed?cursor=${encodeURIComponent(cursorIn)}` : "/api/shorts/feed";
    const data = normalizeShortsFeed(await apiGet(url));
    let next = data.items;
    if (seedStartId && !cursorIn) {
      try {
        const s = (await apiGet(`/api/shorts/${encodeURIComponent(seedStartId)}`)) as { short?: unknown };
        const seedItem = normalizeShortItem(s?.short);
        if (seedItem && !next.some((i) => i.id === seedItem.id)) next = [seedItem, ...next];
      } catch { /* start id may be gone — feed stands on its own */ }
    }
    return { items: next, next_cursor: data.next_cursor };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    (async () => {
      try {
        const first = await loadFeed(null, startId);
        if (cancelled) return;
        setItems(first.items);
        setCursor(first.next_cursor);
        setHasMore(!!first.next_cursor);
      } catch {
        if (!cancelled) {
          setLoadError(true);
          toast({ title: "The feed glitched", description: "Pull to try again, chief." });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryNonce]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(cursor ? `/api/shorts/feed?cursor=${encodeURIComponent(cursor)}` : "/api/shorts/feed");
      const data = normalizeShortsFeed(await res.json());
      setItems((prev) => {
        const ids = new Set(prev.map((i) => i.id));
        return [...prev, ...data.items.filter((i) => !ids.has(i.id))];
      });
      setCursor(data.next_cursor);
      setHasMore(!!data.next_cursor && data.items.length > 0);
    } catch { /* keep scrolling what we have */ }
    finally { setLoadingMore(false); }
  }, [cursor, loadingMore, hasMore]);

  /* viewport tracking: play the visible short, count the view */
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const idx = Number((e.target as HTMLElement).dataset.idx ?? 0);
        setActive(idx);
        const v = videoRefs.current[idx];
        if (v) { v.muted = muted; v.play().catch(() => {}); }
        videoRefs.current.forEach((ov, i) => { if (i !== idx && ov) ov.pause(); });
        const item = itemRefs.current[idx] && items[idx];
        if (item && !seenViews.current.has(item.id)) {
          seenViews.current.add(item.id);
          fetch(`/api/media/video/${item.id}/play`, { method: "POST" }).catch(() => {});
          setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, view_count: p.view_count + 1 } : p)));
        }
        if (idx >= items.length - 3) loadMore();
      }
    }, { root: containerRef.current, threshold: 0.6 });
    itemRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [items, loadMore, muted]);

  /* in-feed navigation: ?start=<id> links (parents/children) land without remount */
  useEffect(() => {
    const sid = new URLSearchParams(search).get("start");
    if (!sid || loading) return;
    (async () => {
      const exists = items.some((i) => i.id === sid);
      if (!exists) {
        try {
          const s = (await apiGet(`/api/shorts/${encodeURIComponent(sid)}`)) as { short?: unknown };
          const seedItem = normalizeShortItem(s?.short);
          if (seedItem) {
            setItems((prev) => [seedItem, ...prev.filter((p) => p.id !== seedItem.id)]);
          }
        } catch { /* ignore */ }
      }
      requestAnimationFrame(() => {
        const idx = items.findIndex((i) => i.id === sid);
        const el = itemRefs.current[idx >= 0 ? idx : 0];
        el?.scrollIntoView({ behavior: "smooth" });
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (loading) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError && !items.length) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] flex-col items-center justify-center gap-5 bg-black px-6 text-center">
        <AlertTriangle className="h-12 w-12 text-primary" />
        <h1 className="text-2xl font-bold text-white">Couldn't load the shorts feed.</h1>
        <p className="max-w-md text-white/60">
          Something went wrong on our end — that's a failed load, not an empty stage.
        </p>
        <button type="button" onClick={() => setRetryNonce((n) => n + 1)}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3 font-bold text-black hover:brightness-110">
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] flex-col items-center justify-center gap-5 bg-black px-6 text-center">
        <Sparkles className="h-12 w-12 text-primary" />
        <h1 className="text-2xl font-bold text-white">No shorts yet — the stage is yours.</h1>
        <p className="max-w-md text-white/60">
          Post your first short and here's how shorts earn: fans tip you straight from the rail,
          priced downloads sell while you sleep, your sound pays you every time someone uses it,
          and challenges put your name on the leaderboard.
        </p>
        <Link href={postShortPublishHref()}
          className="rounded-full bg-primary px-8 py-3 font-bold text-black hover:brightness-110">
          Post your first short
        </Link>
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100dvh-4rem)] bg-black">
      {/* header */}
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-4 pb-8 pt-3">
        <div>
          <h1 className="text-xl font-black tracking-tight text-white">⚡ Shorts</h1>
          <p className="text-xs text-white/50">your For You page, but you own it</p>
        </div>
        <div className="flex items-center gap-2">
          <KingDuetPanel />
          <ShortsMenu />
        </div>
      </div>

      {/* feed */}
      <div ref={containerRef} className="h-full snap-y snap-mandatory overflow-y-scroll">
        {items.map((item, i) => (
          <ShortCard
            key={item.id}
            idx={i}
            item={item}
            muted={muted}
            setMuted={setMuted}
            refCb={(el) => { itemRefs.current[i] = el; }}
            videoRefCb={(el) => { videoRefs.current[i] = el; }}
            onUpdate={(patch) => setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, ...patch } : p)))}
            authHeaders={authHeaders}
            isAuthed={!!user}
            isOwn={!!myProfileId && item.profile_id === myProfileId}
            refCode={refCode}
          />
        ))}
        {loadingMore && (
          <div className="flex h-24 snap-start items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
      </div>

      {/* big record button — 1 star: pure feed + post. Never gated. */}
      <Link href={postShortPublishHref()} title="Post a short"
        className="absolute bottom-6 left-1/2 z-20 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-3xl font-black text-black shadow-[0_0_30px_rgba(212,175,55,0.5)] transition hover:scale-105">
        +
      </Link>
    </div>
  );
}

/* ─── ShortCard — one full-screen short, fully linked ─────────────────────── */

function ShortCard({
  idx, item, muted, setMuted, refCb, videoRefCb, onUpdate, authHeaders, isAuthed, isOwn, refCode,
}: {
  idx: number;
  item: ShortItem;
  muted: boolean;
  setMuted: (m: boolean) => void;
  refCb: (el: HTMLDivElement | null) => void;
  videoRefCb: (el: HTMLVideoElement | null) => void;
  onUpdate: (patch: Partial<ShortItem>) => void;
  authHeaders: () => Promise<Record<string, string>>;
  isAuthed: boolean;
  isOwn: boolean;
  refCode: string;
}) {
  const { toast } = useToast();
  const [playing, setPlaying] = useState(true);
  const [liked, setLiked] = useState(item.viewer_liked);
  const [likeCount, setLikeCount] = useState(item.like_count);
  const [following, setFollowing] = useState(item.viewer_following);
  const [burst, setBurst] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [linkageOpen, setLinkageOpen] = useState<null | "duet" | "stitch">(null);
  const [tipHandle, setTipHandle] = useState<string | null>(null);
  const lastTap = useRef(0);
  const videoEl = useRef<HTMLVideoElement | null>(null);

  useEffect(() => { setLiked(item.viewer_liked); setFollowing(item.viewer_following); setLikeCount(item.like_count); }, [item.id]);

  /* tip jar: only show the tip button when the creator actually has one —
     no dead links on this feed. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tips/page/${encodeURIComponent(item.creator.slug)}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data?.page?.handle) setTipHandle(String(data.page.handle));
        }
      } catch { /* no tip jar — button stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, [item.creator.slug, item.id]);

  async function authedFetch(path: string, method: string, body?: unknown) {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return res;
  }

  function doLike() {
    if (!isAuthed) { toast({ title: "Sign in to like", description: "The love's free — the account is too." }); return; }
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    onUpdate({ viewer_liked: next, like_count: likeCount + (next ? 1 : -1) });
    authedFetch(`/api/media/video/${item.id}/${next ? "like" : "unlike"}`, next ? "POST" : "DELETE")
      .catch(() => { setLiked(!next); });
  }

  function handleTap() {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (!liked) { doLike(); setBurst((b) => b + 1); }
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    setTimeout(() => {
      if (lastTap.current !== 0) {
        lastTap.current = 0;
        const v = videoEl.current;
        if (v) { if (v.paused) { v.play().catch(() => {}); setPlaying(true); } else { v.pause(); setPlaying(false); } }
      }
    }, 320);
  }

  async function toggleFollow() {
    if (!isAuthed) { toast({ title: "Sign in to follow", description: "Your feed gets sharper when it knows your people." }); return; }
    const next = !following;
    setFollowing(next);
    onUpdate({ viewer_following: next });
    const res = await authedFetch(
      `/api/creator-profiles/${item.creator.id}/${next ? "follow" : "unfollow"}`,
      next ? "POST" : "DELETE",
    ).catch(() => null);
    if (!res || !res.ok) setFollowing(!next);
  }

  async function share() {
    const url = `${window.location.origin}/shorts?start=${item.id}${refCode ? `&ref=${refCode}` : ""}`;
    const text = `⚡ ${item.title} by ${item.creator.display_name}\nMade with Bow Down Visuals 🦈`;
    if (navigator.share) {
      try { await navigator.share({ title: item.title, text, url }); return; } catch { /* dismissed */ }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast({ title: "Link copied", description: "Made with Bow Down Visuals 🦈 — your ref rides along." });
    } catch {
      toast({ title: "Copy this", description: url });
    }
  }

  /* #173: the duet switch — only the owning creator sees it, right on
     the video (never buried in settings). Optimistic flip, rolled
     back on failure; the API enforces the same state at POST. */
  async function toggleDuets() {
    const next = !item.duets_enabled;
    onUpdate({ duets_enabled: next });
    const res = await authedFetch(`/api/videos/${item.id}/duet-settings`, "PATCH", { duets_enabled: next }).catch(() => null);
    if (!res || !res.ok) {
      onUpdate({ duets_enabled: !next });
      toast({ title: "The switch didn't flip", description: "Try again." });
    }
  }

  return (
    <div ref={refCb} data-idx={idx} className="relative h-full w-full snap-start snap-always overflow-hidden bg-black">
      {/* video — S27-10: the tap surface is a real <button> (keyboard +
          screen-reader reachable), not a div onClick. Tap behaviour
          (single-tap play/pause, double-tap like) is identical. */}
      <button
        type="button"
        data-testid="shorts-play-toggle"
        aria-label={playing ? "Pause" : "Play"}
        onClick={handleTap}
        className="absolute inset-0 block h-full w-full cursor-pointer appearance-none border-0 bg-transparent p-0"
      >
        <video
          ref={(el) => { videoEl.current = el; videoRefCb(el); }}
          src={item.video_url}
          poster={item.thumbnail_url ?? undefined}
          aria-label={item.thumbnail_alt_text || item.title}
          className="h-full w-full object-contain"
          loop playsInline muted={muted}
          preload="metadata"
        />
      </button>
      {!playing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/60 p-5"><Play className="h-10 w-10 text-white" /></div>
        </div>
      )}
      {burst > 0 && (
        <div key={burst} className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Heart className="h-24 w-24 animate-ping text-red-500" fill="currentColor" />
        </div>
      )}

      {/* mute */}
      <button onClick={() => setMuted(!muted)} title={muted ? "Unmute" : "Mute"}
        className="absolute right-4 top-16 z-10 rounded-full bg-black/60 p-2.5 text-white">
        {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
      </button>

      {/* right action rail — every button goes somewhere real.
          Desktop lift (sm:bottom-60): the caption block's name row ends
          in the Follow/Following pill at the slide's right edge, and at
          desktop widths that pill lands exactly on the rail's Share
          label (measured: the label sat entirely inside the pill's
          rect). Raising the rail's anchor on sm+ screens moves the
          whole column clear of the caption row; the phone layout keeps
          bottom-28 untouched. */}
      <div className="absolute bottom-28 right-3 z-10 flex flex-col items-center gap-4 sm:bottom-60">
        <button onClick={doLike} className="flex flex-col items-center gap-1" title="Like">
          <span className={cn("rounded-full bg-black/60 p-3 transition", liked && "bg-red-500/20")}>
            <Heart className={cn("h-6 w-6 text-white", liked && "text-red-500")} fill={liked ? "currentColor" : "none"} />
          </span>
          <span className="text-xs font-semibold text-white">{fmt(likeCount)}</span>
        </button>
        <button onClick={() => setCommentsOpen(true)} className="flex flex-col items-center gap-1" title="Comments">
          <span className="rounded-full bg-black/60 p-3"><MessageCircle className="h-6 w-6 text-white" /></span>
          <span className="text-xs font-semibold text-white">{fmt(item.comment_count)}</span>
        </button>
        <button onClick={share} className="flex flex-col items-center gap-1" title="Share">
          <span className="rounded-full bg-black/60 p-3"><Share2 className="h-6 w-6 text-white" /></span>
          <span className="text-xs font-semibold text-white">Share</span>
        </button>
        {!isOwn && (
          <button onClick={toggleFollow} className="flex flex-col items-center gap-1" title={following ? "Following" : "Follow"}>
            <span className={cn("rounded-full p-3", following ? "bg-primary/30" : "bg-primary")}>
              {following ? <Check className="h-6 w-6 text-primary" /> : <Plus className="h-6 w-6 text-black" />}
            </span>
            <span className="text-xs font-semibold text-white">{following ? "On" : "Follow"}</span>
          </button>
        )}
        {/* money rail: tip + buy — guide them to the money */}
        {tipHandle && (
          <Link href={jarPath(tipHandle)} className="flex flex-col items-center gap-1" title="Tip the creator">
            <span className="rounded-full bg-primary/90 p-3"><HandCoins className="h-6 w-6 text-black" /></span>
            <span className="text-xs font-semibold text-primary">Tip</span>
          </Link>
        )}
        {item.download_price_cents > 0 && (
          <Link href={`/store/buy/video/${item.id}`} className="flex flex-col items-center gap-1" title="Buy this short">
            <span className="rounded-full bg-primary/90 p-3"><ShoppingBag className="h-6 w-6 text-black" /></span>
            <span className="text-xs font-semibold text-primary">${(item.download_price_cents / 100).toFixed(2)}</span>
          </Link>
        )}
        {/* 2 stars: duet / stitch controls. #173: a video whose
            creator switched duets OFF offers no duet door at all —
            and the API refuses the POST as well, so there is no
            back door. Stitch is a separate kind and stays. */}
        <div data-min-stars="2" className="flex flex-col items-center gap-4">
          {item.duets_enabled && (
            <Link href={duetEditorHref(item.id)} className="flex flex-col items-center gap-1" title="Duet this short">
              <span className="rounded-full bg-black/60 p-3"><Columns2 className="h-6 w-6 text-white" /></span>
              <span className="text-xs font-semibold text-white">Duet</span>
            </Link>
          )}
          <Link href={stitchEditorHref(item.id)} className="flex flex-col items-center gap-1" title="Stitch this short">
            <span className="rounded-full bg-black/60 p-3"><Scissors className="h-6 w-6 text-white" /></span>
            <span className="text-xs font-semibold text-white">Stitch</span>
          </Link>
        </div>
        {/* 4 stars: analytics */}
        <div data-min-stars="4">
          <button onClick={() => setAnalyticsOpen((o) => !o)} className="flex flex-col items-center gap-1" title="Why am I seeing this?">
            <span className="rounded-full bg-black/60 p-3"><BarChart3 className="h-6 w-6 text-white" /></span>
            <span className="text-xs font-semibold text-white">Stats</span>
          </button>
        </div>
      </div>

      {analyticsOpen && (
        <div className="absolute bottom-28 right-16 z-10 w-56 rounded-xl border border-primary/30 bg-black/90 p-3 text-xs text-white">
          <p className="mb-2 font-bold text-primary">Why you're seeing this</p>
          <div className="space-y-1 text-white/70">
            <p>Feed score: <b className="text-white">{item.score.toFixed(2)}</b></p>
            <p>Views {fmt(item.view_count)} · Likes {fmt(item.like_count)} · Comments {fmt(item.comment_count)}</p>
            {item.viewer_following && <p className="text-primary">▲ 2.5× — you follow this creator</p>}
            <p className="text-white/40">Fresh + moving fast climbs. Post yours.</p>
          </div>
        </div>
      )}

      {/* bottom caption block */}
      <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black via-black/60 to-transparent px-4 pb-24 pt-10">
        <div className="mb-2 flex items-center gap-3">
          <Link href={`/artist/${item.creator.slug}`}>
            {item.creator.avatar_url ? (
              <img src={item.creator.avatar_url} alt={item.creator.display_name} className="h-11 w-11 rounded-full border-2 border-primary object-cover" />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-primary bg-zinc-800 text-lg font-black text-primary">
                {item.creator.display_name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={`/artist/${item.creator.slug}`} className="block truncate font-bold text-white hover:text-primary">
              @{item.creator.display_name}
            </Link>
            <p className="truncate text-xs text-white/50">{fmt(item.view_count)} views</p>
          </div>
          {!isOwn && (
            <button onClick={toggleFollow}
              className={cn("rounded-full px-4 py-1.5 text-sm font-bold",
                following ? "border border-primary/50 text-primary" : "bg-primary text-black")}>
              {following ? "Following" : "Follow"}
            </button>
          )}
        </div>

        <p className="mb-1 text-sm font-semibold text-white">{item.title}</p>
        {item.description && (
          <p className="mb-2 line-clamp-2 text-sm text-white/75"><CaptionText text={item.description} /></p>
        )}

        {/* N3: the King's featured pick — labeled a HOUSE pick, and
            the fan who made the duet is the credited name on it. */}
        {item.king_featured_at && (
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            <span className="flex items-center gap-1 rounded-full border border-primary/50 bg-primary/15 px-2.5 py-1 font-bold text-primary">
              <Crown className="h-3.5 w-3.5" />
              King&apos;s pick — house pick by Thy Cheat Code · duet by @{item.creator.display_name}
            </span>
          </div>
        )}

        {/* #173: the owner's duet switch, on the video itself */}
        {isOwn && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-white/70">Duets on this video</span>
            <button type="button" onClick={toggleDuets} aria-pressed={item.duets_enabled}
              data-testid="duet-switch"
              className={cn("rounded-full px-3 py-1 font-bold",
                item.duets_enabled ? "bg-primary text-black" : "border border-white/30 text-white/60")}>
              {item.duets_enabled ? "On — anyone can duet" : "Off"}
            </button>
            {!item.duets_enabled && (
              <span className="text-white/40">No duet door is offered, and duet posts are refused.</span>
            )}
          </div>
        )}

        {/* duet/stitch parent lineage */}
        {(item.duet_parent || item.stitch_parent) && (
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            {item.duet_parent && (
              <Link href={`/shorts?start=${item.duet_parent.id}`}
                className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-white/80 hover:bg-white/20">
                <Columns2 className="h-3.5 w-3.5 text-primary" />
                Duet of “{item.duet_parent.title ?? "original"}”
              </Link>
            )}
            {item.stitch_parent && (
              <Link href={`/shorts?start=${item.stitch_parent.id}`}
                className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-white/80 hover:bg-white/20">
                <Scissors className="h-3.5 w-3.5 text-primary" />
                Stitched from “{item.stitch_parent.title ?? "original"}”
              </Link>
            )}
          </div>
        )}

        {/* children linkage — who ran with this */}
        {(item.duet_count > 0 || item.stitch_count > 0) && (
          <div className="mb-2">
            <button onClick={() => setLinkageOpen(linkageOpen ? null : (item.duet_count >= item.stitch_count ? "duet" : "stitch"))}
              className="flex items-center gap-1 text-xs font-semibold text-primary">
              <ChevronDown className={cn("h-3.5 w-3.5 transition", linkageOpen && "rotate-180")} />
              {item.duet_count > 0 && `${fmt(item.duet_count)} duet${item.duet_count > 1 ? "s" : ""}`}
              {item.duet_count > 0 && item.stitch_count > 0 && " · "}
              {item.stitch_count > 0 && `${fmt(item.stitch_count)} stitche${item.stitch_count > 1 ? "s" : ""}`}
            </button>
            {linkageOpen && <LinkageList videoId={item.id} kind={linkageOpen} />}
          </div>
        )}

        {/* challenge chips — the prize angle rides along */}
        {item.challenges.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {item.challenges.map((c) => (
              <Link key={c.slug} href={`/challenge/${c.slug}`}
                className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                <Trophy className="h-3.5 w-3.5" /> #{c.hashtag}
              </Link>
            ))}
          </div>
        )}

        {/* sound row — tappable to the sound page */}
        {item.sound && (
          <div className="flex items-center gap-2">
            <Link href={`/sound/${encodeURIComponent(item.sound.id)}`}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white/10 py-1.5 pl-2 pr-3 hover:bg-white/20">
              <Music2 className="h-4 w-4 shrink-0 animate-[spin_4s_linear_infinite] text-primary" />
              <span className="truncate text-xs text-white/85">
                {item.sound.title ?? "Original sound"} · {fmt(item.sound.use_count)} uses
              </span>
            </Link>
            <div data-min-stars="3">
              <Link href={shortSoundEditorHref(item.sound.id)}
                className="rounded-full border border-primary/50 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10">
                Use this sound
              </Link>
            </div>
          </div>
        )}
      </div>

      {commentsOpen && (
        <CommentsDrawer item={item} onClose={() => setCommentsOpen(false)}
          authHeaders={authHeaders} isAuthed={isAuthed}
          onCount={(n) => onUpdate({ comment_count: n })} />
      )}
    </div>
  );
}

/* ─── LinkageList — duet/stitch children, each linking back into the feed ── */

function LinkageList({ videoId, kind }: { videoId: string; kind: "duet" | "stitch" }) {
  const [kids, setKids] = useState<{ id: string; title: string; thumbnail_url: string | null; king_featured_at?: string | null; creator: { slug: string; display_name: string } | null }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet(`/api/videos/${videoId}/${kind}s`);
        if (!cancelled) setKids(data.items ?? []);
      } catch { /* empty */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [videoId, kind]);
  if (loading) return <p className="mt-1 text-xs text-white/40">Loading…</p>;
  if (!kids.length) return <p className="mt-1 text-xs text-white/40">None yet — be the first.</p>;
  return (
    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
      {kids.map((k) => (
        <Link key={k.id} href={`/shorts?start=${k.id}`} className="w-24 shrink-0">
          <div className="aspect-[9/16] overflow-hidden rounded-lg bg-zinc-900">
            {k.thumbnail_url ? <img src={k.thumbnail_url} alt={k.title} className="h-full w-full object-cover" /> : null}
          </div>
          <p className="mt-1 truncate text-[11px] text-white/70">{k.title}</p>
          {k.king_featured_at && (
            <p className="flex items-center gap-0.5 text-[10px] font-bold text-primary">
              <Crown className="h-3 w-3" /> King&apos;s pick
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}

/* ─── CommentsDrawer ─────────────────────────────────────────────────────── */

interface CommentRow { id: string; body: string; created_at?: string; createdAt?: string }

function CommentsDrawer({ item, onClose, authHeaders, isAuthed, onCount }: {
  item: ShortItem;
  onClose: () => void;
  authHeaders: () => Promise<Record<string, string>>;
  isAuthed: boolean;
  onCount: (n: number) => void;
}) {
  const { toast } = useToast();
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet(`/api/media/video/${item.id}/comments`);
        if (!cancelled) setComments(data.comments ?? []);
      } catch { /* empty */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [item.id]);

  async function post() {
    const text = body.trim();
    if (!text || posting) return;
    if (!isAuthed) { toast({ title: "Sign in to comment", description: "The floor is open — grab an account." }); return; }
    setPosting(true);
    try {
      const res = await fetch(`/api/media/video/${item.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json();
      if (res.ok && data.comment) {
        setComments((c) => [data.comment, ...c]);
        setBody("");
        onCount(comments.length + 1);
      } else {
        toast({ title: "Comment didn't land", description: data.error ?? "Try again." });
      }
    } catch {
      toast({ title: "Comment didn't land", description: "Try again." });
    } finally { setPosting(false); }
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end" onClick={onClose}>
      <div className="flex max-h-[70%] flex-col rounded-t-2xl border-t border-primary/30 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-bold text-white">{comments.length} comment{comments.length === 1 ? "" : "s"}</p>
          <button onClick={onClose} className="rounded-full bg-white/10 p-1.5 text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-3 flex-1 space-y-3 overflow-y-auto">
          {loading && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}
          {!loading && !comments.length && (
            <p className="py-6 text-center text-sm text-white/40">No comments yet. Say the thing everyone's thinking.</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="rounded-xl bg-white/5 p-3">
              <p className="text-sm text-white/90">{c.body}</p>
              <p className="mt-1 text-[11px] text-white/35">
                {(c.created_at ?? c.createdAt) ? new Date(String(c.created_at ?? c.createdAt)).toLocaleDateString() : ""}
              </p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === "Enter" && post()}
            aria-label={isAuthed ? "Add a comment" : "Sign in to join the conversation"}
            placeholder={isAuthed ? "Add a comment…" : "Sign in to join the conversation"}
            className="flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-white/30" />
          <button onClick={post} disabled={posting || !body.trim()}
            className="rounded-full bg-primary p-2.5 text-black disabled:opacity-40">
            {posting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── KingDuetPanel — Duet the King (N3 on the #173 rails) ──────────────────
   The launch event lives in the Shorts home, on the SAME rails: the
   King's open clips are ordinary shorts whose duet switch is on —
   the Duet button rides the exact duetEditorHref every other short
   uses, and the POST behind it is the same /videos/:id/duet. The
   featured pick is stated honestly as what it is: a HOUSE pick by
   Thy Cheat Code, with the fan who made the duet credited on it. */

interface KingClip {
  id: string; title: string; video_url: string; thumbnail_url: string | null;
  view_count: number; like_count: number; duet_count: number; duets_enabled: boolean;
  creator: { id: string; slug: string; display_name: string; avatar_url: string | null } | null;
}
interface KingPick {
  id: string; title: string; video_url: string; thumbnail_url: string | null;
  king_featured_at: string | null; pick_kind: string;
  creator: { id: string; slug: string; display_name: string; avatar_url: string | null } | null;
  duet_parent: { id: string; title: string | null; creator_slug: string | null; creator_name: string | null } | null;
}

function KingDuetPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [clips, setClips] = useState<KingClip[]>([]);
  const [featured, setFeatured] = useState<KingPick[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    (async () => {
      try {
        const data = await apiGet("/api/shorts/king-duet");
        if (cancelled) return;
        setClips(Array.isArray(data?.open_clips) ? data.open_clips : []);
        setFeatured(Array.isArray(data?.featured) ? data.featured : []);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open ]);

  return (
    <>
      <button onClick={() => setOpen(true)} title="Duet the King"
        data-testid="king-duet-open"
        className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-black text-black hover:brightness-110">
        <Crown className="h-4 w-4" /> Duet the King
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/70" onClick={() => setOpen(false)}>
          <div className="flex h-full w-96 max-w-[88vw] flex-col border-l border-primary/30 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 font-black text-white">
                <Crown className="h-5 w-5 text-primary" /> Duet the King
              </p>
              <button onClick={() => setOpen(false)} className="rounded-full bg-white/10 p-1.5 text-white"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-white/50">
              Thy Cheat Code posts a clip and opens it for duets — same rails as every duet here.
              The featured duet below is the King&apos;s own <b className="text-primary">house pick</b>,
              and the fan who made it is credited right on the pick.
            </p>
            <div className="flex-1 space-y-5 overflow-y-auto">
              {loading && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}
              {!loading && failed && (
                <p className="py-8 text-center text-sm text-red-300" data-testid="king-duet-error">
                  The King&apos;s rail couldn&apos;t load — close and reopen to retry.
                </p>
              )}
              {!loading && !failed && (
                <>
                  <div>
                    <p className="mb-2 text-xs font-black uppercase tracking-wider text-primary">Open now — duet the King&apos;s clip</p>
                    {clips.length ? clips.map((c) => (
                      <div key={c.id} className="mb-2 rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="flex gap-3">
                          <Link href={`/shorts?start=${c.id}`} className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
                            {c.thumbnail_url ? <img src={c.thumbnail_url} alt={c.title} className="h-full w-full object-cover" /> : null}
                          </Link>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-bold text-white">{c.title}</p>
                            <p className="text-xs text-white/50">
                              by @{c.creator?.display_name ?? "Thy Cheat Code"} · {fmt(c.duet_count)} duet{c.duet_count === 1 ? "" : "s"} so far
                            </p>
                            <Link href={duetEditorHref(c.id)}
                              className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 text-[11px] font-black text-black hover:brightness-110">
                              <Columns2 className="h-3.5 w-3.5" /> Duet this clip
                            </Link>
                          </div>
                        </div>
                      </div>
                    )) : (
                      <p className="py-4 text-sm text-white/40">The King hasn&apos;t opened a clip yet — watch this space.</p>
                    )}
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-black uppercase tracking-wider text-primary">The King&apos;s featured pick</p>
                    {featured.length ? featured.map((f) => (
                      <div key={f.id} className="mb-2 rounded-xl border border-primary/40 bg-primary/10 p-3">
                        <div className="flex gap-3">
                          <Link href={`/shorts?start=${f.id}`} className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
                            {f.thumbnail_url ? <img src={f.thumbnail_url} alt={f.title} className="h-full w-full object-cover" /> : null}
                          </Link>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-bold text-white">{f.title}</p>
                            <p className="text-xs text-white/70">
                              duet by <Link href={`/artist/${f.creator?.slug ?? ""}`} className="font-bold text-primary hover:underline">@{f.creator?.display_name ?? "a fan"}</Link>
                              {f.duet_parent ? <> of the King&apos;s “{f.duet_parent.title ?? "clip"}”</> : null}
                            </p>
                            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-black text-black">
                              <Crown className="h-3 w-3" /> HOUSE PICK — THY CHEAT CODE
                            </p>
                          </div>
                        </div>
                      </div>
                    )) : (
                      <p className="py-4 text-sm text-white/40">No pick yet — the best duet of the King&apos;s clip takes this spot.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── ShortsMenu — trending challenges + sounds, all linking somewhere real ─ */

function ShortsMenu() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"challenges" | "sounds">("challenges");
  const [challenges, setChallenges] = useState<{ slug: string; title: string; hashtag: string; entry_count: number; prize_text: string; prize_pool_credits?: number; effective_status?: string }[]>([]);
  const [sounds, setSounds] = useState<{ id: string; title: string | null; use_count: number; is_earning: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  /* Stack-28 #34 / A3-F13: a failed trending fetch is NOT an empty
     list — each tab carries its own failed flag. */
  const [challengesFailed, setChallengesFailed] = useState(false);
  const [soundsFailed, setSoundsFailed] = useState(false);

  useEffect(() => {
    if (!open || loading) return;
    setLoading(true);
    (async () => {
      try {
        const [c, s] = await Promise.all([
          apiGet("/api/challenges/trending?limit=10").then((v) => { setChallengesFailed(false); return v; }).catch(() => { setChallengesFailed(true); return { challenges: [] }; }),
          apiGet("/api/sounds/trending?limit=10").then((v) => { setSoundsFailed(false); return v; }).catch(() => { setSoundsFailed(true); return { sounds: [] }; }),
        ]);
        setChallenges(c.challenges ?? []);
        setSounds(s.sounds ?? []);
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  return (
    <>
      <button onClick={() => setOpen(true)} title="Trending"
        className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-black/50 px-3 py-1.5 text-xs font-bold text-primary">
        <Trophy className="h-4 w-4" /> Trending
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/70" onClick={() => setOpen(false)}>
          <div className="flex h-full w-80 max-w-[85vw] flex-col border-l border-primary/30 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex gap-2">
                <button onClick={() => setTab("challenges")}
                  className={cn("rounded-full px-3 py-1.5 text-xs font-bold", tab === "challenges" ? "bg-primary text-black" : "bg-white/10 text-white/70")}>
                  Challenges
                </button>
                <button onClick={() => setTab("sounds")}
                  className={cn("rounded-full px-3 py-1.5 text-xs font-bold", tab === "sounds" ? "bg-primary text-black" : "bg-white/10 text-white/70")}>
                  Sounds
                </button>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-full bg-white/10 p-1.5 text-white"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {loading && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}
              {!loading && tab === "challenges" && (
                challenges.length ? challenges.map((c) => {
                  const enterable = c.effective_status === "live" || c.effective_status === "upcoming";
                  return (
                    <div key={c.slug}
                      className="rounded-xl border border-white/10 bg-white/5 p-3 hover:border-primary/40">
                      <Link href={`/challenge/${c.slug}`}>
                        <p className="font-bold text-white">{c.title}</p>
                        <p className="text-xs text-primary">#{c.hashtag} · {fmt(c.entry_count)} entries</p>
                        {(c.prize_pool_credits ?? 0) > 0 ? (
                          <p className="mt-1 text-xs font-bold text-primary">🏆 {formatBucs(c.prize_pool_credits!)} prize pool</p>
                        ) : c.prize_text ? (
                          <p className="mt-1 text-xs text-white/60">🏆 {c.prize_text}</p>
                        ) : null}
                      </Link>
                      {enterable && (
                        <Link href={`/publish?challenge=${encodeURIComponent(c.slug)}`}
                          className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 text-[11px] font-black text-black hover:brightness-110">
                          <Plus className="h-3.5 w-3.5" /> Enter this challenge
                        </Link>
                      )}
                    </div>
                  );
                }) : challengesFailed ? <p className="py-8 text-center text-sm text-red-300" data-testid="shorts-menu-challenges-error">Trending challenges couldn&apos;t load — close and reopen to retry.</p> : <p className="py-8 text-center text-sm text-white/40">No challenges yet — start the first one and own the wave.</p>
              )}
              {!loading && tab === "sounds" && (
                sounds.length ? sounds.map((s) => (
                  <Link key={s.id} href={`/sound/${encodeURIComponent(s.id)}`}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 hover:border-primary/40">
                    <span className="rounded-full bg-primary/15 p-2"><Music2 className="h-4 w-4 text-primary" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-white">{s.title ?? "Untitled sound"}</p>
                      <p className="text-xs text-white/50">{fmt(s.use_count)} uses
                        {s.is_earning && <span className="ml-1 font-bold text-primary">· 💰 earning</span>}</p>
                    </div>
                  </Link>
                )) : soundsFailed ? <p className="py-8 text-center text-sm text-red-300" data-testid="shorts-menu-sounds-error">Trending sounds couldn&apos;t load — close and reopen to retry.</p> : <p className="py-8 text-center text-sm text-white/40">No sounds trending yet.</p>
              )}
            </div>
            <div data-min-stars="3" className="mt-3 border-t border-white/10 pt-3">
              <p className="text-xs text-white/40">3★+ unlocks sound tools and trending picks right here.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
