import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  Upload, Loader2, AlertTriangle, CheckCircle2, ArrowLeft,
  Trophy, Sparkles, RefreshCw, X, Image as ImageIcon, Wand2,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { scoreBand, scoreBandClass, filterImageFiles } from "@/lib/thumbnail-test";

/* ─── Thumbnail A/B Tester ────────────────────────────────────────────────
   Upload 2-4 thumbnail variants, AI predicts which one gets the most clicks
   and explains why. 2 credits per test (vision analysis — it burns GPU, so
   it charges). Honest framing throughout: this is a PREDICTION based on
   thumbnail best practices, not a guarantee of real click-through. */

const CREDIT_COST = 2;
const IMPROVE_COST = 2;
const MAX_FILES = 4;
const MIN_FILES = 2;

interface Scores {
  curiosityGap: number;
  readability: number;
  emotionalImpact: number;
  colorContrast: number;
  facePresence: number;
  overall: number;
}

interface Analysis {
  index: number;
  scores: Scores;
  strengths: string[];
  weaknesses: string[];
  tips: string[];
}

interface TestResult {
  analyses: Analysis[];
  winnerIndex: number;
  confidence: number;
  reasoning: string;
  disclaimer: string;
}

const SCORE_LABELS: Array<{ key: keyof Scores; label: string }> = [
  { key: "curiosityGap", label: "Curiosity gap" },
  { key: "readability", label: "Small-size readability" },
  { key: "emotionalImpact", label: "Emotional impact" },
  { key: "colorContrast", label: "Color contrast" },
  { key: "facePresence", label: "Face presence" },
];

