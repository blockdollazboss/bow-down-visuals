import { useState } from "react";
import {
  ScrollText, Loader2, Copy, Check, AlertTriangle,
  MonitorPlay, Music2, Smartphone, Sparkles, Clock, Zap,
  Eye, Clapperboard, Megaphone, FileText,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── AI Script Writer ────────────────────────────────────────────────────
   High-retention video scripts: platform-optimized hooks, timestamped beats
   with visual cues + B-roll, retention beats every ~30s, and a
   teleprompter-friendly export. 2 credits per script (it burns a long
   GPT-6 completion, so it charges). */

type Platform = "youtube" | "tiktok" | "reels";
type Length = "short" | "medium" | "long" | "deep";
type Tone = "educational" | "entertaining" | "inspirational" | "controversial";

interface ScriptBeat {
  timestamp: string;
  spoken: string;
  visualCue: string;
  broll: string;
}

interface RetentionBeat {
  at: string;
  tactic: string;
  line: string;
}

interface ScriptResult {
  title: string;
  hook: string;
  beats: ScriptBeat[];
  retentionBeats: RetentionBeat[];
  cta: string;
  teleprompter: string;
  creditsUsed: number;
  creditsRemaining: number;
}

const PLATFORMS: Array<{ id: Platform; label: string; blurb: string; icon: typeof MonitorPlay }> = [
  { id: "youtube", label: "YouTube", blurb: "Search-friendly, chapters, mid-roll pacing", icon: MonitorPlay },
  { id: "tiktok", label: "TikTok", blurb: "Vertical energy, comment-bait", icon: Music2 },
  { id: "reels", label: "Reels", blurb: "Aesthetic-first, save/share triggers", icon: Smartphone },
];

const LENGTHS: Array<{ id: Length; label: string; blurb: string }> = [
  { id: "short", label: "Under 60s", blurb: "One tight idea" },
  { id: "medium", label: "1–3 min", blurb: "A clear arc" },
  { id: "long", label: "3–10 min", blurb: "Chapters + re-hooks" },
  { id: "deep", label: "10+ min", blurb: "Documentary depth" },
];

const TONES: Array<{ id: Tone; label: string; blurb: string }> = [
  { id: "educational", label: "Educational", blurb: "Teach like an expert" },
  { id: "entertaining", label: "Entertaining", blurb: "High energy, funny" },
  { id: "inspirational", label: "Inspirational", blurb: "Story-driven, emotional" },
  { id: "controversial", label: "Controversial", blurb: "Bold takes, spicy" },
];

const CREDIT_COST = 2;
const PICK =
  "rounded-xl border px-4 py-3 text-left transition-all cursor-pointer";
const PICK_ACTIVE = "border-amber-400/70 bg-amber-400/10 shadow-[0_0_18px_rgba(251,191,36,0.15)]";
const PICK_IDLE = "border-white/10 bg-white/[0.03] hover:border-white/25";

export default function ScriptWriter() {
  const { user } = useAuth();
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [length, setLength] = useState<Length>("medium");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<Tone>("educational");
  const [audience, setAudience] = useState("");
  const [ctaGoal, setCtaGoal] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showTeleprompter, setShowTeleprompter] = useState(false);

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  async function generate() {
    if (!topic.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    setShowTeleprompter(false);
    try {
      const res = await fetch("/api/script-writer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          length,
          topic: topic.trim(),
          tone,
          audience: audience.trim(),
          ctaGoal: ctaGoal.trim(),
        }),
      });
      const data = (await res.json()) as ScriptResult & { error?: string };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok || !data.beats?.length) {
        throw new Error(data.error || "The studio hiccupped — try again.");
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="max-w-5xl mx-auto px-5 md:px-8 py-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-amber-400/10 border border-amber-400/30">
            <ScrollText className="w-6 h-6 text-amber-300" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            AI <span className="text-amber-300">Script Writer</span>
          </h1>
        </div>
        <p className="text-white/55 max-w-2xl mb-8">
          High-retention scripts with scroll-stopping hooks, timestamped beats,
          visual cues, B-roll ideas, and retention triggers every 30 seconds.
          Pick your platform, set the vibe, get a shoot-ready script.
        </p>

        {/* ── Controls ── */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 mb-8">
          <label className="block text-sm font-semibold text-white/70 mb-2">
            What&apos;s the video about?
          </label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. How I produced my first beat in one night"
            maxLength={300}
            className="w-full rounded-xl bg-black/60 border border-white/15 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400/60 mb-6"
          />

          <div className="grid md:grid-cols-3 gap-6 mb-6">
            <div>
              <p className="text-sm font-semibold text-white/70 mb-2">Platform</p>
              <div className="flex flex-col gap-2">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPlatform(p.id)}
                    className={`${PICK} ${platform === p.id ? PICK_ACTIVE : PICK_IDLE}`}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <p.icon className="w-4 h-4 text-amber-300" />
                      {p.label}
                    </span>
                    <span className="block text-xs text-white/45 mt-0.5">{p.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-white/70 mb-2">Length</p>
              <div className="flex flex-col gap-2">
                {LENGTHS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLength(l.id)}
                    className={`${PICK} ${length === l.id ? PICK_ACTIVE : PICK_IDLE}`}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <Clock className="w-4 h-4 text-amber-300" />
                      {l.label}
                    </span>
                    <span className="block text-xs text-white/45 mt-0.5">{l.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-white/70 mb-2">Tone</p>
              <div className="flex flex-col gap-2">
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTone(t.id)}
                    className={`${PICK} ${tone === t.id ? PICK_ACTIVE : PICK_IDLE}`}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <Zap className="w-4 h-4 text-amber-300" />
                      {t.label}
                    </span>
                    <span className="block text-xs text-white/45 mt-0.5">{t.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-semibold text-white/70 mb-2">
                Audience <span className="text-white/30 font-normal">(optional)</span>
              </label>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. bedroom producers"
                maxLength={200}
                className="w-full rounded-xl bg-black/60 border border-white/15 px-4 py-2.5 text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400/60"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-white/70 mb-2">
                CTA goal <span className="text-white/30 font-normal">(optional)</span>
              </label>
              <input
                value={ctaGoal}
                onChange={(e) => setCtaGoal(e.target.value)}
                placeholder="e.g. join my Discord"
                maxLength={200}
                className="w-full rounded-xl bg-black/60 border border-white/15 px-4 py-2.5 text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400/60"
              />
            </div>
          </div>

          <button
            onClick={generate}
            disabled={!topic.trim() || generating || !user}
            className="w-full md:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-8 py-3.5 font-bold text-black hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {generating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Writing your script…
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Write my script · {CREDIT_COST} credits
              </>
            )}
          </button>
          {!user && (
            <p className="text-sm text-white/40 mt-2">Sign in to write scripts.</p>
          )}
        </section>

        {outOfCredits && (
          <div className="mx-auto mt-4 max-w-md mb-8">
            <OutOfCredits />
          </div>
        )}
        {error && !outOfCredits && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 mb-8">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            {error}
          </div>
        )}

        {/* ── Result ── */}
        {result && (
          <section className="space-y-6">
            {result.title && (
              <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.04] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-amber-300/80 font-semibold mb-1">
                      Suggested title
                    </p>
                    <h2 className="text-xl font-bold">{result.title}</h2>
                  </div>
                  <button
                    onClick={() => copyText("title", result.title)}
                    className="p-2 rounded-lg border border-white/10 hover:border-amber-400/50 transition-colors"
                    aria-label="Copy title"
                  >
                    {copied === "title" ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-white/60" />
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <p className="text-xs uppercase tracking-wider text-amber-300/80 font-semibold flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" /> The hook — first 3 seconds
                </p>
                <button
                  onClick={() => copyText("hook", result.hook)}
                  className="p-2 rounded-lg border border-white/10 hover:border-amber-400/50 transition-colors"
                  aria-label="Copy hook"
                >
                  {copied === "hook" ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-white/60" />
                  )}
                </button>
              </div>
              <p className="text-lg font-medium text-white leading-relaxed">
                &ldquo;{result.hook}&rdquo;
              </p>
            </div>

            <div>
              <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                <Clapperboard className="w-5 h-5 text-amber-300" />
                The script — {result.beats.length} beats
              </h3>
              <div className="space-y-3">
                {result.beats.map((beat, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-mono font-bold text-amber-300 bg-amber-400/10 border border-amber-400/25 rounded-md px-2 py-0.5">
                        {beat.timestamp}
                      </span>
                      <span className="text-xs text-white/35">Beat {i + 1}</span>
                    </div>
                    <p className="text-white/90 leading-relaxed mb-2">{beat.spoken}</p>
                    <div className="grid sm:grid-cols-2 gap-2 text-xs">
                      {beat.visualCue && (
                        <p className="flex gap-1.5 text-white/50">
                          <Eye className="w-3.5 h-3.5 shrink-0 mt-0.5 text-white/35" />
                          <span>
                            <span className="font-semibold text-white/65">On screen: </span>
                            {beat.visualCue}
                          </span>
                        </p>
                      )}
                      {beat.broll && (
                        <p className="flex gap-1.5 text-white/50">
                          <FileText className="w-3.5 h-3.5 shrink-0 mt-0.5 text-white/35" />
                          <span>
                            <span className="font-semibold text-white/65">B-roll: </span>
                            {beat.broll}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {result.retentionBeats.length > 0 && (
              <div>
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-300" />
                  Retention beats
                </h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {result.retentionBeats.map((r, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-amber-400/20 bg-amber-400/[0.03] p-4"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono font-bold text-amber-300">
                          {r.at}
                        </span>
                        {r.tactic && (
                          <span className="text-[11px] uppercase tracking-wide text-white/45 border border-white/15 rounded-full px-2 py-0.5">
                            {r.tactic}
                          </span>
                        )}
                      </div>
                      <p className="text-white/85 text-sm leading-relaxed">
                        &ldquo;{r.line}&rdquo;
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.cta && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <p className="text-xs uppercase tracking-wider text-amber-300/80 font-semibold mb-1 flex items-center gap-1.5">
                  <Megaphone className="w-3.5 h-3.5" /> Call to action
                </p>
                <p className="text-white/90">&ldquo;{result.cta}&rdquo;</p>
              </div>
            )}

            {result.teleprompter && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold">Teleprompter</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowTeleprompter((s) => !s)}
                      className="text-sm rounded-lg border border-white/15 px-3 py-1.5 hover:border-amber-400/50 transition-colors"
                    >
                      {showTeleprompter ? "Hide" : "Show"}
                    </button>
                    <button
                      onClick={() => copyText("teleprompter", result.teleprompter)}
                      className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 hover:bg-amber-400/20 transition-colors"
                    >
                      {copied === "teleprompter" ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                      Copy script
                    </button>
                  </div>
                </div>
                {showTeleprompter && (
                  <p className="text-white/80 leading-loose whitespace-pre-wrap text-[17px]">
                    {result.teleprompter}
                  </p>
                )}
              </div>
            )}

            <p className="text-xs text-white/35 text-center">
              {result.creditsUsed} credits used · {result.creditsRemaining} remaining
            </p>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
