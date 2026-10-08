import { useState, useEffect } from "react";
import {
  ShieldAlert, MessageSquareHeart, BarChart3, Star, Loader2, Sparkles,
  CheckCircle2, XCircle, AlertTriangle, Bell, Users,
  MessageCircleReply, Flame, Heart, Laugh, Briefcase, History, Trash2, Copy, Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import {
  MAX_COMMENTS,
  parseCommentLines,
  buildBatch,
  loadReplyHistory,
  saveReplyBatch,
  clearReplyHistory,
} from "@/lib/comment-replies";
import type { ToneKey, ReplyBatch } from "@/lib/comment-replies";
import { useTranslation } from "react-i18next";

/* ─── Thy Cheat Code's AI Community Manager ───────────────────────────────
   /community — audience management: AI moderation queue, smart reply drafts,
   sentiment dashboard, superfan radar. Every AI call costs credits;
   viewing/copying is free. Nothing is ever auto-deleted — flags are
   suggestions queued for human review. */

type TabKey = "moderate" | "replies" | "sentiment" | "superfans";

interface CommentInput {
  author: string;
  text: string;
}

interface FlaggedComment {
  index: number;
  author: string;
  text: string;
  verdict: "ok" | "review" | "remove";
  reasons: string[];
  severity: number;
}

interface SentimentReport {
  overall: string;
  score: number;
  themes?: { theme: string; sentiment: string; examples?: string[] }[];
  risks?: string[];
  wins?: string[];
}

interface Superfan {
  author: string;
  score: number;
  why: string;
  commentCount: number;
}

const TABS: { key: TabKey; label: string; icon: typeof ShieldAlert; cost: string }[] = [
  { key: "moderate", label: "Moderation", icon: ShieldAlert, cost: "1 VB / 50 comments" },
  { key: "replies", label: "Reply Drafts", icon: MessageSquareHeart, cost: "1 VB / batch" },
  { key: "sentiment", label: "Sentiment", icon: BarChart3, cost: "1 VB / report" },
  { key: "superfans", label: "Superfans", icon: Star, cost: "1 VB / scan" },
];

const SAMPLE_COMMENTS = `@sharkfan99: This song is a whole anthem, on repeat all day 🔥
@troll_xx: lol this is trash, delete ur account
@melody_m: The bridge gave me chills, when's the album dropping??
@promo_bot_247: CHECK MY PAGE for FREE followers!!! bit.ly/xyz
@dayone_dre: Been here since the first drop, proud of you bro`;

function parsePastedComments(raw: string): CommentInput[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 200)
    .map((line) => {
      const m = line.match(/^@?([^:]+):\s*(.+)$/);
      if (m) return { author: m[1].trim().slice(0, 100), text: m[2].trim().slice(0, 1000) };
      return { author: "fan", text: line.slice(0, 1000) };
    })
    .filter((c) => c.text.length > 0);
}

/* ─── Reply Drafts tab (merged from /comment-replies) ───────────────────────
   Paste 1-10 fan comments, pick a tone, add optional voice notes — GPT-6
   drafts an on-brand reply for each comment, engineered to boost
   engagement. POST /api/comment-replies at 1 credit per batch (registry:
   "/api/comment-replies" = 100 = 1 Visual Buc). Tone keys must stay in
   sync with the backend route's TONES enum. Feeds off the shared comment
   box above the tabs. */

interface RepliesTone {
  key: ToneKey;
  label: string;
  icon: LucideIcon;
  blurb: string;
}

const REPLY_CREDIT_COST = 1;