function scoreColor(v: number): string {
  return scoreBandClass(scoreBand(v));
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-200 font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full ${scoreColor(value)}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export default function ThumbnailTest() {
  const { user } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [niche, setNiche] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [improving, setImproving] = useState<number | null>(null);
  const [improvedUrls, setImprovedUrls] = useState<Record<number, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | File[]) {
    const combined = [...files, ...filterImageFiles(Array.from(list), MAX_FILES)].slice(0, MAX_FILES);
    setFiles(combined);
    setPreviews(combined.map((f) => URL.createObjectURL(f)));
    setResult(null);
    setError(null);
  }

  function removeFile(i: number) {
    const next = files.filter((_, idx) => idx !== i);
    setFiles(next);
    setPreviews(next.map((f) => URL.createObjectURL(f)));
    setResult(null);
  }

  async function runTest() {
    if (files.length < MIN_FILES || testing) return;
    setTesting(true);
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("thumbnails", f));
      if (title.trim()) form.append("title", title.trim());
      if (niche.trim()) form.append("niche", niche.trim());
      const res = await fetch("/api/thumbnail-test", { method: "POST", body: form });
      const data = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || "Test failed");
      setResult(data.result as TestResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  async function applySuggestions(index: number) {
    const analysis = result?.analyses[index];
    if (!analysis || improving !== null) return;
    setImproving(index);
    setError(null);
    try {
      const form = new FormData();
      form.append("thumbnail", files[index]!);
      form.append("tips", analysis.tips.join("\n"));
      const res = await fetch("/api/thumbnail-test/improve", { method: "POST", body: form });
      const data = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || "Could not generate the improved version");
      setImprovedUrls((prev) => ({ ...prev, [index]: data.imageUrl as string }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Improve failed");
    } finally {
      setImproving(null);
    }
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <MarketingNav />
      <main className="max-w-6xl mx-auto px-4 py-10">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-amber-400/80 hover:text-amber-300 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <Trophy className="w-8 h-8 text-amber-400" />
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-amber-200 via-amber-400 to-amber-200 bg-clip-text text-transparent">
            Thumbnail A/B Tester
          </h1>
        </div>
        <p className="text-zinc-400 max-w-2xl mb-8">
          Upload 2–4 thumbnail variants. AI scores each one on what actually drives clicks —
          curiosity, readability, emotion, contrast — and predicts your winner with specific
          fixes for the rest. <span className="text-zinc-500">A prediction based on best practices, not a guarantee.</span>
        </p>

        {outOfCredits && <OutOfCredits />}

        {/* Upload zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors mb-6 ${
            dragOver ? "border-amber-400 bg-amber-400/5" : "border-zinc-800 hover:border-zinc-700 bg-zinc-950"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
          />
          <Upload className="w-8 h-8 text-amber-400 mx-auto mb-3" />
          <p className="text-zinc-300 font-medium">Drop 2–4 thumbnails here, or click to browse</p>
          <p className="text-zinc-500 text-sm mt-1">PNG/JPG/WebP · {files.length}/{MAX_FILES} uploaded</p>
        </div>

        {/* Previews */}
        {previews.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {previews.map((src, i) => (
              <div key={i} className="relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950">
                <img src={src} alt={`Thumbnail ${i + 1}`} className="w-full aspect-video object-cover" />
                <span className="absolute top-2 left-2 text-xs font-bold bg-black/70 text-amber-300 px-2 py-0.5 rounded">
                  {i + 1}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                  className="absolute top-2 right-2 p-1 rounded-full bg-black/70 text-zinc-300 hover:text-red-400"
                  aria-label={`Remove thumbnail ${i + 1}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Context inputs */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Video title (optional — helps the AI judge curiosity)"
            maxLength={200}
            className="rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-3 text-sm placeholder:text-zinc-600 focus:border-amber-400/60 focus:outline-none"
          />
          <input
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="Niche, e.g. hip-hop, gaming, finance (optional)"
            maxLength={100}
            className="rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-3 text-sm placeholder:text-zinc-600 focus:border-amber-400/60 focus:outline-none"
          />
        </div>

        <button
          onClick={runTest}
          disabled={files.length < MIN_FILES || testing || !user}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-3 font-semibold text-black disabled:opacity-40 disabled:cursor-not-allowed hover:from-amber-400 hover:to-amber-500 transition-colors"
        >
          {testing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
          {testing ? "Analyzing…" : `Run test · ${CREDIT_COST} credits`}
        </button>
        {!user && <p className="text-zinc-500 text-sm mt-2">Sign in to run a test.</p>}

        {error && (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <section className="mt-10">
            <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-400/10 to-transparent p-6 mb-8">
              <div className="flex items-center gap-3 mb-2">
                <Trophy className="w-6 h-6 text-amber-400" />
                <h2 className="text-xl font-bold text-amber-200">
                  Predicted winner: Thumbnail {result.winnerIndex + 1}
                </h2>
                <span className="text-xs font-semibold bg-amber-400/20 text-amber-300 px-2 py-1 rounded-full">
                  {result.confidence}% confidence
                </span>
              </div>
              <p className="text-zinc-300 text-sm">{result.reasoning}</p>
              <p className="text-zinc-500 text-xs mt-3 italic">{result.disclaimer}</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {result.analyses.map((a) => {
                const isWinner = a.index === result.winnerIndex;
                return (
                  <div
                    key={a.index}
                    className={`rounded-2xl border p-5 bg-zinc-950 ${
                      isWinner ? "border-amber-400/50" : "border-zinc-800"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-zinc-200">Thumbnail {a.index + 1}</span>
                        {isWinner && (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-300">
                            <CheckCircle2 className="w-4 h-4" /> Winner
                          </span>
                        )}
                      </div>
                      <span className="text-2xl font-black text-amber-300 tabular-nums">{a.scores.overall}</span>
                    </div>
                    {previews[a.index] && (
                      <img
                        src={previews[a.index]}
                        alt={`Thumbnail ${a.index + 1}`}
                        className="w-full aspect-video object-cover rounded-lg border border-zinc-800 mb-4"
                      />
                    )}
                    <div className="space-y-2.5 mb-4">
                      {SCORE_LABELS.map(({ key, label }) => (
                        <ScoreBar key={key} label={label} value={a.scores[key]} />
                      ))}
                    </div>
                    {a.strengths.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-emerald-300 mb-1">Strengths</p>
                        <ul className="text-xs text-zinc-400 list-disc list-inside space-y-0.5">
                          {a.strengths.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {a.weaknesses.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-red-300 mb-1">Weaknesses</p>
                        <ul className="text-xs text-zinc-400 list-disc list-inside space-y-0.5">
                          {a.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {a.tips.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-amber-300 mb-1">Fixes</p>
                        <ul className="text-xs text-zinc-300 list-disc list-inside space-y-0.5">
                          {a.tips.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {improvedUrls[a.index] ? (
                      <div>
                        <p className="text-xs font-semibold text-emerald-300 mb-2">Improved version</p>
                        <img
                          src={improvedUrls[a.index]}
                          alt="Improved thumbnail"
                          className="w-full aspect-video object-cover rounded-lg border border-emerald-800 mb-2"
                        />
                        <a
                          href={improvedUrls[a.index]}
                          download={`thumbnail-${a.index + 1}-improved.png`}
                          className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200"
                        >
                          Download
                        </a>
                      </div>
                    ) : (
                      <button
                        onClick={() => applySuggestions(a.index)}
                        disabled={improving !== null}
                        className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-400/10 disabled:opacity-40 transition-colors"
                      >
                        {improving === a.index ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Wand2 className="w-4 h-4" />
                        )}
                        {improving === a.index ? "Generating…" : `Apply suggestions · ${IMPROVE_COST} credits`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => { setResult(null); setImprovedUrls({}); }}
              className="mt-8 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              <RefreshCw className="w-4 h-4" /> Test different thumbnails
            </button>
          </section>
        )}

        {/* How it works */}
        <section className="mt-12 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <h3 className="font-bold text-zinc-200 mb-3 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-amber-400" /> How the scoring works
          </h3>
          <ul className="text-sm text-zinc-400 space-y-2 list-disc list-inside">
            <li><span className="text-zinc-200">Curiosity gap</span> — does the thumbnail create an open loop you need to click to resolve?</li>
            <li><span className="text-zinc-200">Small-size readability</span> — is any text legible in a mobile feed? (No text scores neutral, not penalized.)</li>
            <li><span className="text-zinc-200">Emotional impact</span> — does it trigger shock, awe, desire, or outrage?</li>
            <li><span className="text-zinc-200">Color contrast</span> — does it pop in a crowded feed?</li>
            <li><span className="text-zinc-200">Face presence</span> — a clear, expressive face boosts clicks. (No face scores neutral.)</li>
          </ul>
          <p className="text-xs text-zinc-500 mt-4">
            2 credits per test · 2 credits per improved render · refunded automatically if the AI fails.
            Scores are AI predictions, not guarantees — your title, audience, and timing matter too.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
