import { useEffect, useState } from "react";
import {
  MessageCircleReply, Loader2, Sparkles, Copy, Check, History,
  Trash2, Flame, Heart, Laugh, Briefcase,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  MAX_COMMENTS,
  parseCommentLines,
  buildBatch,
  loadReplyHistory,
  saveReplyBatch,
  clearReplyHistory,
} from "@/lib/comment-replies";
import type { ToneKey, ReplyBatch } from "@/lib/comment-replies";

/* ─── Thy Cheat Code's Comment Reply Assistant ────────────────────────────
   Paste 1-10 fan comments, pick a tone, add optional voice notes — GPT-6
   drafts an on-brand reply for each comment, engineered to boost
   engagement. POST /api/comment-replies at 1 credit per batch.
   Tone keys must stay in sync with the backend route's TONES enum. */

interface Tone {
  key: ToneKey;
  label: string;
  icon: LucideIcon;
  blurb: string;
}

const TONES: Tone[] = [
  { key: "hype", label: "Hype", icon: Flame, blurb: "High-energy, exclamation marks welcome" },
  { key: "grateful", label: "Grateful", icon: Heart, blurb: "Warm, sincere, humble thank-yous" },
  { key: "playful", label: "Playful", icon: Laugh, blurb: "Witty comebacks, light mischief" },
  { key: "professional", label: "Professional", icon: Briefcase, blurb: "Polished, friendly, brand-safe" },
];

const CREDIT_COST = 1;

interface RepliesResponse {
  replies?: string[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

export default function CommentReplies() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [commentsText, setCommentsText] = useState("");
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

  function parseComments(): string[] {
    return parseCommentLines(commentsText);
  }

  const commentCount = parseComments().length;

  function saveBatch(comments: string[], replies: string[]) {
    setHistory((prev) => saveReplyBatch(prev, buildBatch(tone, comments, replies)));
  }

  async function generate() {
    if (loading || !user) return;
    const comments = parseComments();
    if (comments.length === 0) {
      setError("Paste at least one fan comment first — one per line.");
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setCopiedIdx(null);
    setCopiedAll(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/comment-replies", {
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
      const data = (await res.json().catch(() => ({}))) as RepliesResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.replies) || data.replies.length !== comments.length) {
        throw new Error(data.message || data.error || "Reply generation failed — try again.");
      }
      setResults({ comments, replies: data.replies });
      setEditedReplies([...data.replies]);
      saveBatch(comments, data.replies);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("replies-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reply generation failed — try again.");
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
      setError("Copy didn't work in this browser — select the text manually.");
    }
  }

  async function copyAll() {
    const ok = await copyText(editedReplies.join("\n\n"));
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1600);
    } else {
      setError("Copy didn't work in this browser — select the text manually.");
    }
  }

  function restoreBatch(batch: ReplyBatch) {
    setCommentsText(batch.comments.join("\n"));
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
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-4xl px-5 pb-24 pt-14 md:pt-20">
        {/* glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Sparkles className="h-3 w-3" aria-hidden="true" /> Thy Cheat Code's engagement tools
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Comment Reply <span className="text-primary">Assistant</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Paste your fan comments — get on-brand replies in your voice,
            engineered to keep the conversation (and the algorithm) going.
          </p>
        </div>

        {/* ── composer card ─────────────────────────────────────────── */}
        <div className="relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <MessageCircleReply className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-bold">Draft replies</h2>
              <p className="text-sm text-white/45">
                {CREDIT_COST} credit per batch · up to {MAX_COMMENTS} comments · free to edit &amp; copy
              </p>
            </div>
          </div>

          <label
            htmlFor="comments-input"
            className="mt-8 mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40"
          >
            Fan comments — one per line ({commentCount}/{MAX_COMMENTS})
          </label>
          <textarea
            id="comments-input"
            rows={5}
            value={commentsText}
            onChange={(e) => setCommentsText(e.target.value)}
            placeholder={"This song is on repeat 🔂\nWhen's the next drop??\nYou carried this whole track"}
            className={`${inputClass} min-h-[120px] resize-y`}
          />

          <p className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Reply tone
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {TONES.map((t) => {
              const Icon = t.icon;
              const selected = t.key === tone;
              return (
                <button
                  key={t.key}
                  onClick={() => setTone(t.key)}
                  aria-pressed={selected}
                  className={`rounded-2xl border p-3.5 text-left transition ${
                    selected
                      ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                      : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                  }`}
                >
                  <Icon className={`mb-2 h-5 w-5 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
                  <p className={`text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>{t.label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-white/35">{t.blurb}</p>
                </button>
              );
            })}
          </div>

          <label
            htmlFor="voice-notes"
            className="mt-8 mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40"
          >
            Your voice notes <span className="normal-case text-white/25">(optional)</span>
          </label>
          <input
            id="voice-notes"
            type="text"
            value={voiceNotes}
            onChange={(e) => setVoiceNotes(e.target.value)}
            maxLength={300}
            placeholder="e.g. I say &quot;let's get it&quot; a lot, I call my fans &quot;the wave&quot;"
            className={inputClass}
          />

          {error && (
            <p className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}

          <button
            onClick={generate}
            disabled={loading || !user || commentCount === 0}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-base font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Drafting your replies…
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" aria-hidden="true" />
                Draft {commentCount > 0 ? commentCount : ""} {commentCount === 1 ? "reply" : "replies"} · {CREDIT_COST} credit
              </>
            )}
          </button>
          {!user && (
            <p className="mt-3 text-center text-sm text-white/40">
              Sign in to draft replies with AI.
            </p>
          )}
        </div>

        {outOfCredits && (
          <div className="mt-6">
            <OutOfCredits />
          </div>
        )}

        {/* ── results ───────────────────────────────────────────────── */}
        {results && (
          <div id="replies-results" className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold">Your replies</h2>
              <button
                onClick={copyAll}
                className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary/20"
              >
                {copiedAll ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copiedAll ? "Copied!" : "Copy all"}
              </button>
            </div>
            <p className="mt-1 text-sm text-white/45">
              Edit any reply before copying — tweaks are free.
            </p>

            <div className="mt-6 space-y-5">
              {results.comments.map((comment, i) => (
                <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-white/35">
                    Fan comment {i + 1}
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
                      aria-label={`Reply ${i + 1}`}
                      className={`${inputClass} min-h-[56px] flex-1 resize-y border-primary/20 bg-primary/[0.04]`}
                    />
                    <button
                      onClick={() => copyOne(i)}
                      aria-label={`Copy reply ${i + 1}`}
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

        {/* ── history ───────────────────────────────────────────────── */}
        {history.length > 0 && (
          <div className="relative mt-8 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <History className="h-5 w-5 text-primary" aria-hidden="true" /> Past batches
              </h2>
              <button
                onClick={clearHistory}
                className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/50 transition hover:border-red-500/50 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Clear
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {history.map((batch) => (
                <button
                  key={batch.id}
                  onClick={() => restoreBatch(batch)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-left transition hover:border-primary/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white/85">
                      {batch.comments.length} {batch.comments.length === 1 ? "comment" : "comments"} · {TONES.find((t) => t.key === batch.tone)?.label ?? batch.tone}
                    </span>
                    <span className="block truncate text-xs text-white/35">
                      {new Date(batch.at).toLocaleString()} — “{batch.comments[0]?.slice(0, 60)}…”
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-primary">Restore</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
