import { useState } from "react";
import {
  ShieldAlert, MessageSquareHeart, BarChart3, Star, Loader2, Sparkles,
  CheckCircle2, XCircle, AlertTriangle, Copy, Bell, Users,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

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

interface ReplyDraft {
  index: number;
  reply: string;
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
  { key: "moderate", label: "Moderation", icon: ShieldAlert, cost: "1 cr / 50 comments" },
  { key: "replies", label: "Reply Drafts", icon: MessageSquareHeart, cost: "1 cr / batch" },
  { key: "sentiment", label: "Sentiment", icon: BarChart3, cost: "1 cr / report" },
  { key: "superfans", label: "Superfans", icon: Star, cost: "1 cr / scan" },
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

export default function CommunityManager() {
  const { getAccessToken, refreshProfile } = useAuth();
  const [tab, setTab] = useState<TabKey>("moderate");
  const [paste, setPaste] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [flags, setFlags] = useState<FlaggedComment[]>([]);
  const [reviewed, setReviewed] = useState<string[]>([]); // "approved:<i>" / "removed:<i>"
  const [moderatedCount, setModeratedCount] = useState(0);

  const [drafts, setDrafts] = useState<ReplyDraft[]>([]);
  const [tone, setTone] = useState("friendly");

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
      setError("Paste some comments first — one per line, like @fan: loved this!");
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

  async function runReplies() {
    const comments = getComments();
    if (!comments) return;
    setLoading(true); setError(null); setOutOfCredits(false);
    try {
      const data = await callApi("/api/community/reply-draft", {
        comments: comments.slice(0, 20),
        tone,
      });
      if (!data) return;
      setDrafts((data.drafts as ReplyDraft[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reply drafting failed.");
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

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const verdictBadge = (v: FlaggedComment["verdict"]) =>
    v === "remove"
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : "border-amber-500/40 bg-amber-500/10 text-amber-300";

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-28">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-amber-300">
            <Users className="h-3.5 w-3.5" /> AI Community Manager
          </div>
          <h1 className="text-4xl font-black tracking-tight md:text-5xl">
            Your audience, <span className="bg-gradient-to-r from-amber-300 to-yellow-500 bg-clip-text text-transparent">managed.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-zinc-400">
            AI moderation queue, smart reply drafts, sentiment radar, and superfan detection.
            Nothing is ever auto-deleted — every flag waits for your call.
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap justify-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setError(null); }}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                tab === t.key
                  ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
              <span className="text-[10px] font-normal opacity-70">{t.cost}</span>
            </button>
          ))}
        </div>

        {/* Comment input (shared) */}
        <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-semibold text-zinc-200">Paste comments</label>
            <button
              onClick={() => setPaste(SAMPLE_COMMENTS)}
              className="text-xs text-amber-300/80 hover:text-amber-200"
            >
              Load sample
            </button>
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
              Moderate comments · 1 cr / 50
            </button>
            {moderatedCount > 0 && (
              <p className="mb-3 text-sm text-zinc-400">
                Reviewed <span className="font-bold text-white">{moderatedCount}</span> ·{" "}
                <span className="font-bold text-amber-300">{flags.length}</span> flagged for your review
              </p>
            )}
            {flags.length === 0 && moderatedCount > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
                <CheckCircle2 className="h-5 w-5" /> Clean — nothing needs your attention.
              </div>
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
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setReviewed((r) => [...r, `remove:${f.index}`])}
                            className="rounded-full border border-red-500/40 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/10"
                          >
                            Remove
                          </button>
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

        {/* ── REPLY DRAFTS ── */}
        {tab === "replies" && (
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {(["friendly", "playful", "professional", "hype"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTone(t)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    tone === t
                      ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                      : "border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t}
                </button>
              ))}
              <button
                onClick={runReplies}
                disabled={loading}
                className="ml-2 flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Draft replies · 1 cr
              </button>
            </div>
            <div className="space-y-3">
              {drafts.map((d) => (
                <div key={d.index} className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
                  <p className="text-sm text-zinc-100">“{d.reply}”</p>
                  <button
                    onClick={() => copy(d.reply)}
                    className="mt-2 flex items-center gap-1.5 text-xs text-amber-300/80 hover:text-amber-200"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy reply
                  </button>
                </div>
              ))}
            </div>
          </div>
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
              Run sentiment report · 1 cr
            </button>
            {sentiment && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-zinc-300">Overall sentiment</span>
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
                    <h3 className="mb-3 text-sm font-bold text-zinc-200">What fans are saying</h3>
                    <div className="space-y-2">
                      {sentiment.themes.map((t, i) => (
                        <div key={i} className="rounded-xl bg-black/40 p-3">
                          <p className="text-sm font-semibold text-white">{t.theme}
                            <span className="ml-2 text-xs font-normal text-zinc-400">{t.sentiment}</span>
                          </p>
                          {t.examples?.map((e, j) => (
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
                      <h3 className="mb-2 text-sm font-bold text-emerald-300">Wins 🏆</h3>
                      <ul className="space-y-1 text-sm text-zinc-300">
                        {sentiment.wins.map((w, i) => <li key={i}>· {w}</li>)}
                      </ul>
                    </div>
                  )}
                  {sentiment.risks && sentiment.risks.length > 0 && (
                    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
                      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-red-300">
                        <AlertTriangle className="h-4 w-4" /> Watch out
                      </h3>
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
              Scan for superfans · 1 cr
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
              <p className="text-sm text-zinc-500">Run a scan to find your most engaged supporters.</p>
            )}
          </div>
        )}

        {/* ── ALERT RULES (free) ── */}
        <div className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Bell className="h-4 w-4 text-amber-300" /> Alert rules <span className="text-xs font-normal text-zinc-500">· free</span>
          </h3>
          <p className="mb-4 text-xs text-zinc-500">Get notified when the AI spots something worth your attention.</p>
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
                  <p className="text-sm font-semibold text-zinc-100">{a.label}</p>
                  <p className="text-xs text-zinc-500">{a.desc}</p>
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
          <XCircle className="mr-1 inline h-3.5 w-3.5" />
          The AI suggests — you decide. Nothing is deleted or posted without your approval.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
