import { useState } from "react";
import { Link } from "wouter";
import {
  Megaphone, Loader2, Copy, Check, Sparkles, ArrowLeft, Hash,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { SITE_FEATURES } from "@/data/features";

/* ─── Promo Content Generator ─────────────────────────────────────────────
   Pick a feature, pick a format and tone, and get ready-to-post marketing
   copy: social posts, email blasts, banner headlines, ad copy — with
   hashtags and CTAs included. POSTs to /api/promo-generator at 1 credit
   per generation on GPT-6 Sol. Content-type and tone keys must stay in sync
   with the backend route's CONTENT_TYPES / TONES enums. */

type ContentTypeKey = "twitter" | "instagram" | "tiktok" | "email" | "banner" | "ad";
type ToneKey = "hype" | "professional" | "funny" | "luxury";

interface ContentType {
  key: ContentTypeKey;
  label: string;
  blurb: string;
}

const CONTENT_TYPES: ContentType[] = [
  { key: "twitter", label: "X Post", blurb: "Punchy post built for reposts" },
  { key: "instagram", label: "IG Caption", blurb: "Engaging caption + hashtags" },
  { key: "tiktok", label: "TikTok Script", blurb: "Hook + beats, spoken style" },
  { key: "email", label: "Email Blast", blurb: "Subject line + short body" },
  { key: "banner", label: "Banner Headlines", blurb: "5 scroll-stoppers" },
  { key: "ad", label: "Ad Copy", blurb: "Headlines + primary text" },
];

interface Tone {
  key: ToneKey;
  label: string;
}

const TONES: Tone[] = [
  { key: "hype", label: "Hype" },
  { key: "professional", label: "Professional" },
  { key: "funny", label: "Funny" },
  { key: "luxury", label: "Luxury" },
];

const CREDIT_COST = 1;

interface PromoResponse {
  title?: string;
  body?: string;
  extras?: string[];
  hashtags?: string[];
  cta?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard unavailable — user can still select manually */
        }
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white"
      aria-label={`Copy ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function ResultBlock({ label, text }: { label: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-black/50 p-5">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-widest text-primary">{label}</span>
        <CopyButton text={text} label={label} />
      </div>
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/90">{text}</p>
    </div>
  );
}

export default function Promote() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [featureKey, setFeatureKey] = useState(SITE_FEATURES[0]!.key);
  const [contentType, setContentType] = useState<ContentTypeKey>("twitter");
  const [tone, setTone] = useState<ToneKey>("hype");
  const [focus, setFocus] = useState("");
  const [result, setResult] = useState<PromoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const feature = SITE_FEATURES.find((f) => f.key === featureKey) ?? SITE_FEATURES[0]!;
  const FeatureIcon: LucideIcon = feature.icon;

  async function generate() {
    if (loading || !user) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/promo-generator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          featureName: feature.name,
          featureTagline: feature.tagline,
          featureRoute: feature.route,
          contentType,
          tone,
          focus: focus.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as PromoResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || (!data.title && !data.body)) {
        throw new Error(data.message || data.error || "Promo generation failed — try again.");
      }
      setResult(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("promo-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Promo generation failed — try again.");
    } finally {
      setLoading(false);
    }
  }

  const pill = (active: boolean) =>
    "rounded-xl px-4 py-2.5 text-sm font-semibold transition border " +
    (active
      ? "border-primary/60 bg-primary/15 text-white"
      : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white");

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 55% at 50% -5%, rgba(212,175,55,0.14), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-4xl px-5 md:px-8 pt-14 md:pt-20 pb-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <Megaphone className="h-3.5 w-3.5" />
            Promo Content Generator
          </div>
          <h1 className="mt-6 text-4xl md:text-5xl font-extrabold tracking-tight">
            Market every feature{" "}
            <span className="bg-gradient-to-r from-amber-200 via-primary to-amber-200 bg-clip-text text-transparent">
              like a launch
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-white/60">
            Pick a feature, pick a format and tone — get ready-to-post copy with
            hashtags and CTAs. {CREDIT_COST} credit per generation.
          </p>
          <Link href="/features">
            <span className="mt-4 inline-flex cursor-pointer items-center gap-1.5 text-sm text-white/40 transition hover:text-primary">
              <ArrowLeft className="h-4 w-4" /> Back to all features
            </span>
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 md:px-8 pb-20">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-6 md:p-8">
          {/* Feature picker */}
          <label className="text-xs font-bold uppercase tracking-widest text-white/45">
            Feature to promote
          </label>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-gradient-to-br from-amber-400/25 to-yellow-600/10">
              <FeatureIcon className="h-5 w-5 text-primary" />
            </div>
            <select
              value={featureKey}
              onChange={(e) => setFeatureKey(e.target.value)}
              className={`${inputClass} cursor-pointer appearance-none`}
            >
              {SITE_FEATURES.map((f) => (
                <option key={f.key} value={f.key} className="bg-black">
                  {f.name} — {f.tagline}
                </option>
              ))}
            </select>
          </div>

          {/* Content type */}
          <label className="mt-7 block text-xs font-bold uppercase tracking-widest text-white/45">
            Content type
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CONTENT_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setContentType(t.key)}
                className={pill(contentType === t.key) + " text-left"}
              >
                <div className="font-semibold">{t.label}</div>
                <div className="mt-0.5 text-xs font-normal text-white/40">{t.blurb}</div>
              </button>
            ))}
          </div>

          {/* Tone */}
          <label className="mt-7 block text-xs font-bold uppercase tracking-widest text-white/45">
            Tone
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button key={t.key} onClick={() => setTone(t.key)} className={pill(tone === t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Focus */}
          <label className="mt-7 block text-xs font-bold uppercase tracking-widest text-white/45">
            Angle to emphasize <span className="normal-case text-white/30">(optional)</span>
          </label>
          <input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="e.g. the 1-credit price, how fast it is, perfect for new artists…"
            maxLength={300}
            className={`${inputClass} mt-2`}
          />

          {error && (
            <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {outOfCredits ? (
            <div className="mt-6">
              <OutOfCredits />
            </div>
          ) : !user ? (
            <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center">
              <p className="text-white/70">Sign in to generate promo content.</p>
              <Link href="/login">
                <span className="mt-3 inline-block cursor-pointer rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110">
                  Sign In
                </span>
              </Link>
            </div>
          ) : (
            <button
              onClick={generate}
              disabled={loading}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-3.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Writing your promo…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Generate promo · {CREDIT_COST} credit
                </>
              )}
            </button>
          )}
        </div>

        {/* Results */}
        {result && (
          <div id="promo-results" className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">
                Your promo for <span className="text-primary">{feature.name}</span>
              </h2>
              <button
                onClick={generate}
                disabled={loading}
                className="text-sm font-semibold text-white/50 transition hover:text-primary disabled:opacity-50"
              >
                Regenerate
              </button>
            </div>
            <div className="space-y-4">
              {result.title && <ResultBlock label="Headline" text={result.title} />}
              {result.body && <ResultBlock label="Copy" text={result.body} />}
              {(result.extras ?? []).map((ex, i) => (
                <ResultBlock key={i} label={`Alternate ${i + 1}`} text={ex} />
              ))}
              {result.cta && <ResultBlock label="Call to action" text={result.cta} />}
              {(result.hashtags ?? []).length > 0 && (
                <div className="rounded-xl border border-white/10 bg-black/50 p-5">
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary">
                      <Hash className="h-3.5 w-3.5" /> Hashtags
                    </span>
                    <CopyButton
                      text={(result.hashtags ?? []).map((h) => `#${h}`).join(" ")}
                      label="hashtags"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(result.hashtags ?? []).map((h) => (
                      <span
                        key={h}
                        className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                      >
                        #{h}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <SiteFooter />
    </div>
  );
}
