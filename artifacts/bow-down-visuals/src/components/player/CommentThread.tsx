import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Send, Pin, EyeOff, Eye, Check, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { postComment, formatCount, type MediaComment, type MediaKind } from "@/lib/streaming";
import { ReportButton } from "@/components/social/ReportButton";
import {
  fetchMediaThread,
  runCommentAction,
  ownerActionsFor,
  HELD_COPY,
  HIDDEN_COPY,
  type CommentControlAction,
} from "@/lib/comment-controls";

/* ─── Comment thread for media pages (Worker 2) ───
   GET/POST /api/media/:kind/:id/comments. Guests read, sign-in to reply.
   Creator comment controls (#27): pinned comments arrive first and are
   badged; held/hidden comments are only returned to the creator and to
   their author (badged with the reason — a hold is a delay, never a
   silent deletion); the owner gets inline pin/hide/approve/reject. */

const ACTION_LABEL: Record<CommentControlAction, string> = {
  pin: "Pin", unpin: "Unpin", hide: "Hide", unhide: "Unhide", approve: "Approve", reject: "Reject",
};

export function CommentThread({ kind, mediaId }: { kind: MediaKind; mediaId: string }) {
  const { user, getAccessToken } = useAuth();
  const [comments, setComments] = useState<MediaComment[]>([]);
  const [viewerIsOwner, setViewerIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heldNotice, setHeldNotice] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = user ? await getAccessToken().catch(() => null) : null;
    const { comments: list, viewerIsOwner: isOwner } = await fetchMediaThread(kind, mediaId, token);
    setComments(list as MediaComment[]);
    setViewerIsOwner(isOwner);
  }, [kind, mediaId, user, getAccessToken]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load()
      .catch(() => { /* keep whatever we have */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [load]);

  async function handlePost() {
    const text = body.trim();
    if (!text || posting || !user) return;
    setPosting(true);
    setError(null);
    setHeldNotice(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to comment");
      const c = await postComment(kind, mediaId, text, { Authorization: `Bearer ${token}` });
      setComments((cs) => [c, ...cs]);
      setBody("");
      if (c.status === "held") setHeldNotice(c.held_copy ?? HELD_COPY);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't post that comment");
    } finally {
      setPosting(false);
    }
  }

  async function act(c: MediaComment, action: CommentControlAction) {
    setActingId(c.id);
    setError(null);
    try {
      const token = await getAccessToken();
      await runCommentAction(token, "media", c.id, action);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "That comment action didn't stick");
    } finally {
      setActingId(null);
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
      {heldNotice && (
        <p className="mt-2 text-sm text-[#e8c86a] rounded-xl bg-[#e8c86a]/10 border border-[#e8c86a]/30 px-4 py-3">
          Your comment was posted — and it's being held: {heldNotice}
        </p>
      )}

      <div className="mt-5 space-y-3">
        {loading ? (
          <p className="text-sm text-white/40">Loading comments…</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-white/40 rounded-xl border border-dashed border-white/15 px-4 py-6 text-center">
            No comments yet — be the first. First comments hit different.
          </p>
        ) : (
          comments.map((c) => {
            const pinned = c.pinned === true || c.is_pinned === true;
            const status = c.status ?? "public";
            return (
              <article key={c.id} className={`flex gap-3 rounded-xl bg-white/[.03] border px-4 py-3 ${pinned ? "border-[#e8c86a]/50" : "border-white/10"}`}>
                {c.avatar_url ? (
                  <img src={c.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-[#e8c86a]/15 text-[#e8c86a] flex items-center justify-center text-xs font-bold shrink-0">
                    {(c.display_name ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-xs text-white/50">
                    <span className="text-white/80 font-semibold">{c.display_name ?? "Creator"}</span>
                    {c.created_at && (
                      <span>{new Date(c.created_at).toLocaleDateString()}</span>
                    )}
                    {pinned && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#e8c86a] px-2 py-0.5 text-[10px] font-bold text-black">
                        <Pin className="h-3 w-3" /> Pinned by creator
                      </span>
                    )}
                    {status === "held" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                        Held for review
                      </span>
                    )}
                    {status === "hidden" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/60">
                        <EyeOff className="h-3 w-3" /> Hidden
                      </span>
                    )}
                    {user && c.user_id !== user.id && (
                      <span className="ml-auto">
                        <ReportButton targetType="comment" targetId={c.id} variant="text" />
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-white/85 mt-0.5 break-words">{c.body}</p>
                  {status === "held" && (
                    <p className="mt-1 text-xs text-amber-200/80">{c.held_copy ?? HELD_COPY}</p>
                  )}
                  {status === "hidden" && (
                    <p className="mt-1 text-xs text-white/40">{HIDDEN_COPY}</p>
                  )}
                  {viewerIsOwner && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ownerActionsFor(c).map((a) => (
                        <button
                          key={a}
                          type="button"
                          disabled={actingId === c.id}
                          onClick={() => void act(c, a)}
                          className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 hover:border-[#e8c86a]/60 hover:text-white disabled:opacity-40"
                        >
                          {a === "pin" || a === "unpin" ? <Pin className="h-3 w-3" />
                            : a === "hide" ? <EyeOff className="h-3 w-3" />
                            : a === "unhide" ? <Eye className="h-3 w-3" />
                            : a === "approve" ? <Check className="h-3 w-3" />
                            : <X className="h-3 w-3" />}
                          {ACTION_LABEL[a]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