interface RepliesResponse {
  replies?: string[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

const replyInputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

function RepliesTab({ commentsText, onRestoreComments }: { commentsText: string; onRestoreComments: (text: string) => void }) {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const TONES: RepliesTone[] = [
    { key: "hype", label: t("commentReplies.toneHypeLabel"), icon: Flame, blurb: t("commentReplies.toneHypeBlurb") },
    { key: "grateful", label: t("commentReplies.toneGratefulLabel"), icon: Heart, blurb: t("commentReplies.toneGratefulBlurb") },
    { key: "playful", label: t("commentReplies.tonePlayfulLabel"), icon: Laugh, blurb: t("commentReplies.tonePlayfulBlurb") },
    { key: "professional", label: t("commentReplies.toneProfessionalLabel"), icon: Briefcase, blurb: t("commentReplies.toneProfessionalBlurb") },
  ];

  const [tone, setTone] = useState<ToneKey>("hype");
  const [voiceNotes, setVoiceNotes] = useState("");
  const [results, setResults] = useState<{ comments: string[]; replies: string[] } | null>(null);
  const [editedReplies, setEditedReplies] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [history, setHistory] = useState<ReplyBatch[]>([]);

  useEffect(() => {
    setHistory(loadReplyHistory());
  }, []);

  const comments = parseCommentLines(commentsText);
  const commentCount = comments.length;

  function saveBatch(cs: string[], replies: string[]) {
    setHistory((prev) => saveReplyBatch(prev, buildBatch(tone, cs, replies)));
  }

  async function generate() {
    if (loading || !user) return;
    if (comments.length === 0) {
      setError(t("commentReplies.errorNoComments"));
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setCopiedIdx(null);
    setCopiedAll(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/comment-replies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          comments,
          tone,
          voiceNotes: voiceNotes.trim(),
        }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as RepliesResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.replies) || data.replies.length !== comments.length) {
        throw new Error(data.message || data.error || t("commentReplies.errorGenerateFailed"));
      }
      setResults({ comments, replies: data.replies });
      setEditedReplies([...data.replies]);
      saveBatch(comments, data.replies);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("replies-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("commentReplies.errorGenerateFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* clipboard API unavailable (permissions / insecure context) */
      return false;
    }
  }

  async function copyOne(idx: number) {
    const ok = await copyText(editedReplies[idx] ?? "");
    if (ok) {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1600);
    } else {
      setError(t("commentReplies.errorCopyFailed"));
    }
  }

