import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, AlertTriangle, RotateCcw, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { apiFetch, type FeedPost } from "@/lib/social-api";
import { PostCard } from "@/components/social/PostCard";

/* ─── /post/:id — one post, on its own page ───────────────────────────────
   DE-17: notifications used to dump every mention / reply / quote /
   repost alert on /home and make the creator hunt for the post. The
   bell now links here — the exact post (GET /api/posts/:id, the same
   enriched DTO the feed renders), with PostCard's own reply / quote /
   repost machinery live. A scoped post the viewer can't see 404s
   server-side, and this page says so honestly instead of faking an
   empty state. */
export default function PostPage() {
  const { getAccessToken } = useAuth();
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [post, setPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  usePageTitle("Post", "One post on Bow Down Visuals — replies, quotes and all.");

  const load = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    try {
      const res = await apiFetch(getAccessToken, `/api/posts/${encodeURIComponent(params.id)}`);
      if (res.status === 404) {
        setNotFound(true);
        setPost(null);
        return;
      }
      if (!res.ok) throw new Error(`post load failed (${res.status})`);
      const data = (await res.json()) as { post: FeedPost };
      setPost(data.post);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, retryNonce]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pb-24 pt-6">
      <Link href="/home" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-400 hover:text-[#d4af37]">
        <ArrowLeft className="h-4 w-4" /> Back to your timeline
      </Link>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-[#d4af37]" />
        </div>
      ) : notFound ? (
        <div className="rounded-2xl border border-[#2a2a2a] px-6 py-12 text-center">
          <p className="text-lg font-black text-white">This post doesn't exist — yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-500">
            It may have been deleted, or it's a circle-only post that isn't in your circle.
          </p>
          <Link href="/home" className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black hover:brightness-110">
            Back to your timeline
          </Link>
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-[#2a2a2a] px-6 py-12 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-[#d4af37]" />
          <p className="mt-3 text-lg font-black text-white">That post wouldn't load.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-500">
            A connection hiccup, not an empty page — give it another tap.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : post ? (
        <PostCard post={post} onDeleted={() => navigate("/home")} onReposted={() => void load()} />
      ) : null}
    </div>
  );
}
