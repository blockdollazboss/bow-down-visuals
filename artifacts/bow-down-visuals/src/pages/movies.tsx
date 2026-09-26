import { useState } from "react";
import {
  Clapperboard, Loader2, Sparkles, AlertTriangle, Film, Tv,
  Users, ListVideo, Quote, Target, TrendingUp, Scissors, Clock,
  Zap, MessageSquareText, CalendarClock,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Movies & Web Series ────────────────────────────────────────────────
   Two AI tools for creators going long-form:
   1. Concept generator — describe an idea → title, logline, episode
      breakdown, character bible (POST /api/movies/concept, 4 credits).
   2. Stream clip detector — describe a stream VOD → highlight timestamps
      with clip-ready titles (POST /api/movies/clip-detect, 3 credits).
   Charge-before-generate with auto-refund on failure, gold/black theme. */

const CONCEPT_CREDITS = 4;
const CLIP_DETECT_CREDITS = 3;

type Tab = "concept" | "clips";

const FORMATS = [
  { key: "movie", label: "Movie", icon: Film },
  { key: "web-series", label: "Web Series", icon: Tv },
  { key: "limited-series", label: "Limited Series", icon: ListVideo },
] as const;
type FormatKey = (typeof FORMATS)[number]["key"];

interface Episode {
  number: number;
  title: string;
  summary: string;
}
interface Character {
  name: string;
  role: string;
  description: string;
  arc: string;
}
interface Concept {
  title: string;
  tagline: string;
  logline: string;
  synopsis: string;
  genre: string;
  targetAudience: string;
  episodes: Episode[];
  characters: Character[];
  pilotHook: string;
  comparables: string[];
}
interface Clip {
  title: string;
  timestamp: string;
  timestampSeconds: number;
  durationSec: number;
  category: string;
  hook: string;
  caption: string;
  viralityScore: number;
}
interface Detection {
  clips: Clip[];
  streamSummary: string;
  postingStrategy: string;
}

const CATEGORY_STYLES: Record<string, string> = {
  "funny-moment": "bg-amber-400/15 text-amber-300 border-amber-400/30",
  "big-play": "bg-emerald-400/15 text-emerald-300 border-emerald-400/30",
  "reaction": "bg-violet-400/15 text-violet-300 border-violet-400/30",
  "fail": "bg-red-400/15 text-red-300 border-red-400/30",
  "wholesome": "bg-sky-400/15 text-sky-300 border-sky-400/30",
  "rant": "bg-orange-400/15 text-orange-300 border-orange-400/30",
  "clutch": "bg-yellow-400/15 text-yellow-300 border-yellow-400/30",
};
function categoryBadge(c: string): string {
  return CATEGORY_STYLES[c] ?? "bg-white/10 text-white/60 border-white/20";
}
function viralityColor(s: number): string {
  if (s >= 8) return "text-emerald-400";
  if (s >= 6) return "text-amber-400";
  return "text-white/40";
}

export default function Movies() {
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [tab, setTab] = useState<Tab>("concept");

  /* concept state */
  const [idea, setIdea] = useState("");
  const [format, setFormat] = useState<FormatKey>("web-series");
  const [genre, setGenre] = useState("");
  const [conceptLoading, setConceptLoading] = useState(false);
  const [concept, setConcept] = useState<Concept | null>(null);

  /* clip detect state */
  const [streamUrl, setStreamUrl] = useState("");
  const [description, setDescription] = useState("");
  const [clipLoading, setClipLoading] = useState(false);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [detectNote, setDetectNote] = useState("");

  const [error, setError] = useState("");

  const canGenerateConcept = idea.trim().length >= 50 && !conceptLoading;
  const canDetectClips = description.trim().length >= 50 && !clipLoading;

  async function generateConcept() {
    if (!canGenerateConcept) return;
    setConceptLoading(true);
    setError("");
    setConcept(null);
    try {
      const res = await confirmedFetch("/api/movies/concept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: CONCEPT_CREDITS,
        overrideFeature: "Movie/Series Concept",
        body: JSON.stringify({
          idea: idea.trim(),
          format,
          genre: genre.trim(),
        }),
      });
      const data = await res!.json();
      if (data.concept) {
        setConcept(data.concept as Concept);
      } else {
        setError(data.message || "Generation failed. Try again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setConceptLoading(false);
    }
  }

  async function detectClips() {
    if (!canDetectClips) return;
    setClipLoading(true);
    setError("");
    setDetection(null);
    try {
      const res = await confirmedFetch("/api/movies/clip-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: CLIP_DETECT_CREDITS,
        overrideFeature: "Stream Clip Detection",
        body: JSON.stringify({
          streamUrl: streamUrl.trim(),
          description: description.trim(),
        }),
      });
      const data = await res!.json();
      if (data.detection) {
        setDetection(data.detection as Detection);
        setDetectNote(data.note ?? "");
      } else {
        setError(data.message || "Detection failed. Try again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detection failed.");
    } finally {
      setClipLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="max-w-5xl mx-auto px-4 pt-28 pb-20">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300 text-xs font-bold uppercase tracking-widest mb-4">
            <Clapperboard className="h-3.5 w-3.5" /> Movies & Web Series
          </div>
          <h1 className="text-4xl md:text-5xl font-black mb-3">
            Your next <span className="text-amber-400">binge-worthy</span> hit starts here.
          </h1>
          <p className="text-white/50 max-w-2xl mx-auto">
            Develop a movie or series concept with AI — or turn your streams into
            viral clips. Fully automated: describe it, AI does the rest.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex justify-center gap-2 mb-8">
          {(
            [
              { key: "concept", label: "Concept Generator", icon: Sparkles },
              { key: "clips", label: "Stream Clip Detector", icon: Scissors },
            ] as { key: Tab; label: string; icon: typeof Sparkles }[]
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => { setTab(t.key); setError(""); }}
              className={`px-5 py-2.5 rounded-full text-sm font-bold border transition-colors flex items-center gap-2 ${
                tab === t.key
                  ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                  : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white"
              }`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex gap-2 max-w-3xl mx-auto">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {tab === "concept" ? (
          !concept ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 md:p-8 max-w-3xl mx-auto">
              <label className="block text-xs font-bold uppercase tracking-widest text-white/40 mb-3">
                What are you making?
              </label>
              <div className="flex flex-wrap gap-2 mb-6">
                {FORMATS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFormat(f.key)}
                    className={`px-4 py-2 rounded-full text-sm font-bold border transition-colors flex items-center gap-2 ${
                      format === f.key
                        ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                        : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white"
                    }`}
                  >
                    <f.icon className="h-4 w-4" /> {f.label}
                  </button>
                ))}
              </div>

              <label className="block text-xs font-bold uppercase tracking-widest text-white/40 mb-3">
                Genre <span className="text-white/25 normal-case">(optional)</span>
              </label>
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="e.g. sci-fi thriller, street drama, dark comedy…"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-amber-400/50 mb-6"
              />

              <label className="block text-xs font-bold uppercase tracking-widest text-white/40 mb-3">
                Describe your concept
              </label>
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="Give me the raw idea — characters, world, the vibe. The messier the better, AI turns it into a development package."
                rows={8}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-amber-400/50"
              />
              <div className="text-xs mt-2 mb-6 text-white/30">
                {idea.trim().length} characters {idea.trim().length < 50 ? "(need 50+)" : "✓"}
              </div>

              <button
                type="button"
                onClick={generateConcept}
                disabled={!canGenerateConcept}
                className="w-full py-4 rounded-xl font-black text-black bg-gradient-to-r from-amber-300 to-yellow-500 hover:from-amber-200 hover:to-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {conceptLoading ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Developing your concept…</>
                ) : (
                  <><Sparkles className="h-5 w-5" /> Generate Concept — {CONCEPT_CREDITS} credits</>
                )}
              </button>
              {!user && (
                <p className="text-center text-xs text-white/30 mt-3">Sign in to generate concepts.</p>
              )}
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl mx-auto">
              {/* Title hero */}
              <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-400/[0.08] to-transparent p-6 md:p-8 text-center">
                <div className="text-xs uppercase tracking-widest text-amber-400/70 mb-2">
                  {FORMATS.find((f) => f.key === format)?.label}
                </div>
                <h2 className="text-3xl md:text-4xl font-black mb-2">{concept.title}</h2>
                <p className="text-amber-200/80 italic">"{concept.tagline}"</p>
              </div>

              {/* Logline */}
              <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                <h3 className="text-lg font-black mb-3 flex items-center gap-2">
                  <Quote className="h-5 w-5 text-amber-400" /> Logline
                </h3>
                <p className="text-white/75 leading-relaxed">{concept.logline}</p>
                <p className="text-white/50 text-sm mt-4 leading-relaxed">{concept.synopsis}</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <span className="px-3 py-1 rounded-full text-xs font-bold border border-white/15 text-white/60">{concept.genre}</span>
                  <span className="px-3 py-1 rounded-full text-xs font-bold border border-white/15 text-white/60 flex items-center gap-1">
                    <Target className="h-3 w-3" /> {concept.targetAudience}
                  </span>
                </div>
              </section>

              {/* Episodes */}
              {concept.episodes?.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <h3 className="text-lg font-black mb-4 flex items-center gap-2">
                    <ListVideo className="h-5 w-5 text-amber-400" />
                    {format === "movie" ? "Three-Act Structure" : `Episode Breakdown (${concept.episodes.length})`}
                  </h3>
                  <div className="space-y-3">
                    {concept.episodes.map((ep) => (
                      <div key={ep.number} className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <div className="font-bold text-amber-200 mb-1">
                          {format === "movie" ? "" : `Ep ${ep.number} — `}{ep.title}
                        </div>
                        <p className="text-sm text-white/60">{ep.summary}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Characters */}
              {concept.characters?.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <h3 className="text-lg font-black mb-4 flex items-center gap-2">
                    <Users className="h-5 w-5 text-amber-400" /> Character Bible
                  </h3>
                  <div className="grid md:grid-cols-2 gap-3">
                    {concept.characters.map((c, i) => (
                      <div key={i} className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-white/90">{c.name}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-amber-400/30 bg-amber-400/10 text-amber-300">
                            {c.role}
                          </span>
                        </div>
                        <p className="text-sm text-white/60 mb-2">{c.description}</p>
                        <p className="text-xs text-white/40 italic">Arc: {c.arc}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Hook + comparables */}
              <div className="grid md:grid-cols-2 gap-6">
                <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.03] p-6">
                  <h3 className="text-base font-black mb-2 flex items-center gap-2 text-amber-300">
                    <Zap className="h-4 w-4" /> Pilot Hook
                  </h3>
                  <p className="text-sm text-white/70">{concept.pilotHook}</p>
                </section>
                {concept.comparables?.length > 0 && (
                  <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                    <h3 className="text-base font-black mb-2 text-white/80">Comparables</h3>
                    <ul className="space-y-1">
                      {concept.comparables.map((c, i) => (
                        <li key={i} className="text-sm text-white/55">• {c}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>

              <button
                type="button"
                onClick={() => { setConcept(null); setIdea(""); setGenre(""); }}
                className="w-full py-3 rounded-xl font-bold border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors"
              >
                Develop Another Concept
              </button>
            </div>
          )
        ) : (
          /* ── Clip detector tab ── */
          !detection ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 md:p-8 max-w-3xl mx-auto">
              <label className="block text-xs font-bold uppercase tracking-widest text-white/40 mb-3">
                Stream / VOD URL <span className="text-white/25 normal-case">(optional)</span>
              </label>
              <input
                value={streamUrl}
                onChange={(e) => setStreamUrl(e.target.value)}
                placeholder="https://twitch.tv/videos/… or youtube.com/watch?v=…"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-amber-400/50 mb-6"
              />

              <label className="block text-xs font-bold uppercase tracking-widest text-white/40 mb-3">
                Describe the stream
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What happened? Big plays, funny fails, rage moments, wholesome bits — walk me through the stream like you're telling a friend. Include roughly when things happened if you remember."
                rows={8}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-amber-400/50"
              />
              <div className="text-xs mt-2 mb-6 text-white/30">
                {description.trim().length} characters {description.trim().length < 50 ? "(need 50+)" : "✓"}
              </div>

              <button
                type="button"
                onClick={detectClips}
                disabled={!canDetectClips}
                className="w-full py-4 rounded-xl font-black text-black bg-gradient-to-r from-amber-300 to-yellow-500 hover:from-amber-200 hover:to-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {clipLoading ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Finding your highlights…</>
                ) : (
                  <><Scissors className="h-5 w-5" /> Detect Highlights — {CLIP_DETECT_CREDITS} credits</>
                )}
              </button>
              {!user && (
                <p className="text-center text-xs text-white/30 mt-3">Sign in to detect highlights.</p>
              )}
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl mx-auto">
              {/* Summary */}
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-6">
                <h3 className="text-lg font-black mb-2 flex items-center gap-2">
                  <MessageSquareText className="h-5 w-5 text-amber-400" /> Stream Summary
                </h3>
                <p className="text-white/70 text-sm leading-relaxed">{detection.streamSummary}</p>
              </div>

              {/* Clips */}
              <section>
                <h3 className="text-lg font-black mb-4 flex items-center gap-2">
                  <Scissors className="h-5 w-5 text-amber-400" /> Clip-Worthy Moments ({detection.clips?.length ?? 0})
                </h3>
                <div className="space-y-3">
                  {(detection.clips ?? []).map((clip, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                        <div className="font-bold text-white/90">{clip.title}</div>
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${categoryBadge(clip.category)}`}>
                          {clip.category.replace("-", " ")}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-white/50 mb-2">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-amber-400/70" /> ~{clip.timestamp} ({clip.durationSec}s clip)
                        </span>
                        <span className={`flex items-center gap-1 font-bold ${viralityColor(clip.viralityScore)}`}>
                          <TrendingUp className="h-3.5 w-3.5" /> {clip.viralityScore}/10 virality
                        </span>
                      </div>
                      <p className="text-sm text-amber-200/70 italic mb-2">Hook: "{clip.hook}"</p>
                      <p className="text-xs text-white/40 leading-relaxed">{clip.caption}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Posting strategy */}
              {detection.postingStrategy && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <h3 className="text-base font-black mb-2 flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-amber-400" /> Posting Strategy
                  </h3>
                  <p className="text-sm text-white/60 leading-relaxed">{detection.postingStrategy}</p>
                </section>
              )}

              {detectNote && (
                <p className="text-xs text-white/30 text-center">{detectNote}</p>
              )}

              <button
                type="button"
                onClick={() => { setDetection(null); setDescription(""); setStreamUrl(""); }}
                className="w-full py-3 rounded-xl font-bold border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors"
              >
                Analyze Another Stream
              </button>
            </div>
          )
        )}
      </main>
      <SiteFooter />
      <OutOfCredits />
    </div>
  );
}
