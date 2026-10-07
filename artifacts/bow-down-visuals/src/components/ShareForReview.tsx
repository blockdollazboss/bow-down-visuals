import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Link2, Loader2, Check, Copy, X, Eye, EyeOff, MessageSquare,
  Clock, PencilLine, BadgeCheck, Send,
} from "lucide-react";

/* ─── Client review links (CapCut parity) ────────────────────────────────────
 * ShareForReviewButton: "Share for review" → inline panel (expiry, optional
 * password) → copyable /review/:token link. FREE — collaboration growth loop.
 * ReviewFeedbackBadge: creator inbox surfaced on the clip/project card —
 * "N new comments", status pills, and a feedback modal whose timestamp chips
 * seek the preview player and deep-link into the video editor at that second.
 */

export function formatReviewTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = h > 0 ? String(m % 60).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s % 60).padStart(2, "0")}`;
}

interface ShareForReviewButtonProps {
  videoUrl: string;
  title?: string;
  sourceType?: "clip" | "project_export" | "other";
  sourceId?: string | null;
}

export function ShareForReviewButton({ videoUrl, title, sourceType = "other", sourceId }: ShareForReviewButtonProps) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [linkTitle, setLinkTitle] = useState(title ?? "");
  const [expiry, setExpiry] = useState("14");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    if (!linkTitle.trim()) {
      toast({ title: t("review.titleRequired"), variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/review-links", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          videoUrl,
          title: linkTitle.trim(),
          sourceType,
          sourceId: sourceId ?? null,
          expiresInDays: expiry === "never" ? null : Number(expiry),
          password: password.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("review.createFailed"));
      setCreatedUrl(`${window.location.origin}${data.url}`);
      toast({ title: t("review.linkCreated") });
    } catch (err) {
      toast({ title: t("review.createFailed"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  function copyLink() {
    if (!createdUrl) return;
    navigator.clipboard.writeText(createdUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold text-primary border border-primary/25 bg-primary/5 hover:bg-primary/10 hover:border-primary/40 transition-colors"
      >
        <Link2 className="h-3.5 w-3.5" />
        {t("review.shareForReview")}
      </button>
      {open && (
        <div className="mt-3 rounded-xl border border-[#e8c86a]/25 bg-black/70 p-4 space-y-3 shadow-[0_0_24px_rgba(232,200,106,0.08)]">
          {!createdUrl ? (
            <>
              <div>
                <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">{t("review.linkTitle")}</label>
                <input
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder={t("review.linkTitlePlaceholder")}
                  maxLength={120}
                  className="mt-1 w-full rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#e8c86a]/50 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">{t("review.expires")}</label>
                  <select
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className="mt-1 w-full rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-white focus:border-[#e8c86a]/50 focus:outline-none [&>option]:bg-black"
                  >
                    <option value="7">{t("review.expiry7")}</option>
                    <option value="14">{t("review.expiry14")}</option>
                    <option value="30">{t("review.expiry30")}</option>
                    <option value="90">{t("review.expiry90")}</option>
                    <option value="never">{t("review.expiryNever")}</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
                    {t("review.password")} <span className="text-white/25 normal-case">({t("review.optional")})</span>
                  </label>
                  <div className="relative mt-1">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("review.passwordPlaceholder")}
                      maxLength={64}
                      className="w-full rounded-lg bg-white/[0.05] border border-white/10 pl-3 pr-9 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#e8c86a]/50 focus:outline-none"
                    />
                    <button
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70"
                      aria-label={showPassword ? t("review.hidePassword") : t("review.showPassword")}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={creating}
                className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 text-xs h-9 font-bold"
              >
                {creating ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> {t("review.creating")}</> : t("review.createLinkFree")}
              </Button>
              <p className="text-[11px] text-white/30 text-center">{t("review.freeHint")}</p>
            </>
          ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-green-400">
                <Check className="h-4 w-4" /> {t("review.linkReady")}
              </p>
              <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2">
                <p className="flex-1 truncate text-xs text-[#e8c86a] font-mono">{createdUrl}</p>
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1 text-[11px] font-bold text-white/60 hover:text-[#e8c86a] transition-colors shrink-0"
                >
                  {copied ? <><Check className="h-3.5 w-3.5 text-green-400" /> {t("review.copied")}</> : <><Copy className="h-3.5 w-3.5" /> {t("review.copy")}</>}
                </button>
              </div>
              <p className="text-[11px] text-white/35 leading-relaxed">{t("review.shareHint")}</p>
              <button
                onClick={() => { setCreatedUrl(null); setPassword(""); }}
                className="text-[11px] text-white/40 hover:text-white/70 underline underline-offset-2"
              >
                {t("review.createAnother")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Creator feedback inbox ───────────────────────────────────────────────── */

interface ReviewComment {
  id: string;
  name: string;
  timestampSec: number;
  text: string;
  createdAt: string | null;
}

interface ReviewLinkSummary {
  id: string;
  title: string;
  status: string;
  expiresAt: string | null;
  createdAt: string | null;
  commentCount: number;
  newCommentCount: number;
  sourceType: string;
  sourceId: string | null;
  latestComments: ReviewComment[];
}

interface ReviewFeedbackBadgeProps {
  videoUrl: string;
  /** Rotation-proof lookup: matches the link's (source_type, source_id). */
  sourceType?: "clip" | "project_export" | "other";
  sourceId?: string | null;
  /** Project id for "Open in editor at timestamp" deep links (video-editor?project=&t=). */
  projectId?: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  open: "text-white/50 border-white/15 bg-white/[0.04]",
  changes_requested: "text-red-400 border-red-500/30 bg-red-500/10",
  approved: "text-green-400 border-green-500/30 bg-green-500/10",
  closed: "text-white/30 border-white/10 bg-white/[0.02]",
};

export function ReviewFeedbackBadge({ videoUrl, sourceType, sourceId, projectId }: ReviewFeedbackBadgeProps) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [links, setLinks] = useState<ReviewLinkSummary[] | null>(null);
  const [modalLink, setModalLink] = useState<ReviewLinkSummary | null>(null);
  const [notifying, setNotifying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const qs = sourceType && sourceId
          ? `sourceType=${encodeURIComponent(sourceType)}&sourceId=${encodeURIComponent(sourceId)}`
          : `videoUrl=${encodeURIComponent(videoUrl)}`;
        const res = await fetch(`/api/review-links/mine?${qs}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!res.ok) return;
        const data = await res.json() as { links: ReviewLinkSummary[] };
        if (!cancelled) setLinks(data.links ?? []);
      } catch { /* feedback badge is non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [videoUrl, sourceType, sourceId, getAccessToken]);

  if (!links || links.length === 0) return null;
  const link = links[0]!;
  const totalNew = links.reduce((n, l) => n + l.newCommentCount, 0);

  function seekTo(sec: number) {
    const v = videoRef.current;
    if (v) {
      v.currentTime = Math.max(0, sec);
      v.play().catch(() => {});
    }
  }

  async function markSeen(linkId: string) {
    try {
      const token = await getAccessToken();
      await fetch(`/api/review-links/${linkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ action: "mark_seen" }),
      });
      setLinks((prev) => prev?.map((l) => l.id === linkId ? { ...l, newCommentCount: 0 } : l) ?? null);
      setModalLink((prev) => prev && prev.id === linkId ? { ...prev, newCommentCount: 0 } : prev);
    } catch { /* non-critical */ }
  }

  /* Notify reviewer: mint a fresh link (old URL is invalidated) and copy it,
     so the client always opens the latest cut. */
  async function notifyReviewer() {
    if (!modalLink || notifying) return;
    setNotifying(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/review-links/${modalLink.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ action: "regenerate" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || t("review.notifyFailed"));
      const fullUrl = `${window.location.origin}${data.url}`;
      await navigator.clipboard.writeText(fullUrl).catch(() => {});
      toast({ title: t("review.notifyCopied"), description: t("review.notifyCopiedHint") });
    } catch (err) {
      toast({ title: t("review.notifyFailed"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setNotifying(false);
    }
  }

  const statusKey = `review.status_${link.status}` as const;

  return (
    <>
      <button
        onClick={() => { setModalLink(link); if (link.newCommentCount > 0) markSeen(link.id); }}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold border border-[#e8c86a]/30 bg-[#e8c86a]/[0.07] text-[#e8c86a] hover:bg-[#e8c86a]/[0.14] transition-colors"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {totalNew > 0
          ? t("review.newComments", { count: totalNew })
          : t("review.commentsCount", { count: link.commentCount })}
        <span className={`ml-1 rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${STATUS_STYLE[link.status] ?? STATUS_STYLE.open}`}>
          {t(statusKey)}
        </span>
      </button>

      {modalLink && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setModalLink(null)} />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#e8c86a]/25 bg-[#0d0d0d] shadow-[0_0_60px_rgba(232,200,106,0.12)]">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.07] bg-[#0d0d0d]/95 backdrop-blur">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e8c86a]">{t("review.clientFeedback")}</p>
                <h3 className="text-base font-black text-white truncate">{modalLink.title}</h3>
              </div>
              <button
                onClick={() => setModalLink(null)}
                className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                aria-label={t("review.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Preview player — timestamp chips seek here */}
              <div className="rounded-xl overflow-hidden border border-white/10 bg-black">
                <video ref={videoRef} src={videoUrl} controls playsInline className="w-full max-h-72 object-contain" />
              </div>

              {/* Notify reviewer — fresh link for the latest cut */}
              <button
                onClick={notifyReviewer}
                disabled={notifying}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold text-black bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] hover:brightness-110 transition-all disabled:opacity-60"
              >
                {notifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t("review.notifyReviewer")}
              </button>
              <p className="text-[11px] text-white/30 text-center -mt-3">{t("review.notifyHint")}</p>

              {/* Comments */}
              {modalLink.latestComments.length === 0 ? (
                <p className="text-center text-sm text-white/35 py-6">{t("review.noCommentsYet")}</p>
              ) : (
                <div className="space-y-3">
                  {modalLink.latestComments.map((c) => (
                    <div key={c.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="h-7 w-7 rounded-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black text-xs font-black flex items-center justify-center shrink-0">
                            {(c.name || "?").charAt(0).toUpperCase()}
                          </span>
                          <span className="text-xs font-bold text-white truncate">{c.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => seekTo(c.timestampSec)}
                            className="flex items-center gap-1 rounded-full border border-[#e8c86a]/40 bg-[#e8c86a]/10 px-2 py-0.5 text-[11px] font-bold text-[#e8c86a] hover:bg-[#e8c86a]/20 transition-colors"
                            title={t("review.seekTo")}
                          >
                            <Clock className="h-3 w-3" /> {formatReviewTime(c.timestampSec)}
                          </button>
                          {projectId && (
                            <a
                              href={`/video-editor?project=${encodeURIComponent(projectId)}&t=${Math.floor(c.timestampSec)}`}
                              className="flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[11px] font-bold text-white/60 hover:text-white hover:border-white/30 transition-colors"
                              title={t("review.openInEditorAt")}
                            >
                              <PencilLine className="h-3 w-3" /> {t("review.editAt")}
                            </a>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-white/75 leading-relaxed whitespace-pre-wrap">{c.text}</p>
                    </div>
                  ))}
                </div>
              )}

              <p className="flex items-center gap-1.5 text-[11px] text-white/30">
                <BadgeCheck className="h-3.5 w-3.5 text-[#e8c86a]/60" />
                {t("review.manageHint")}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
