import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Flame, Clock3, Bookmark, TrendingUp } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { apiJson, type FeedPost } from "@/lib/social-api";
import { StoriesRail } from "@/components/social/StoriesRail";
import { Composer } from "@/components/social/Composer";
import { PostCard } from "@/components/social/PostCard";

/* ─── /home — the creator feed ─────────────────────────────────────────────
   Your timeline, no algorithm overlords 🦈 — chronological by default,
   For You when you want the boost. Stories rail on top, composer docked. */
export default function FeedPage() {
  const { getAccessToken } = useAuth();
  const [mode, setMode] = useState<"chrono" | "foryou">("chrono");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  usePageTitle("Home", "Your creator timeline — chronological by default, For You when you want the boost.");

  const load = useCallback(
    async (reset: boolean, m: "chrono" | "foryou") => {
      const before = !reset && posts.length > 0 ? posts[posts.length - 1].created_at : null;
      if (reset) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const q = new URLSearchParams({ mode: m, limit: "20" });
        if (before) q.set("before", before);
        const data = await apiJson<{ posts: FeedPost[] }>(getAccessToken, `/api/feed?${q}`);
        setPosts((prev) => (reset ? data.posts : [...prev, ...data.posts]));
        setHasMore(data.posts.length === 20);
      } catch (e) {
        if (reset) setError(e instanceof Error ? e.message : "Couldn't load your feed.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [getAccessToken, posts],
  );

  useEffect(() => {
    setPosts([]);
    setHasMore(true);
    load(true, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          load(false, mode);
        }
      },
      { rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, loading, mode, load]);

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pb-24 pt-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-black text-white">
          Your <span className="text-[#d4af37]">Timeline</span>
        </h1>
        {/* chrono / for-you toggle */}
        <div className="flex overflow-hidden rounded-full border border-[#2a2a2a] text-sm" role="tablist" aria-label="Feed mode">
          <button
            role="tab"
            aria-selected={mode === "chrono"}
            onClick={() => setMode("chrono")}
            title="Your timeline, no algorithm overlords 🦈"
            className={`flex items-center gap-1.5 px-4 py-2 font-semibold ${mode === "chrono" ? "bg-[#d4af37] text-black" : "text-neutral-400 hover:text-white"}`}
          >
            <Clock3 className="h-4 w-4" /> Latest
          </button>
          <button
            role="tab"
            aria-selected={mode === "foryou"}
            onClick={() => setMode("foryou")}
            title="Followed creators + what's popping get a boost"
            className={`flex items-center gap-1.5 px-4 py-2 font-semibold ${mode === "foryou" ? "bg-[#d4af37] text-black" : "text-neutral-400 hover:text-white"}`}
          >
            <Flame className="h-4 w-4" /> For You
          </button>
        </div>
      </div>
      <p className="mb-4 text-xs text-neutral-500">
        {mode === "chrono"
          ? "Chronological — your timeline, no algorithm overlords. 🦈"
          : "For You — creators you follow and high-engagement posts get a boost."}
      </p>

      <div className="mb-5">
        <StoriesRail />
      </div>

      <div className="mb-5">
        <Composer onPosted={(p) => setPosts((prev) => [p, ...prev])} />
      </div>

      <div className="mb-4 flex items-center gap-3 text-sm">
        <Link href="/trending" className="flex items-center gap-1.5 rounded-full border border-[#2a2a2a] px-4 py-2 text-neutral-300 hover:border-[#d4af37] hover:text-[#d4af37]">
          <TrendingUp className="h-4 w-4" /> Trending
        </Link>
        <Link href="/saved" className="flex items-center gap-1.5 rounded-full border border-[#2a2a2a] px-4 py-2 text-neutral-300 hover:border-[#d4af37] hover:text-[#d4af37]">
          <Bookmark className="h-4 w-4" /> Saved
        </Link>
      </div>

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl border border-[#2a2a2a] bg-[#111]" />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="rounded-2xl border border-red-900 bg-red-950/30 p-6 text-center">
          <p className="text-sm text-red-300">{error}</p>
          <button onClick={() => load(true, mode)} className="mt-3 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black">
            Try again
          </button>
        </div>
      )}

      {!loading && !error && posts.length === 0 && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#111] p-10 text-center">
          <p className="text-lg font-bold text-white">Quiet waters… for now 🦈</p>
          <p className="mt-2 text-sm text-neutral-400">
            Follow some creators and their posts will land here. Or be the first to make noise — post above.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))}
            onReposted={() => load(true, mode)}
          />
        ))}
      </div>

      <div ref={sentinel} />
      {loadingMore && <p className="mt-6 text-center text-xs text-neutral-500">Loading more…</p>}
      {!hasMore && posts.length > 0 && <p className="mt-6 text-center text-xs text-neutral-600">You're all caught up 🦈</p>}
    </div>
  );
}
