import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  Loader2, Lock, Clock, Send, CheckCircle2, AlertCircle, XCircle,
  Eye, EyeOff, Trash2, PencilLine, ShieldCheck,
  Sparkles, MessageSquare,
} from "lucide-react";
import { formatReviewTime } from "@/components/ShareForReview";

/* ─── Public client review page — /review/:token ─────────────────────────────
 * Seen by CLIENTS: jaw-droppingly premium gold/black, mobile-first.
 * No login required. Rate-limited server-side.
 * Virality: "Made with Bow Down Visuals" badge carries the creator's
 * referral code (?ref=CODE) — every client view is a potential signup that
 * earns the creator 25% revenue share for 90 days.
 */

interface ReviewComment {
  id: string;
  name: string;
  timestampSec: number;
  text: string;
  createdAt: string | null;
}

interface ReviewPayload {
  locked: boolean;
  hasPassword?: boolean;
  title?: string;
  videoUrl?: string;
  status?: string;
  expiresAt?: string | null;
  comments?: ReviewComment[];
  referralCode?: string | null;
}

interface ManageInfo {
  isOwner: boolean;
  id: string;
  title: string;
  status: string;
  sourceType: string;
  sourceId: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

type PageState =
  | { kind: "loading" }
  | { kind: "locked" }
  | { kind: "ready"; payload: ReviewPayload }
  | { kind: "error"; message: string };

export default function ReviewPage() {
  const { t } = useTranslation();
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  usePageTitle(t("review.pageTitle"), t("review.pageDescription"));

  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [manage, setManage] = useState<ManageInfo | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/review-links/${encodeURIComponent(token)}`);
      const data = (await res.json().catch(() => ({}))) as ReviewPayload & { error?: string };
      if (!res.ok) {
        setState({ kind: "error", message: data.error || t("review.loadFailed") });
        return;
      }
      if (data.locked) {
        setState({ kind: "locked" });
        return;
      }
      setState({ kind: "ready", payload: data });
    } catch {
      setState({ kind: "error", message: t("review.loadFailed") });
    }
  }, [token, t]);

  useEffect(() => { load(); }, [load]);

  /* Owner check — manage actions require login as the link owner (server-enforced). */
  useEffect(() => {
    if (!user) { setManage(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const at = await getAccessToken();
        const res = await fetch(`/api/review-links/${encodeURIComponent(token)}/manage`, {
          headers: { Authorization: `Bearer ${at ?? ""}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as ManageInfo;
        if (!cancelled && data.isOwner) setManage(data);
      } catch { /* not the owner or offline — page stays public */ }
    })();
    return () => { cancelled = true; };
  }, [user, token, getAccessToken]);

  async function handleUnlock() {
    if (!password) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const res = await fetch(`/api/review-links/${encodeURIComponent(token)}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as ReviewPayload & { error?: string };
      if (!res.ok) {
        setUnlockError(data.error || t("review.wrongPassword"));
        return;
      }
      setState({ kind: "ready", payload: data });
    } catch {
      setUnlockError(t("review.loadFailed"));
    } finally {
      setUnlocking(false);
    }
  }

  function seekTo(sec: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, sec);
    v.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function handlePost() {
    if (state.kind !== "ready") return;
    if (!name.trim() || !text.trim()) {
      toast({ title: t("review.commentInvalid"), variant: "destructive" });
      return;
    }
    setPosting(true);
    try {
      const res = await fetch(`/api/review-links/${encodeURIComponent(token)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim().slice(0, 80),
          timestampSec: Math.round(currentTime * 10) / 10,
          text: text.trim().slice(0, 1000),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { comment?: ReviewComment; error?: string };
      if (!res.ok || !data.comment) throw new Error(data.error || t("review.commentFailed"));
      setState({
        kind: "ready",
        payload: { ...state.payload, comments: [...(state.payload.comments ?? []), data.comment] },
      });
      setText("");
      toast({ title: t("review.commentPosted") });
    } catch (err) {
      toast({ title: t("review.commentFailed"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setPosting(false);
    }
  }

  async function manageAction(action: string, extra: Record<string, unknown> = {}) {
    if (!manage) return;
    setActing(action);
    try {
      const at = await getAccessToken();
      const res = await fetch(`/api/review-links/${manage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${at ?? ""}` },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("review.actionFailed"));
      if (action === "set_status" && typeof extra.status === "string" && state.kind === "ready") {
        setManage({ ...manage, status: extra.status });
        setState({ kind: "ready", payload: { ...state.payload, status: extra.status } });
      }
      if ((action === "hide_comment" || action === "delete_comment") && state.kind === "ready") {
        const cid = extra.commentId as string;
        const comments = (state.payload.comments ?? [])
          .map((c) => (c.id === cid && action === "hide_comment" ? null : c))
          .filter((c): c is ReviewComment => c !== null)
          .filter((c) => !(action === "delete_comment" && c.id === cid));
        setState({ kind: "ready", payload: { ...state.payload, comments } });
      }
      toast({ title: t("review.actionDone") });
    } catch (err) {
      toast({ title: t("review.actionFailed"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setActing(null);
    }
  }

  const referralHref = (() => {
    if (state.kind !== "ready") return "/";
    const code = state.payload.referralCode;
    return code ? `/?ref=${encodeURIComponent(code)}` : "/";
  })();

  return (
    <div className="min-h-screen bg-black text-white relative overflow-x-hidden">
      {/* Ambient gold glow */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[42rem] max-w-full rounded-full bg-[#e8c86a]/[0.07] blur-[120px]" />
        <div className="absolute bottom-0 left-0 h-72 w-72 rounded-full bg-[#e8c86a]/[0.04] blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pb-16">
        {/* ── Brand bar ── */}
        <header className="flex items-center justify-between py-5 border-b border-white/[0.07]">
          <div className="flex items-center gap-2.5">
            <span className="text-lg font-black tracking-tight bg-gradient-to-b from-[#f4dd9a] via-[#e8c86a] to-[#b08d3e] bg-clip-text text-transparent">
              BOW DOWN VISUALS
            </span>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-[#e8c86a]/40 bg-[#e8c86a]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#e8c86a]">
            <Sparkles className="h-3.5 w-3.5" /> {t("review.clientReview")}
          </span>
        </header>

        {state.kind === "loading" && (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-[#e8c86a]" />
            <p className="text-sm text-white/40">{t("review.loading")}</p>
          </div>
        )}

        {state.kind === "error" && (
          <div className="mx-auto max-w-md mt-20 rounded-2xl border border-[#e8c86a]/25 bg-[#0d0d0d] p-8 text-center shadow-[0_0_60px_rgba(232,200,106,0.08)]">
            <XCircle className="h-12 w-12 mx-auto text-[#e8c86a]/70" />
            <h1 className="mt-4 text-xl font-black">{t("review.unavailable")}</h1>
            <p className="mt-2 text-sm text-white/50 leading-relaxed">{state.message}</p>
            <a href="/" className="mt-6 inline-block rounded-xl bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] px-6 py-2.5 text-sm font-bold text-black hover:brightness-110 transition-all">
              {t("review.backHome")}
            </a>
          </div>
        )}

        {state.kind === "locked" && (
          <div className="mx-auto max-w-md mt-20 rounded-2xl border border-[#e8c86a]/25 bg-[#0d0d0d] p-8 shadow-[0_0_60px_rgba(232,200,106,0.08)]">
            <Lock className="h-12 w-12 mx-auto text-[#e8c86a]" />
            <h1 className="mt-4 text-xl font-black text-center">{t("review.passwordRequired")}</h1>
            <p className="mt-2 text-sm text-white/50 text-center leading-relaxed">{t("review.passwordHint")}</p>
            <div className="relative mt-6">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleUnlock(); }}
                placeholder={t("review.enterPassword")}
                maxLength={64}
                autoFocus
                className="w-full rounded-xl bg-white/[0.05] border border-white/10 pl-4 pr-11 py-3 text-sm text-white placeholder:text-white/25 focus:border-[#e8c86a]/60 focus:outline-none"
              />
              <button
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70"
                aria-label={showPassword ? t("review.hidePassword") : t("review.showPassword")}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {unlockError && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-red-400"><AlertCircle className="h-3.5 w-3.5" /> {unlockError}</p>
            )}
            <button
              onClick={handleUnlock}
              disabled={unlocking || !password}
              className="mt-4 w-full rounded-xl bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] py-3 text-sm font-bold text-black hover:brightness-110 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {unlocking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {t("review.unlock")}
            </button>
          </div>
        )}

        {state.kind === "ready" && (
          <main className="mt-6">
            {/* Status banner */}
            {state.payload.status === "changes_requested" && (
              <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
                <p className="text-sm font-bold text-red-300">{t("review.bannerChangesRequested")}</p>
              </div>
            )}
            {state.payload.status === "approved" && (
              <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                <p className="text-sm font-bold text-green-300">{t("review.bannerApproved")}</p>
              </div>
            )}

            {/* Creator controls (owner only, server-verified) */}
            {manage && (
              <div className="mb-5 rounded-xl border border-[#e8c86a]/30 bg-[#e8c86a]/[0.05] px-4 py-3">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#e8c86a] mb-2.5">
                  <ShieldCheck className="h-3.5 w-3.5" /> {t("review.creatorControls")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => manageAction("set_status", { status: "approved" })}
                    disabled={acting !== null}
                    className="flex items-center gap-1.5 rounded-lg bg-green-500/15 border border-green-500/40 px-3 py-1.5 text-xs font-bold text-green-300 hover:bg-green-500/25 transition-colors disabled:opacity-50"
                  >
                    {acting === "set_status" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {t("review.approveVideo")}
                  </button>
                  <button
                    onClick={() => manageAction("set_status", { status: "changes_requested" })}
                    disabled={acting !== null}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
                  >
                    <AlertCircle className="h-3.5 w-3.5" />
                    {t("review.requestChanges")}
                  </button>
                  <button
                    onClick={() => manageAction("set_status", { status: "closed" })}
                    disabled={acting !== null}
                    className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/15 px-3 py-1.5 text-xs font-bold text-white/60 hover:text-white hover:border-white/30 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    {t("review.closeLink")}
                  </button>
                </div>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
              {/* ── Player column ── */}
              <div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight">{state.payload.title}</h1>
                <div className="mt-3 rounded-2xl overflow-hidden border border-[#e8c86a]/20 bg-black shadow-[0_0_80px_rgba(232,200,106,0.10)]">
                  <video
                    ref={videoRef}
                    src={state.payload.videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    className="w-full aspect-video object-contain bg-black"
                  />
                </div>
                <p className="mt-3 text-xs text-white/35 leading-relaxed">{t("review.watchHint")}</p>
              </div>

              {/* ── Comments column ── */}
              <aside className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#0d0d0d]/80 overflow-hidden lg:max-h-[78vh]">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.07]">
                  <MessageSquare className="h-4 w-4 text-[#e8c86a]" />
                  <h2 className="text-sm font-black uppercase tracking-[0.14em]">
                    {t("review.feedback")} <span className="text-[#e8c86a]">({(state.payload.comments ?? []).length})</span>
                  </h2>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 lg:min-h-[200px]">
                  {(state.payload.comments ?? []).length === 0 && (
                    <p className="text-center text-sm text-white/30 py-8">{t("review.beFirst")}</p>
                  )}
                  {(state.payload.comments ?? []).map((c) => (
                    <article key={c.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="h-7 w-7 rounded-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black text-xs font-black flex items-center justify-center shrink-0">
                            {(c.name || "?").charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate">{c.name}</p>
                            <p className="text-[10px] text-white/30">{timeAgo(c.createdAt)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => seekTo(c.timestampSec)}
                            className="flex items-center gap-1 rounded-full border border-[#e8c86a]/40 bg-[#e8c86a]/10 px-2.5 py-1 text-[11px] font-bold text-[#e8c86a] hover:bg-[#e8c86a]/20 transition-colors"
                            title={t("review.seekTo")}
                          >
                            <Clock className="h-3 w-3" /> {formatReviewTime(c.timestampSec)}
                          </button>
                          {manage && (
                            <>
                              {manage.sourceType === "project_export" && manage.sourceId && (
                                <a
                                  href={`/video-editor?project=${encodeURIComponent(manage.sourceId)}&t=${Math.floor(c.timestampSec)}`}
                                  className="flex items-center justify-center h-7 w-7 rounded-full border border-white/15 text-white/50 hover:text-[#e8c86a] hover:border-[#e8c86a]/40 transition-colors"
                                  title={t("review.openInEditorAt")}
                                >
                                  <PencilLine className="h-3.5 w-3.5" />
                                </a>
                              )}
                              <button
                                onClick={() => manageAction("delete_comment", { commentId: c.id })}
                                disabled={acting !== null}
                                className="flex items-center justify-center h-7 w-7 rounded-full border border-white/15 text-white/50 hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-50"
                                title={t("review.deleteComment")}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-white/75 leading-relaxed whitespace-pre-wrap">{c.text}</p>
                    </article>
                  ))}
                </div>

                {/* Comment form */}
                <div className="border-t border-white/[0.07] p-4 space-y-3 bg-black/40">
                  <div className="flex items-center gap-2">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("review.yourName")}
                      maxLength={80}
                      className="w-1/2 rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#e8c86a]/50 focus:outline-none"
                    />
                    <span className="flex items-center gap-1 rounded-full border border-[#e8c86a]/40 bg-[#e8c86a]/10 px-2.5 py-1 text-[11px] font-bold text-[#e8c86a] whitespace-nowrap">
                      <Clock className="h-3 w-3" /> {formatReviewTime(currentTime)}
                    </span>
                  </div>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={t("review.commentPlaceholder", { time: formatReviewTime(currentTime) })}
                    maxLength={1000}
                    rows={3}
                    className="w-full rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#e8c86a]/50 focus:outline-none resize-none"
                  />
                  <button
                    onClick={handlePost}
                    disabled={posting}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] py-2.5 text-sm font-bold text-black hover:brightness-110 transition-all disabled:opacity-60"
                  >
                    {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {t("review.postAt", { time: formatReviewTime(currentTime) })}
                  </button>
                </div>
              </aside>
            </div>

            {/* ── Virality footer: Made with Bow Down Visuals + creator referral ── */}
            <footer className="mt-10 flex flex-col items-center gap-3 border-t border-white/[0.07] pt-6">
              <a
                href={referralHref}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2.5 rounded-full border border-[#e8c86a]/30 bg-gradient-to-b from-[#e8c86a]/[0.08] to-transparent px-5 py-2.5 hover:border-[#e8c86a]/60 hover:shadow-[0_0_30px_rgba(232,200,106,0.15)] transition-all"
              >
                <Sparkles className="h-4 w-4 text-[#e8c86a] group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold tracking-wide text-white/70 group-hover:text-white transition-colors">
                  {t("review.madeWith")} <span className="bg-gradient-to-b from-[#f4dd9a] via-[#e8c86a] to-[#b08d3e] bg-clip-text text-transparent font-black">BOW DOWN VISUALS</span>
                </span>
              </a>
              <p className="text-[11px] text-white/30 text-center max-w-sm leading-relaxed">{t("review.madeWithHint")}</p>
              <p className="flex items-center gap-1 text-[10px] text-white/20">
                <Lock className="h-3 w-3" /> {t("review.privateNote")}
              </p>
            </footer>
          </main>
        )}
      </div>
    </div>
  );
}
