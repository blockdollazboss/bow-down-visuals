import { useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchComments, postComment, formatCount, type MediaComment, type MediaKind } from "@/lib/streaming";

/* ─── Comment thread for media pages (Worker 2) ───
   GET/POST /api/media/:kind/:id/comments. Guests read, sign-in to reply. */

export function CommentThread({ kind, mediaId }: { kind: MediaKind; mediaId: string }) {
  const { user, getAccessToken } = useAuth();
  const [comments, setComments] = useState<MediaComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchComments(kind, mediaId)
      .then((list) => { if (alive) setComments(list); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [kind, mediaId]);

  async function handlePost() {
    const text = body.trim();
    if (!text || posting || !user) return;
    setPosting(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to comment");
      const c = await postComment(kind, mediaId, text, { Authorization: `Bearer ${token}` });
      setComments((cs) => [c, ...cs]);
      setBody("");
    } catch (e: any) {
      setError(e?.message ?? "Couldn't post that comment");
    } finally {
      setPosting(false);
    }
  }

  return (
    <section aria-label="Comments" className="mt-8">
      <h2 className="flex items-center gap-2 text-lg font-bold text-white">
        <MessageCircle className="h-5 w-5 text-[#e8c86a]" />
        Comments <span className="text-sm font-normal text-white/40">{formatCount(comments.length)}</span>
      </h2>

      {user ? (
        <div className="mt-4 flex gap-2">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handlePost(); }}
            placeholder="Say something worth reading…"
            maxLength={500}
            className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8c86a]/60"
          />
          <button
            onClick={handlePost}
            disabled={posting || !body.trim()}
            className="rounded-xl bg-[#e8c86a] text-black px-4 py-2.5 text-sm font-bold disabled:opacity-40 hover:bg-[#f5d67e] transition-colors flex items-center gap-1.5"
          >
            <Send className="h-4 w-4" /> Post
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-white/40 rounded-xl bg-white/5 border border-white/10 px-4 py-3">
          Sign in to join the conversation — the loud ones get noticed here.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-5 space-y-3">
        {loading ? (
          <p className="text-sm text-white/40">Loading comments…</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-white/40 rounded-xl border border-dashed border-white/15 px-4 py-6 text-center">
            No comments yet — be the first. First comments hit different.
          </p>
        ) : (
          comments.map((c) => (
            <article key={c.id} className="flex gap-3 rounded-xl bg-white/[.03] border border-white/10 px-4 py-3">
              {c.avatar_url ? (
                <img src={c.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-[#e8c86a]/15 text-[#e8c86a] flex items-center justify-center text-xs font-bold shrink-0">
                  {(c.display_name ?? "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs text-white/50">
                  <span className="text-white/80 font-semibold">{c.display_name ?? "Creator"}</span>
                  {c.created_at && (
                    <span className="ml-2">{new Date(c.created_at).toLocaleDateString()}</span>
                  )}
                </p>
                <p className="text-sm text-white/85 mt-0.5 break-words">{c.body}</p>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
