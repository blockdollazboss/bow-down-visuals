import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  X, Send, Share2, Copy, Download, Check, Loader2, PartyPopper,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiJson } from "@/lib/social-api";
import {
  renderBragCard,
  bragCardToBlob,
  bragCardDataUrl,
  downloadBragCard,
  canNativeShareFile,
} from "@/lib/milestone-brag-card";
import {
  bragCaption,
  feedPostBody,
  bragFileName,
  type MilestoneAchievement,
} from "@/lib/milestone-thresholds";

/* ─── BragModal — the one-click milestone brag ──────────────────────────────
   Creator hits a milestone → this modal renders their gold/black brag card
   (client-side canvas, no paid provider) and offers:
     • Post to BDV feed  (card uploaded → /api/posts with image attachment)
     • Share…            (native share sheet with the PNG — X/IG/TikTok)
     • Copy caption      (paste-ready caption for X/IG/TikTok)
     • Download PNG
   Every card bakes in "Made with Bow Down Visuals" + a signup CTA — that's
   the loop: milestone → brag → followers see the brand → new users. */

interface BragModalProps {
  achievement: MilestoneAchievement;
  creatorName: string;
  avatarUrl?: string | null;
  onClose: () => void;
}

type Phase = "rendering" | "ready" | "posting" | "posted" | "error";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export default function BragModal({ achievement, creatorName, avatarUrl, onClose }: BragModalProps) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState(() => bragCaption(achievement));
  const [phase, setPhase] = useState<Phase>("rendering");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase("rendering");
    setPreview(null);
    setCaption(bragCaption(achievement));
    setError(null);
    setNote(null);
    (async () => {
      try {
        const canvas = await renderBragCard({ achievement, creatorName, avatarUrl });
        if (cancelled) return;
        canvasRef.current = canvas;
        setPreview(bragCardDataUrl(canvas));
        setPhase("ready");
      } catch {
        if (!cancelled) {
          setError(t("milestones.bragRenderFailed"));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [achievement, creatorName, avatarUrl, t]);

  /* Esc closes. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function postToFeed() {
    const canvas = canvasRef.current;
    if (!canvas || phase === "posting" || phase === "posted") return;
    setPhase("posting");
    setError(null);
    setNote(null);
    try {
      const token = await getAccessToken().catch(() => null);
      const headers: Record<string, string> = { "Content-Type": "image/png" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      /* 1 — upload the card so the feed post can attach it as an image. */
      const blob = await bragCardToBlob(canvas);
      const up = await fetch("/api/milestones/brag-card", {
        method: "POST",
        headers,
        body: blob,
      });
      const upData = (await up.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!up.ok || !upData.url) throw new Error(upData.message ?? t("milestones.bragUploadFailed"));
      /* 2 — post to the BDV feed with the card attached. Free. */
      await apiJson(getAccessToken, "/api/posts", {
        method: "POST",
        body: JSON.stringify({
          body: feedPostBody(achievement).slice(0, 500) || caption.slice(0, 500),
          media_urls: [{ kind: "image", url: upData.url }],
          kind: "post",
          audience: "public",
        }),
      });
      setPhase("posted");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("milestones.bragPostFailed"));
      setPhase("ready");
    }
  }

  async function nativeShare() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setError(null);
    setNote(null);
    try {
      const blob = await bragCardToBlob(canvas);
      const file = new File([blob], bragFileName(achievement), { type: "image/png" });
      if (canNativeShareFile(file)) {
        await navigator.share({ files: [file], title: t("milestones.bragShareTitle"), text: caption });
      } else {
        /* Desktop fallback: caption on the clipboard + PNG downloaded so it
           can be attached manually on X/IG/TikTok. */
        const ok = await copyText(caption);
        await downloadBragCard(canvas, bragFileName(achievement));
        setCopied(ok);
        setNote(t("milestones.bragDesktopFallback"));
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return; /* user dismissed the sheet */
      setError(e instanceof Error ? e.message : t("milestones.bragShareFailed"));
    }
  }

  async function copyCaption() {
    const ok = await copyText(caption);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2000);
  }

  async function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    await downloadBragCard(canvas, bragFileName(achievement));
    setNote(t("milestones.bragDownloaded"));
  }

  const busy = phase === "rendering" || phase === "posting";

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("milestones.bragTitle")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-primary/30 bg-[#0d0d0d] shadow-[0_0_80px_rgba(212,175,55,0.15)]">
        {/* header */}
        <div className="flex items-start justify-between gap-3 p-5 pb-0">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-2xl" aria-hidden="true">
              <PartyPopper className="h-5 w-5 text-primary" />
            </span>
            <div>
              <h2 className="text-lg font-black text-white">{t("milestones.bragTitle")}</h2>
              <p className="text-xs text-white/50">
                {t("milestones.bragHeadline", { headline: achievement.headline })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("milestones.bragClose")}
            className="rounded-full p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* card preview */}
        <div className="p-5">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
            {phase === "rendering" || !preview ? (
              <div className="flex aspect-square items-center justify-center gap-2 text-sm text-white/50">
                <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
                {t("milestones.bragRendering")}
              </div>
            ) : (
              <img src={preview} alt={t("milestones.bragAlt", { headline: achievement.headline })} className="aspect-square w-full object-cover" />
            )}
          </div>

          {/* caption */}
          <label htmlFor="brag-caption" className="mt-4 block text-xs font-bold uppercase tracking-widest text-white/40">
            {t("milestones.bragCaptionLabel")}
          </label>
          <textarea
            id="brag-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 2000))}
            rows={5}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
          />

          {error && (
            <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-200" role="alert">
              {error}
            </p>
          )}
          {note && !error && (
            <p className="mt-3 rounded-xl border border-primary/25 bg-primary/[0.07] px-4 py-2.5 text-sm text-white/75" role="status">
              {note}
            </p>
          )}
          {phase === "posted" && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5">
              <p className="flex items-center gap-2 text-sm text-emerald-200">
                <Check className="h-4 w-4" aria-hidden="true" />
                {t("milestones.bragPosted")}
              </p>
              <a href="/home" className="text-sm font-bold text-emerald-300 underline underline-offset-2 hover:text-emerald-200">
                {t("milestones.bragViewFeed")}
              </a>
            </div>
          )}

          {/* actions */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              onClick={() => void postToFeed()}
              disabled={busy || phase === "posted"}
              className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "posting" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : phase === "posted" ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              {phase === "posting"
                ? t("milestones.bragPosting")
                : phase === "posted"
                  ? t("milestones.bragPostedShort")
                  : t("milestones.bragPostToFeed")}
            </button>
            <button
              onClick={() => void nativeShare()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Share2 className="h-4 w-4" aria-hidden="true" />
              {t("milestones.bragShare")}
            </button>
            <button
              onClick={() => void copyCaption()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:border-primary/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? t("milestones.bragCopied") : t("milestones.bragCopyCaption")}
            </button>
            <button
              onClick={() => void download()}
              disabled={busy}
              className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:border-primary/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("milestones.bragDownload")}
            </button>
          </div>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-white/35">
            {t("milestones.bragFootnote")}
          </p>
        </div>
      </div>
    </div>
  );
}
