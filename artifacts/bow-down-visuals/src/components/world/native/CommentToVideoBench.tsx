/**
 * CommentToVideoBench — Comment-to-Video's native bench at
 * the Hook Desk (Stack 300 world parity, census Lane B item
 * 9 / manifest item 102), stacked under the Hook Desk itself:
 * the Hooks page's "comments" tab, in the room.
 *
 * The section's own flow on its own rail (lib/world/
 * comment-to-video-bench.ts): paste up to 20 comments, an
 * optional niche, and the run — 200 Bucs behind the spend
 * confirmation, the override the page itself passes — comes
 * back with complete response-video scripts (title, hook,
 * script, visuals, CTA), each with the section's own
 * copy-all text. A decline runs nothing; a 402 lands in the
 * out-of-Bucs state; a failed run is refunded server-side.
 * Copy rides the commentToVideo.* namespace.
 */
import { useState } from "react";
import { Check, Copy, Loader2, MessageSquareReply, Plus, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, plainErrorText } from "@/lib/api-error";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { DeskTextField, deskInputCls } from "./CreateDeskLeaf";
import {
  COMMENT_TO_VIDEO_COST,
  COMMENT_TO_VIDEO_FEATURE,
  COMMENT_TO_VIDEO_MAX_COMMENTS,
  COMMENT_TO_VIDEO_NICHE_MAX,
  COMMENT_TO_VIDEO_PATH,
  addBenchComment,
  buildCommentVideoPayload,
  commentVideoInputReady,
  commentVideoScriptCopyText,
  commentVideoScriptsOf,
  type CommentVideoScript,
} from "@/lib/world/comment-to-video-bench";

export function CommentToVideoBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [commentInput, setCommentInput] = useState("");
  const [comments, setComments] = useState<string[]>([]);
  const [niche, setNiche] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [scripts, setScripts] = useState<CommentVideoScript[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const labelCls = `text-[11px] font-bold uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;
  const ready = commentVideoInputReady(comments);

  function addComment() {
    const next = addBenchComment(comments, commentInput);
    if (!next) return;
    setComments(next);
    setCommentInput("");
  }

  async function generate() {
    if (!ready || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(COMMENT_TO_VIDEO_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: COMMENT_TO_VIDEO_COST,
        overrideFeature: COMMENT_TO_VIDEO_FEATURE,
        body: JSON.stringify(buildCommentVideoPayload(comments, niche)),
      });
      if (!res) return; // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      const parsed = commentVideoScriptsOf(data);
      if (!res.ok || !parsed) {
        throw new Error(apiErrorMessage(data, t("commentToVideo.failed")));
      }
      setScripts(parsed);
      refreshProfile();
    } catch (e) {
      setError(plainErrorText(e, t("commentToVideo.failed")));
    } finally {
      setLoading(false);
    }
  }

  function copyScript(s: CommentVideoScript, i: number) {
    void navigator.clipboard?.writeText(commentVideoScriptCopyText(s)).then(() => {
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx(null), 1500);
    }).catch(() => {});
  }

  return (
    <div className="space-y-3" data-testid="world-comment-to-video-bench">
      <div className="flex items-center gap-2">
        <MessageSquareReply className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
        <p className={`text-base font-black ${strong}`}>{t("commentToVideo.title")}</p>
        <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
          {t("commentToVideo.cost")}
        </span>
      </div>
      <p className={`text-xs ${muted}`}>{t("commentToVideo.desc")}</p>

      <div className="flex gap-2">
        <input
          aria-label={t("commentToVideo.pastePh")}
          value={commentInput}
          onChange={(e) => setCommentInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addComment()}
          placeholder={t("commentToVideo.pastePh")}
          maxLength={500}
          className={deskInputCls(isLight)}
        />
        <button
          type="button"
          onClick={addComment}
          disabled={!commentInput.trim() || comments.length >= COMMENT_TO_VIDEO_MAX_COMMENTS}
          className={`shrink-0 rounded-xl border px-3 disabled:opacity-40 bdv-touch-target ${isLight ? "border-[#C9A84C]/40 text-[#7A5A12]" : "border-white/15 text-white"}`}
          aria-label={t("commentToVideo.add")}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {comments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {comments.map((c, i) => (
            <span key={i} className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${cardCls}`}>
              <span className="max-w-[280px] truncate">“{c}”</span>
              <button
                type="button"
                onClick={() => setComments((prev) => prev.filter((_, idx) => idx !== i))}
                className={muted}
                aria-label={t("worldBenches300.removeLabel")}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <DeskTextField
        isLight={isLight}
        label={t("commentToVideo.nicheLabel")}
        value={niche}
        onChange={(v) => setNiche(v.slice(0, COMMENT_TO_VIDEO_NICHE_MAX))}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="world-comment-to-video-run"
          onClick={() => void generate()}
          disabled={loading || !ready}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("commentToVideo.generate")}
        </button>
      </div>
      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldBenches300.outOfBucs", { feature: COMMENT_TO_VIDEO_FEATURE })}
        </p>
      )}
      {error && (
        <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
      )}

      {scripts.length > 0 && (
        <div className="space-y-3" data-testid="world-comment-to-video-results">
          {scripts.map((s, i) => (
            <div key={i} className={`space-y-2 rounded-xl border p-3 ${cardCls}`}>
              <div className="flex items-start justify-between gap-2">
                <p className={`text-sm font-black ${strong}`}>{s.title}</p>
                <button
                  type="button"
                  onClick={() => copyScript(s, i)}
                  className={`shrink-0 ${muted}`}
                  aria-label={t("worldBenches300.copyLabel")}
                >
                  {copiedIdx === i ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <div>
                <p className={labelCls}>{t("commentToVideo.hook")}</p>
                <p className={`text-sm font-semibold ${strong}`}>{s.hook}</p>
              </div>
              <div>
                <p className={labelCls}>{t("commentToVideo.script")}</p>
                <p className={`whitespace-pre-wrap text-sm leading-relaxed ${isLight ? "text-[#2a1e07]/80" : "text-white/75"}`}>{s.script}</p>
              </div>
              <div>
                <p className={labelCls}>{t("commentToVideo.visuals")}</p>
                <p className={`text-sm ${muted}`}>{s.visualPlan}</p>
              </div>
              <div>
                <p className={labelCls}>{t("commentToVideo.cta")}</p>
                <p className={`text-sm ${muted}`}>{s.cta}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
