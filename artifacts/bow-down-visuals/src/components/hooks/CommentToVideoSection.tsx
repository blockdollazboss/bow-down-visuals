import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquareReply, Loader2, Sparkles, Plus, X, Copy, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Comment-to-Video ──────────────────────────────────────────────────────
   Lives in the Content hub (/hooks) as a tab. Paste top comments; AI picks
   the most video-worthy ones and writes complete response-video scripts
   (title, 3-second hook, full script, visual plan, CTA). 2 credits. */

const COST = 2;
const MAX_COMMENTS = 20;

interface VideoScript {
  title: string;
  hook: string;
  script: string;
  visualPlan: string;
  cta: string;
}

interface ScriptsResponse {
  scripts?: VideoScript[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export default function CommentToVideoSection() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [commentInput, setCommentInput] = useState("");
  const [comments, setComments] = useState<string[]>([]);
  const [niche, setNiche] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [scripts, setScripts] = useState<VideoScript[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  function addComment() {
    const c = commentInput.trim();
    if (!c || comments.length >= MAX_COMMENTS) return;
    setComments((prev) => [...prev, c]);
    setCommentInput("");
  }

  function removeComment(i: number) {
    setComments((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function generate() {
    if (comments.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/comment-to-video/scripts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: COST,
        overrideFeature: "Comment-to-Video",
        body: JSON.stringify({ comments, niche: niche.trim(), count: 3 }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as ScriptsResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.scripts?.length) throw new Error(data.message || "Script generation failed.");
      setScripts(data.scripts);
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Script generation failed.");
    } finally {
      setLoading(false);
    }
  }

  function copyScript(s: VideoScript, i: number) {
    const text = `${s.title}\n\nHOOK: ${s.hook}\n\n${s.script}\n\nVISUALS: ${s.visualPlan}\n\nCTA: ${s.cta}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <MessageSquareReply className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-white">{t("commentToVideo.title", { defaultValue: "Comment-to-Video" })}</h3>
          <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
            {t("commentToVideo.cost", { defaultValue: "2 VB" })}
          </span>
        </div>
        <p className="text-sm text-white/50 mb-6">
          {t("commentToVideo.desc", { defaultValue: "Paste your top comments — AI turns the best ones into complete response-video scripts: hook, script, visuals, CTA." })}
        </p>

        <div className="flex gap-2 mb-3">
          <input
            value={commentInput}
            onChange={(e) => setCommentInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addComment()}
            placeholder={t("commentToVideo.pastePh", { defaultValue: "Paste a comment, hit Enter…" })}
            className={inputClass}
            maxLength={500}
          />
          <button
            type="button"
            onClick={addComment}
            disabled={!commentInput.trim() || comments.length >= MAX_COMMENTS}
            className="shrink-0 rounded-xl bg-white/10 px-4 text-white hover:bg-white/15 disabled:opacity-40"
            aria-label={t("commentToVideo.add", { defaultValue: "Add comment" })}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {comments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {comments.map((c, i) => (
              <span key={i} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/75">
                <span className="truncate max-w-[280px]">“{c}”</span>
                <button type="button" onClick={() => removeComment(i)} className="text-white/40 hover:text-white" aria-label="Remove">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mb-2">
          <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("commentToVideo.nicheLabel", { defaultValue: "Your niche (optional)" })}
          </label>
          <input value={niche} onChange={(e) => setNiche(e.target.value)} className={`${inputClass} mt-1.5`} maxLength={120} />
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}

        <button
          type="button"
          onClick={generate}
          disabled={loading || comments.length === 0}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("commentToVideo.generate", { defaultValue: "Write Response Scripts" })}
        </button>
      </div>

      {scripts.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {scripts.map((s, i) => (
            <div key={i} className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-base font-black text-white">{s.title}</h4>
                <button type="button" onClick={() => copyScript(s, i)} className="shrink-0 text-white/50 hover:text-white" aria-label="Copy">
                  {copiedIdx === i ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1">{t("commentToVideo.hook", { defaultValue: "Hook (3s)" })}</p>
                <p className="text-sm text-white font-semibold">{s.hook}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1">{t("commentToVideo.script", { defaultValue: "Script" })}</p>
                <p className="text-sm text-white/75 whitespace-pre-wrap leading-relaxed">{s.script}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1">{t("commentToVideo.visuals", { defaultValue: "Visuals" })}</p>
                <p className="text-sm text-white/60">{s.visualPlan}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1">{t("commentToVideo.cta", { defaultValue: "CTA" })}</p>
                <p className="text-sm text-white/60">{s.cta}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