  async function copyAll() {
    const ok = await copyText(editedReplies.join("\n\n"));
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1600);
    } else {
      setError(t("commentReplies.errorCopyFailed"));
    }
  }

  function restoreBatch(batch: ReplyBatch) {
    onRestoreComments(batch.comments.join("\n"));
    setTone(batch.tone);
    setResults({ comments: batch.comments, replies: batch.replies });
    setEditedReplies([...batch.replies]);
    setCopiedIdx(null);
    setCopiedAll(false);
    setError(null);
    setOutOfCredits(false);
    setTimeout(() => {
      document.getElementById("replies-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  }

  function clearHistory() {
    setHistory([]);
    clearReplyHistory();
  }

  return (
    <div>
      {/* ── composer card ── */}
      <div className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <MessageCircleReply className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-xl font-bold">{t("commentReplies.draftTitle")}</h2>
            <p className="text-sm text-white/45">
              {t("commentReplies.costLine", { cost: REPLY_CREDIT_COST, max: MAX_COMMENTS })}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-white/40">
          {t("commentReplies.commentsLabel", { count: commentCount, max: MAX_COMMENTS })} — {t("community.repliesSharedBoxHint", { defaultValue: "uses the comment box above" })}
        </p>

        <p data-min-stars="2" className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
          {t("commentReplies.replyTone")}
        </p>
        <div data-min-stars="2" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {TONES.map((tn) => {
            const Icon = tn.icon;
            const selected = tn.key === tone;
            return (
              <button
                key={tn.key}
                type="button"
                onClick={() => setTone(tn.key)}
                aria-pressed={selected}
                className={`rounded-2xl border p-3.5 text-left transition ${
                  selected
                    ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                    : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                }`}
              >
                <Icon className={`mb-2 h-5 w-5 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
                <p className={`text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>{tn.label}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-white/35">{tn.blurb}</p>
              </button>
            );
          })}
        </div>

        <label
          htmlFor="voice-notes"
          data-min-stars="3"
          className="mt-8 mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40"
        >
          {t("commentReplies.voiceNotesLabel")} <span className="normal-case text-white/25">({t("commentReplies.optional")})</span>
        </label>
        <input
          id="voice-notes"
          type="text"
          data-min-stars="3"
          value={voiceNotes}
          onChange={(e) => setVoiceNotes(e.target.value)}
          maxLength={300}
          placeholder={t("commentReplies.voiceNotesPlaceholder")}
          className={replyInputClass}
        />

        {error && (
          <p className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={generate}
          disabled={loading || !user || commentCount === 0}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-base font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> {t("commentReplies.drafting")}
            </>
          ) : (
            <>
              <Sparkles className="h-5 w-5" aria-hidden="true" />
              {commentCount > 0
                ? t("commentReplies.draftReplies", { count: commentCount, cost: REPLY_CREDIT_COST })
                : t("commentReplies.draftRepliesZero", { cost: REPLY_CREDIT_COST })}
            </>
          )}
        </button>
        {!user && (
          <p className="mt-3 text-center text-sm text-white/40">
            {t("commentReplies.signInPrompt")}
          </p>
        )}
      </div>

      {outOfCredits && (
        <div className="mt-6">
          <OutOfCredits />
        </div>
      )}

      {/* ── results ── */}
      {results && (
        <div id="replies-results" className="mt-8 overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-xl font-bold">{t("commentReplies.yourReplies")}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={copyAll}
                className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary/20"
              >
                {copiedAll ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copiedAll ? t("commentReplies.copied") : t("commentReplies.copyAll")}
              </button>
              {/* Forward handoff — nothing dead-ends: keep the engagement
                  rolling by planning posts in the Scheduler. */}
              <Link href="/scheduler">
                <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-bold text-white/60 transition hover:border-primary/40 hover:text-primary cursor-pointer">
                  {t("community.replies.scheduleLink", { defaultValue: "Plan posts in Scheduler →" })}
                </span>
              </Link>
            </div>
          </div>
          <p className="mt-1 text-sm text-white/45">
            {t("commentReplies.editNote")}
          </p>

          <div className="mt-6 space-y-5">
            {results.comments.map((comment, i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/35">
                  {t("commentReplies.fanComment", { n: i + 1 })}
                </p>
                <p className="mt-1 text-sm text-white/70">“{comment}”</p>
                <div className="mt-3 flex items-start gap-2">
                  <textarea
                    value={editedReplies[i] ?? ""}
                    onChange={(e) =>
                      setEditedReplies((prev) => {
                        const next = [...prev];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                    rows={2}
                    aria-label={t("commentReplies.replyAria", { n: i + 1 })}
                    className={`${replyInputClass} min-h-[56px] flex-1 resize-y border-primary/20 bg-primary/[0.04]`}
                  />
                  <button
                    type="button"
                    onClick={() => copyOne(i)}
                    aria-label={t("commentReplies.copyReplyAria", { n: i + 1 })}
                    className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/60 transition hover:border-primary/50 hover:text-primary"
                  >
                    {copiedIdx === i ? (
                      <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── history ── */}
      {history.length > 0 && (
        <div data-min-stars="3" className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <History className="h-5 w-5 text-primary" aria-hidden="true" /> {t("commentReplies.pastBatches")}
            </h2>
            <button
              type="button"
              onClick={clearHistory}
              className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/50 transition hover:border-red-500/50 hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("commentReplies.clear")}
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {history.map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => restoreBatch(batch)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-left transition hover:border-primary/40"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-white/85">
                    {t("commentReplies.batchSummary", { count: batch.comments.length, tone: TONES.find((x) => x.key === batch.tone)?.label ?? batch.tone })}
                  </span>
                  <span className="block truncate text-xs text-white/35">
                    {t("commentReplies.batchSubline", { date: new Date(batch.at).toLocaleString(), preview: batch.comments[0]?.slice(0, 60) ?? "" })}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-bold text-primary">{t("commentReplies.restore")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CommunityManager() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const [tab, setTab] = useState<TabKey>(() => {
    try { return new URLSearchParams(window.location.search).get("tab") === "replies" ? "replies" : "moderate"; } catch { return "moderate"; }
  });
  const [paste, setPaste] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [flags, setFlags] = useState<FlaggedComment[]>([]);
  const [reviewed, setReviewed] = useState<string[]>([]); // "approved:<i>" / "removed:<i>"
  const [moderatedCount, setModeratedCount] = useState(0);

  const [sentiment, setSentiment] = useState<SentimentReport | null>(null);
  const [superfans, setSuperfans] = useState<Superfan[]>([]);

  const [alerts, setAlerts] = useState({ viral: true, prRisk: true, superfan: false });

  async function callApi(path: string, body: unknown) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (res.status === 402 || data.error === "out_of_credits") {
      setOutOfCredits(true);
      refreshProfile();
      return null;
    }
    if (!res.ok) throw new Error((data.error as string) || "Request failed — try again.");
    refreshProfile();
    return data;
  }

  function getComments(): CommentInput[] | null {
    const comments = parsePastedComments(paste);
    if (comments.length === 0) {
      setError(t("community.paste_some_comments_first_one_pe"));
      return null;
    }
    return comments;
  }

  async function runModerate() {
    const comments = getComments();
    if (!comments) return;
    setLoading(true); setError(null); setOutOfCredits(false);
    try {
      const data = await callApi("/api/community/moderate", { comments });
      if (!data) return;
      setFlags((data.flags as FlaggedComment[]) ?? []);
      setModeratedCount((data.reviewed as number) ?? comments.length);
      setReviewed([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Moderation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runSentiment() {
    const comments = getComments();
    if (!comments) return;
    setLoading(true); setError(null); setOutOfCredits(false);
    try {
      const data = await callApi("/api/community/sentiment", { comments });
      if (!data) return;
      setSentiment((data.report as SentimentReport) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sentiment analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runSuperfans() {
    const comments = getComments();
    if (!comments) return;
    setLoading(true); setError(null); setOutOfCredits(false);
    try {
      const data = await callApi("/api/community/superfans", { comments });
      if (!data) return;
      setSuperfans((data.superfans as Superfan[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Superfan scan failed.");
    } finally {
      setLoading(false);
    }
  }

  const verdictBadge = (v: FlaggedComment["verdict"]) =>
    v === "remove"
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : "border-amber-500/40 bg-amber-500/10 text-amber-300";

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-28">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-amber-300">
            <Users className="h-3.5 w-3.5" />{t("community.ai_community_manager")}</div>
          <h1 className="text-4xl font-black tracking-tight md:text-5xl">{t("community.your_audience")}<span className="bg-gradient-to-r from-amber-300 to-yellow-500 bg-clip-text text-transparent">{t("community.managed")}</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-zinc-400">{t("community.ai_moderation_queue_smart_reply")}</p>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap justify-center gap-2">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              onClick={() => { setTab(tb.key); setError(null); }}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                tab === tb.key
                  ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              <tb.icon className="h-4 w-4" />
              {t(`community.tabs.${tb.key}.label`, { defaultValue: tb.label })}
              <span className="text-[10px] font-normal opacity-70">{t(`community.tabs.${tb.key}.cost`, { defaultValue: tb.cost })}</span>
            </button>
          ))}
        </div>

        {/* Comment input (shared) */}
        <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-semibold text-zinc-200">{t("community.paste_comments")}</label>
            <button
              onClick={() => setPaste(SAMPLE_COMMENTS)}
              className="text-xs text-amber-300/80 hover:text-amber-200"
            >{t("community.load_sample")}</button>
          </div>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={5}
            placeholder={"One per line — @fan: loved this!\nPaste up to 200 comments."}
            className="w-full rounded-xl border border-zinc-800 bg-black/60 p-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400/50 focus:outline-none"
          />
          <p className="mt-2 text-xs text-zinc-500">
            {parsePastedComments(paste).length} comments ready · copying and viewing is always free
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
        )}
        {outOfCredits && (
          <div className="mx-auto mb-4 max-w-md"><OutOfCredits /></div>
        )}

        {/* ── MODERATION ── */}
        {tab === "moderate" && (
          <div>
            <button
              onClick={runModerate}
              disabled={loading}
              className="mb-5 flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Moderate comments · 1 VB / 50
            </button>
            {moderatedCount > 0 && (
              <p className="mb-3 text-sm text-zinc-400">{t("community.reviewed")}<span className="font-bold text-white">{moderatedCount}</span> ·{" "}
                <span className="font-bold text-amber-300">{flags.length}</span>{t("community.flagged_for_your_review")}</p>
            )}
            {flags.length === 0 && moderatedCount > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
                <CheckCircle2 className="h-5 w-5" />{t("community.clean_nothing_needs_your_attenti")}</div>
            )}
            <div className="space-y-3">
              {flags.map((f) => {
                const key = `${f.verdict}:${f.index}`;
                const done = reviewed.includes(key);
                return (
                  <div key={`${f.index}-${f.verdict}`} className={`rounded-xl border p-4 ${verdictBadge(f.verdict)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">@{f.author}</p>
                        <p className="mt-1 text-sm text-zinc-300">“{f.text}”</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {f.reasons.map((r) => (
                            <span key={r} className="rounded-full bg-black/40 px-2 py-0.5 text-[11px]">{r}</span>
                          ))}
                          <span className="rounded-full bg-black/40 px-2 py-0.5 text-[11px]">severity {f.severity}</span>
                        </div>
                      </div>
                      {!done ? (
                        <div className="flex shrink-0 gap-2">
                          <button
                            onClick={() => setReviewed((r) => [...r, `ok:${f.index}`])}
                            className="rounded-full border border-emerald-500/40 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10"
                          >{t("community.approve")}</button>
                          <button
                            onClick={() => setReviewed((r) => [...r, `remove:${f.index}`])}
                            className="rounded-full border border-red-500/40 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/10"
                          >{t("community.remove")}</button>
                        </div>
                      ) : (
                        <span className="shrink-0 text-xs text-zinc-400">
                          {reviewed.includes(`remove:${f.index}`) ? "Marked for removal ✓" : "Approved ✓"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── REPLY DRAFTS (merged from /comment-replies) ── */}
        {tab === "replies" && (
          <RepliesTab commentsText={paste} onRestoreComments={setPaste} />
        )}

        {/* ── SENTIMENT ── */}
        {tab === "sentiment" && (
          <div>
            <button
              onClick={runSentiment}
              disabled={loading}
              className="mb-5 flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Run sentiment report · 1 VB
            </button>
            {sentiment && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-zinc-300">{t("community.overall_sentiment")}</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
                      sentiment.overall === "positive" ? "bg-emerald-500/15 text-emerald-300"
                      : sentiment.overall === "negative" ? "bg-red-500/15 text-red-300"
                      : "bg-amber-500/15 text-amber-300"
                    }`}>{sentiment.overall}</span>
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, sentiment.score))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-right text-2xl font-black text-amber-300">{sentiment.score}<span className="text-sm text-zinc-500">/100</span></p>
                </div>
                {sentiment.themes && sentiment.themes.length > 0 && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
                    <h3 className="mb-3 text-sm font-bold text-zinc-200">{t("community.what_fans_are_saying")}</h3>
                    <div className="space-y-2">
                      {sentiment.themes.map((th, i) => (
                        <div key={i} className="rounded-xl bg-black/40 p-3">
                          <p className="text-sm font-semibold text-white">{th.theme}
                            <span className="ml-2 text-xs font-normal text-zinc-400">{th.sentiment}</span>
                          </p>
                          {th.examples?.map((e, j) => (
                            <p key={j} className="mt-1 text-xs italic text-zinc-400">“{e}”</p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  {sentiment.wins && sentiment.wins.length > 0 && (
                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                      <h3 className="mb-2 text-sm font-bold text-emerald-300">{t("community.wins")}</h3>
                      <ul className="space-y-1 text-sm text-zinc-300">
                        {sentiment.wins.map((w, i) => <li key={i}>· {w}</li>)}
                      </ul>
                    </div>
                  )}
                  {sentiment.risks && sentiment.risks.length > 0 && (
                    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
                      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-red-300">
                        <AlertTriangle className="h-4 w-4" />{t("community.watch_out")}</h3>
                      <ul className="space-y-1 text-sm text-zinc-300">
                        {sentiment.risks.map((r, i) => <li key={i}>· {r}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SUPERFANS ── */}
        {tab === "superfans" && (
          <div>
            <button
              onClick={runSuperfans}
              disabled={loading}
              className="mb-5 flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Scan for superfans · 1 VB
            </button>
            <div className="grid gap-3 md:grid-cols-2">
              {superfans.map((s, i) => (
                <div key={s.author} className="rounded-xl border border-amber-400/25 bg-gradient-to-br from-amber-400/10 to-transparent p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-white">
                      <span className="mr-2 text-amber-300">#{i + 1}</span>@{s.author}
                    </p>
                    <span className="text-xs font-bold text-amber-300">{s.score}/100</span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-300">{s.why}</p>
                  <p className="mt-1 text-xs text-zinc-500">{s.commentCount} comments in this batch</p>
                </div>
              ))}
            </div>
            {superfans.length === 0 && !loading && (
              <p className="text-sm text-zinc-500">{t("community.run_a_scan_to_find_your_most_eng")}</p>
            )}
          </div>
        )}

        {/* ── ALERT RULES (free) ── */}
        <div className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Bell className="h-4 w-4 text-amber-300" />{t("community.alert_rules")}<span className="text-xs font-normal text-zinc-500">{t("community.free")}</span>
          </h3>
          <p className="mb-4 text-xs text-zinc-500">{t("community.get_notified_when_the_ai_spots_s")}</p>
          <div className="space-y-2.5">
            {(
              [
                { key: "viral", label: "Viral comment alert", desc: "A comment is blowing up — jump in early" },
                { key: "prRisk", label: "PR risk alert", desc: "Negativity spike or brewing controversy detected" },
                { key: "superfan", label: "Superfan alert", desc: "A top supporter showed up — say thanks" },
              ] as const
            ).map((a) => (
              <label key={a.key} className="flex cursor-pointer items-center justify-between rounded-xl bg-black/40 p-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{t(`community.alerts.${a.key}.label`, { defaultValue: a.label })}</p>
                  <p className="text-xs text-zinc-500">{t(`community.alerts.${a.key}.desc`, { defaultValue: a.desc })}</p>
                </div>
                <input
                  type="checkbox"
                  checked={alerts[a.key]}
                  onChange={() => setAlerts((s) => ({ ...s, [a.key]: !s[a.key] }))}
                  className="h-5 w-5 accent-amber-400"
                />
              </label>
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-600">
          <XCircle className="mr-1 inline h-3.5 w-3.5" />{t("community.the_ai_suggests_you_decide_nothi")}</p>
      </main>

    </div>
  );
}
