import { useState } from "react";
import { Link } from "wouter";
import {
  Zap, Gauge, Loader2, Sparkles, ArrowRight, Megaphone,
  Clapperboard, Film, GraduationCap, Wrench, CheckCircle2, AlertTriangle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Thy Cheat Code's Hook Studio ────────────────────────────────────────
   Two money tools on one page: the Hook Generator (first-3-second openers)
   and the Virality Pre-flight (honest viral-READINESS scorecard — never a
   virality guarantee). Both POST to /api/hook-studio at 1 credit per
   generation on GPT-6 Sol. Video-type keys must stay in sync with the
   backend route's VIDEO_TYPES enum. */

type TabKey = "hooks" | "preflight" | "captions";

type VideoTypeKey = "music-promo" | "behind-the-scenes" | "tutorial" | "announcement";

interface VideoType {
  key: VideoTypeKey;
  label: string;
  icon: LucideIcon;
  blurb: string;
}

const VIDEO_TYPES: VideoType[] = [
  { key: "music-promo", label: "Music Promo", icon: Megaphone, blurb: "Promoting a song or music video" },
  { key: "behind-the-scenes", label: "Behind the Scenes", icon: Film, blurb: "Studio life & process content" },
  { key: "tutorial", label: "Tutorial", icon: GraduationCap, blurb: "Teaching one creator skill fast" },
  { key: "announcement", label: "Announcement", icon: Clapperboard, blurb: "Drops, shows & big news" },
];

const CREDIT_COST = 1;

interface HooksResponse {
  hooks?: string[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface ScoreCheck {
  label: string;
  score: number;
  fix: string;
}

interface PreflightResponse {
  score?: number;
  verdict?: string;
  disclaimer?: string;
  checks?: ScoreCheck[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface CaptionsResponse {
  captions?: string[];
  hashtags?: { niche?: string[]; broad?: string[]; trending?: string[] };
  cta?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

function scoreBar(score: number): string {
  if (score >= 75) return "from-emerald-500 to-emerald-300";
  if (score >= 50) return "from-amber-500 to-amber-300";
  return "from-red-500 to-red-300";
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

export default function HookStudio() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [tab, setTab] = useState<TabKey>("hooks");

  /* hook generator state */
  const [videoType, setVideoType] = useState<VideoTypeKey>("music-promo");
  const [topic, setTopic] = useState("");
  const [hooks, setHooks] = useState<string[]>([]);
  const [hooksLoading, setHooksLoading] = useState(false);

  /* pre-flight state */
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [description, setDescription] = useState("");
  const [scorecard, setScorecard] = useState<PreflightResponse | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  /* captions state */
  const [capTopic, setCapTopic] = useState("");
  const [capPlatform, setCapPlatform] = useState<"tiktok" | "instagram" | "youtube" | "twitter">("tiktok");
  const [capTone, setCapTone] = useState("");
  const [capResult, setCapResult] = useState<CaptionsResponse | null>(null);
  const [capLoading, setCapLoading] = useState(false);

  /* shared */
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  function switchTab(next: TabKey) {
    setTab(next);
    setError(null);
    setOutOfCredits(false);
  }

  async function authedPost(body: Record<string, unknown>) {
    const token = await getAccessToken();
    return confirmedFetch("/api/hook-studio", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  function handlePaidFailure(res: Response, data: { error?: string }): boolean {
    if (res.status === 402 || data.error === "out_of_credits") {
      setOutOfCredits(true);
      refreshProfile();
      return true;
    }
    return false;
  }

  async function generateHooks() {
    if (hooksLoading || !user) return;
    setHooksLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authedPost({ mode: "hooks", videoType, topic: topic.trim() });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as HooksResponse;
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || !Array.isArray(data.hooks) || data.hooks.length === 0) {
        throw new Error(data.message || data.error || "Hook generation failed — try again.");
      }
      setHooks(data.hooks);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("hooks-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hook generation failed — try again.");
    } finally {
      setHooksLoading(false);
    }
  }

  async function generateCaptions() {
    if (capLoading || !user) return;
    if (!capTopic.trim()) {
      setError("Tell us what the post is about first.");
      return;
    }
    setCapLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authedPost({
        mode: "captions",
        topic: capTopic.trim(),
        platform: capPlatform,
        tone: capTone.trim(),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as CaptionsResponse;
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || !Array.isArray(data.captions) || data.captions.length === 0) {
        throw new Error(data.message || data.error || "Caption generation failed — try again.");
      }
      setCapResult(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("captions-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Caption generation failed — try again.");
    } finally {
      setCapLoading(false);
    }
  }

  async function scoreVideo() {
    if (preflightLoading || !user) return;
    if (!title.trim()) {
      setError("Give your video a title first — that's the first thing the pre-flight checks.");
      return;
    }
    setPreflightLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authedPost({
        mode: "preflight",
        title: title.trim(),
        caption: caption.trim(),
        hashtags: hashtags.trim(),
        description: description.trim(),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as PreflightResponse;
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || !Array.isArray(data.checks) || data.checks.length === 0) {
        throw new Error(data.message || data.error || "Scoring failed — try again.");
      }
      setScorecard(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("preflight-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scoring failed — try again.");
    } finally {
      setPreflightLoading(false);
    }
  }

  const activeVideoType = VIDEO_TYPES.find((v) => v.key === videoType)!;

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
            <Zap className="h-3 w-3" aria-hidden="true" /> Thy Cheat Code's money tools
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Hook <span className="text-primary">Studio</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Your money is made in the first 3 seconds. Generate scroll-stopping
            openers — then run your post through the pre-flight before you ship it.
          </p>
        </div>

        {/* tabs */}
        <div className="relative mt-10 flex justify-center gap-2" role="tablist" aria-label="Hook Studio tools">
          {(
            [
              { key: "hooks", label: "Hook Generator", icon: Zap },
              { key: "captions", label: "Captions & Hashtags", icon: Megaphone },
              { key: "preflight", label: "Virality Pre-flight", icon: Gauge },
            ] as { key: TabKey; label: string; icon: LucideIcon }[]
          ).map(({ key, label, icon: Icon }) => {
            const selected = tab === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={selected}
                onClick={() => switchTab(key)}
                className={`flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold transition ${
                  selected
                    ? "bg-primary text-black shadow-[0_0_18px_rgba(212,175,55,0.35)]"
                    : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>

        {/* ── HOOK GENERATOR ─────────────────────────────────────────── */}
        {tab === "hooks" && (
          <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Zap className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-xl font-bold">Hook Generator</h2>
                <p className="text-sm text-white/45">Five first-3-second openers, engineered to stop the scroll.</p>
              </div>
            </div>

            {/* video type picker */}
            <p className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
              What kind of video?
            </p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {VIDEO_TYPES.map((v) => {
                const Icon = v.icon;
                const selected = v.key === videoType;
                return (
                  <button
                    key={v.key}
                    onClick={() => setVideoType(v.key)}
                    className={`rounded-2xl border p-3.5 text-left transition ${
                      selected
                        ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                        : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                    }`}
                  >
                    <Icon className={`mb-2 h-5 w-5 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
                    <p className={`text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>{v.label}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-white/35">{v.blurb}</p>
                  </button>
                );
              })}
            </div>

            {/* topic */}
            <p className="mt-6 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
              What's it about? <span className="normal-case tracking-normal text-white/25">(optional)</span>
            </p>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={300}
              placeholder={`e.g. my new single "${activeVideoType.label === "Music Promo" ? "Golden Tide" : "..."}"`}
              className={inputClass}
            />

            {/* generate */}
            <div className="mt-8 text-center">
              {user ? (
                <button
                  onClick={generateHooks}
                  disabled={hooksLoading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
                >
                  {hooksLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-6 w-6" aria-hidden="true" />
                  )}
                  {hooksLoading ? "Cooking up hooks…" : "Generate 5 hooks"}
                </button>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
                >
                  <Sparkles className="h-6 w-6" aria-hidden="true" />
                  Sign in to generate hooks
                  <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </Link>
              )}
              <p className="mt-2.5 text-xs text-white/35">
                {CREDIT_COST} credit per generation · powered by Thy Cheat Code
              </p>
              {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
              {error && !outOfCredits && (
                <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </p>
              )}
            </div>

            {/* results */}
            {hooks.length > 0 && (
              <div id="hooks-results" className="mt-8">
                <div className="mb-4 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Your 5 hooks
                  </p>
                  {user && (
                    <button
                      onClick={generateHooks}
                      disabled={hooksLoading}
                      className="flex items-center gap-1.5 rounded-full border border-primary/40 px-3.5 py-1.5 text-xs font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
                    >
                      <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                      Re-roll ({CREDIT_COST} credit)
                    </button>
                  )}
                </div>
                <div className="grid gap-3">
                  {hooks.map((hook, i) => (
                    <div
                      key={`hook-${i}`}
                      className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/40"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
                        {i + 1}
                      </span>
                      <p className="pt-1 text-[15px] leading-relaxed text-white/90">“{hook}”</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-center text-xs text-white/30">
                  <Wrench className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                  Tip: say it in the first second, show it on screen too.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── CAPTIONS & HASHTAGS ────────────────────────────────────── */}
        {tab === "captions" && (
          <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Megaphone className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-xl font-bold">Captions & Hashtags</h2>
                <p className="text-sm text-white/45">Ready-to-post captions, tiered hashtags, and a CTA — 1 credit.</p>
              </div>
            </div>

            <p className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
              What's the post about?
            </p>
            <textarea
              value={capTopic}
              onChange={(e) => setCapTopic(e.target.value)}
              placeholder="e.g. My new single 'Midnight Gold' just dropped — luxury rap anthem"
              rows={3}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none"
            />

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">Platform</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["tiktok", "instagram", "youtube", "twitter"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setCapPlatform(p)}
                      className={`rounded-lg px-3 py-2.5 text-sm font-semibold capitalize transition ${
                        capPlatform === p
                          ? "bg-primary text-black"
                          : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
                      }`}
                    >
                      {p === "twitter" ? "X / Twitter" : p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                  Tone / vibe <span className="normal-case font-normal text-white/30">(optional)</span>
                </p>
                <input
                  value={capTone}
                  onChange={(e) => setCapTone(e.target.value)}
                  placeholder="e.g. confident, playful, luxury"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={generateCaptions}
              disabled={capLoading || !capTopic.trim()}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {capLoading ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Writing...</>
              ) : (
                <><Sparkles className="h-5 w-5" /> Generate — 1 credit</>
              )}
            </button>

            {capResult && (
              <div id="captions-results" className="mt-8 space-y-6">
                <div>
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">Captions — pick your favorite</p>
                  <div className="space-y-3">
                    {capResult.captions?.map((c, i) => (
                      <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                        <p className="text-white/90 whitespace-pre-wrap">{c}</p>
                        <button
                          onClick={() => navigator.clipboard.writeText(c)}
                          className="mt-2 text-xs font-semibold text-primary hover:underline"
                        >
                          Copy
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {capResult.hashtags && (
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">Hashtags</p>
                      <button
                        onClick={() => {
                          const all = [
                            ...(capResult.hashtags?.niche ?? []),
                            ...(capResult.hashtags?.broad ?? []),
                            ...(capResult.hashtags?.trending ?? []),
                          ].map((t) => `#${t}`).join(" ");
                          navigator.clipboard.writeText(all);
                        }}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        Copy all
                      </button>
                    </div>
                    {(["niche", "broad", "trending"] as const).map((tier) => {
                      const tags = capResult.hashtags?.[tier] ?? [];
                      if (tags.length === 0) return null;
                      return (
                        <div key={tier} className="mb-3">
                          <p className="mb-1.5 text-xs font-semibold capitalize text-white/50">
                            {tier === "niche" ? "🎯 Niche (targeted reach)" : tier === "broad" ? "🌊 Broad (discovery)" : "🔥 Trending energy"}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {tags.map((t, i) => (
                              <span key={i} className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                                #{t}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {capResult.cta && (
                  <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-white/40">Call to action</p>
                    <p className="text-white/90">{capResult.cta}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── VIRALITY PRE-FLIGHT ────────────────────────────────────── */}
        {tab === "preflight" && (
          <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Gauge className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-xl font-bold">Virality Pre-flight</h2>
                <p className="text-sm text-white/45">A readiness score for your post — before you ship it.</p>
              </div>
            </div>

            <div className="mt-8 grid gap-4">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40" htmlFor="pf-title">
                  Title / first line
                </label>
                <input
                  id="pf-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="The exact first line viewers see or hear"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40" htmlFor="pf-caption">
                  Caption
                </label>
                <textarea
                  id="pf-caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={1000}
                  rows={2}
                  placeholder="Your caption (optional)"
                  className={`${inputClass} resize-none`}
                />
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40" htmlFor="pf-hashtags">
                  Hashtags
                </label>
                <input
                  id="pf-hashtags"
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  maxLength={500}
                  placeholder="#newmusic #independentartist …"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40" htmlFor="pf-desc">
                  What's the video?
                </label>
                <textarea
                  id="pf-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1000}
                  rows={2}
                  placeholder="Describe the video in a sentence or two (optional)"
                  className={`${inputClass} resize-none`}
                />
              </div>
            </div>

            <div className="mt-8 text-center">
              {user ? (
                <button
                  onClick={scoreVideo}
                  disabled={preflightLoading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
                >
                  {preflightLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                  ) : (
                    <Gauge className="h-6 w-6" aria-hidden="true" />
                  )}
                  {preflightLoading ? "Running pre-flight…" : "Score my video"}
                </button>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
                >
                  <Gauge className="h-6 w-6" aria-hidden="true" />
                  Sign in to run the pre-flight
                  <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </Link>
              )}
              <p className="mt-2.5 text-xs text-white/35">
                {CREDIT_COST} credit per scorecard · powered by Thy Cheat Code
              </p>
              {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
              {error && !outOfCredits && (
                <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </p>
              )}
            </div>

            {/* scorecard */}
            {scorecard && typeof scorecard.score === "number" && (
              <div id="preflight-results" className="mt-8">
                <div className="rounded-2xl border border-white/10 bg-black/60 p-6 text-center">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                    Viral readiness score
                  </p>
                  <p className={`mt-2 font-display text-6xl font-black ${scoreColor(scorecard.score)}`}>
                    {scorecard.score}
                    <span className="text-2xl text-white/30">/100</span>
                  </p>
                  <div className="mx-auto mt-4 h-2.5 max-w-sm overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${scoreBar(scorecard.score)} transition-all`}
                      style={{ width: `${scorecard.score}%` }}
                    />
                  </div>
                  {scorecard.verdict && (
                    <p className="mx-auto mt-4 max-w-md text-[15px] font-semibold leading-relaxed text-white/85">
                      {scorecard.verdict}
                    </p>
                  )}
                </div>

                <div className="mt-4 grid gap-3">
                  {scorecard.checks!.map((check, i) => (
                    <div
                      key={`check-${i}`}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="flex items-center gap-2 text-sm font-bold text-white/90">
                          {check.score >= 75 ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
                          )}
                          {check.label}
                        </p>
                        <p className={`font-display text-xl font-black ${scoreColor(check.score)}`}>
                          {check.score}
                        </p>
                      </div>
                      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${scoreBar(check.score)}`}
                          style={{ width: `${check.score}%` }}
                        />
                      </div>
                      <p className="mt-2.5 text-sm leading-relaxed text-white/60">
                        <span className="font-semibold text-primary/90">Fix: </span>
                        {check.fix}
                      </p>
                    </div>
                  ))}
                </div>

                <p className="mt-4 text-center text-xs italic text-white/30">
                  {scorecard.disclaimer || "A readiness score, not a virality guarantee — no AI can predict what blows up."}
                </p>
              </div>
            )}
          </div>
        )}

        {/* cross-link */}
        <p className="relative mt-8 text-center text-sm text-white/40">
          Hooks in hand? Ask{" "}
          <span className="font-semibold text-primary">Thy Cheat Code 🦈</span>{" "}
          in the chat bubble to build the full video plan around them.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
