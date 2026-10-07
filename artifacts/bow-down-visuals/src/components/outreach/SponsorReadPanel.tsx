import { useState } from "react";
import { useLocation } from "wouter";
import {
  Megaphone, Loader2, Sparkles, Copy, Check, Mic, FileText, Timer, X, Plus,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";

/* ─── Sponsor Read Generator panel ────────────────────────────────────────
   Mounted INSIDE the Sponsorship Outreach page (/sponsorship-outreach) as a
   panel — the outreach kit wins the deal, this writes the actual spoken
   sponsor read for the landed deal. POST /api/sponsor-read → 100 Visual
   Bucs per read. Handoff chain: generated read → Send to Voiceover Pro
   (/voiceover, script prefilled via localStorage handoff) or Add to script
   drafts (POST /api/drafts, workflowType "sponsorship-outreach"). */

const READ_COST = 100;

const READ_LENGTHS = ["30", "60", "90"] as const;
const TONES = ["energetic", "casual", "luxury", "humorous"] as const;

const TONE_KEYS: Record<(typeof TONES)[number], string> = {
  energetic: "outreach.sponsorReadToneEnergetic",
  casual: "outreach.sponsorReadToneCasual",
  luxury: "outreach.sponsorReadToneLuxury",
  humorous: "outreach.sponsorReadToneHumorous",
};

interface SponsorRead {
  script: string;
  hookLine: string;
  ctaLine: string;
  estimatedSeconds: number;
}

interface SponsorReadResponse {
  read?: SponsorRead;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

/* LocalStorage handoff the /voiceover page reads on mount to prefill the
   script box (see voiceover.tsx). */
export const SPONSOR_READ_HANDOFF_KEY = "bdv_sponsor_read_handoff";

export interface SponsorReadHandoff {
  script: string;
  brandName: string;
  createdAt: number;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/50";

const pillClass = (active: boolean) =>
  `rounded-full px-4 py-2 text-sm font-semibold transition border ${
    active
      ? "bg-primary text-black border-primary shadow-[0_0_18px_rgba(212,175,55,0.35)]"
      : "bg-white/[0.03] text-white/60 border-white/10 hover:text-white hover:border-white/25"
  }`;

function stripCues(script: string): string {
  return script.replace(/\[(?:PAUSE|EMPHASIS)\]/gi, "").replace(/[ \t]{2,}/g, " ").trim();
}

export default function SponsorReadPanel() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [, navigate] = useLocation();

  const [brandName, setBrandName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [readLength, setReadLength] = useState<(typeof READ_LENGTHS)[number]>("30");
  const [tone, setTone] = useState<(typeof TONES)[number]>("energetic");
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [pointDraft, setPointDraft] = useState("");

  const [read, setRead] = useState<SponsorRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function addPoint() {
    const v = pointDraft.trim();
    if (!v || keyPoints.length >= 10 || keyPoints.includes(v)) return;
    setKeyPoints((prev) => [...prev, v]);
    setPointDraft("");
  }

  function removePoint(i: number) {
    setKeyPoints((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function generate() {
    if (loading || !user) return;
    if (!brandName.trim() || keyPoints.length === 0) {
      setError(t("outreach.sponsorReadFillRequired"));
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/sponsor-read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: READ_COST,
        overrideFeature: "Sponsor Read",
        body: JSON.stringify({
          brandName: brandName.trim(),
          productDescription: productDescription.trim(),
          readLength,
          tone,
          keyPoints,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as SponsorReadResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.read) {
        throw new Error(data.message || data.error || t("outreach.sponsorReadFailed"));
      }
      setRead(data.read);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("sponsor-read-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("outreach.sponsorReadFailed"));
    } finally {
      setLoading(false);
    }
  }

  function copyScript() {
    if (!read) return;
    const text = `${t("outreach.sponsorReadHook")}: ${read.hookLine}\n\n${read.script}\n\n${t("outreach.sponsorReadCta")}: ${read.ctaLine}`;
    void navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  /* Handoff → Voiceover Pro: prefill the /voiceover script box (cues stripped). */
  function sendToVoiceover() {
    if (!read) return;
    const handoff: SponsorReadHandoff = {
      script: stripCues(read.script),
      brandName: brandName.trim(),
      createdAt: Date.now(),
    };
    try {
      localStorage.setItem(SPONSOR_READ_HANDOFF_KEY, JSON.stringify(handoff));
    } catch {
      /* storage unavailable — still navigate; the script box just won't prefill */
    }
    setNotice(t("outreach.sponsorReadVoiceoverSent"));
    setTimeout(() => navigate("/voiceover"), 600);
  }

  /* Handoff → script drafts: saved where the user's other script work lives. */
  async function addToScriptDrafts() {
    if (!read || saving || !user) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          workflowType: "sponsorship-outreach",
          title: `Sponsor read: ${brandName.trim()}`,
          draftData: {
            type: "sponsor-read",
            brandName: brandName.trim(),
            productDescription: productDescription.trim(),
            readLength,
            tone,
            keyPoints,
            read,
            createdAt: new Date().toISOString(),
          },
        }),
      });
      if (!res.ok) throw new Error(t("outreach.sponsorReadSaveFailed"));
      setNotice(t("outreach.sponsorReadSaved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("outreach.sponsorReadSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="relative mt-12 rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.07] to-transparent p-6 md:p-8">
      {/* header */}
      <div className="text-center">
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
          <Megaphone className="h-3 w-3" aria-hidden="true" /> {t("outreach.sponsorReadBadge")}
        </p>
        <h2 className="font-display text-2xl font-black tracking-tight md:text-3xl">
          {t("outreach.sponsorReadTitle")}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/55">
          {t("outreach.sponsorReadSubtitle")}
        </p>
      </div>

      {/* form */}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="sponsor-read-brand">{t("outreach.sponsorReadBrandLabel")}</label>
            <input
              id="sponsor-read-brand"
              className={inputClass}
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder={t("outreach.sponsorReadBrandPlaceholder")}
              maxLength={100}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="sponsor-read-product">{t("outreach.sponsorReadProductLabel")}</label>
            <textarea
              id="sponsor-read-product"
              className={inputClass}
              rows={3}
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              placeholder={t("outreach.sponsorReadProductPlaceholder")}
              maxLength={500}
            />
          </div>
          <div>
            <span className={labelClass}>{t("outreach.sponsorReadLengthLabel")}</span>
            <div className="flex flex-wrap gap-2">
              {READ_LENGTHS.map((len) => (
                <button key={len} type="button" onClick={() => setReadLength(len)} className={pillClass(readLength === len)}>
                  {len}s
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className={labelClass}>{t("outreach.sponsorReadToneLabel")}</span>
            <div className="flex flex-wrap gap-2">
              {TONES.map((tn) => (
                <button key={tn} type="button" onClick={() => setTone(tn)} className={pillClass(tone === tn)}>
                  {t(TONE_KEYS[tn])}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="sponsor-read-point">{t("outreach.sponsorReadPointsLabel")}</label>
          <div className="flex gap-2">
            <input
              id="sponsor-read-point"
              className={inputClass}
              value={pointDraft}
              onChange={(e) => setPointDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPoint();
                }
              }}
              placeholder={t("outreach.sponsorReadPointsPlaceholder")}
              maxLength={200}
            />
            <button
              type="button"
              onClick={addPoint}
              disabled={!pointDraft.trim() || keyPoints.length >= 10}
              className="shrink-0 rounded-xl border border-primary/40 bg-primary/10 px-4 text-sm font-bold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t("outreach.sponsorReadPointsLabel")}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-xs text-white/40">{t("outreach.sponsorReadPointsHint")}</p>
          {keyPoints.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {keyPoints.map((p, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.08] px-3 py-1.5 text-xs font-medium text-white/80"
                >
                  {p}
                  <button
                    type="button"
                    onClick={() => removePoint(i)}
                    className="text-white/40 transition hover:text-red-400"
                    aria-label={`Remove ${p}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* CTA */}
      <div className="mt-8 text-center">
        <button
          onClick={generate}
          disabled={loading || !user}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-bold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? t("outreach.sponsorReadWriting") : t("outreach.sponsorReadGenerate", { cost: READ_COST })}
        </button>
        {!user && <p className="mt-3 text-xs text-white/40">{t("outreach.signInPrompt")}</p>}
        {error && <p className="mx-auto mt-4 max-w-md text-sm text-red-400">{error}</p>}
        {notice && <p className="mx-auto mt-4 max-w-md text-sm text-emerald-400">{notice}</p>}
        {outOfCredits && (
          <div className="mx-auto mt-4 max-w-md">
            <OutOfCredits />
          </div>
        )}
      </div>

      {/* results */}
      {read && (
        <div id="sponsor-read-results" className="mt-10 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
              <Megaphone className="h-4 w-4" /> {brandName.trim()}
            </h3>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60">
                <Timer className="h-3.5 w-3.5" /> {t("outreach.sponsorReadEstimated", { seconds: read.estimatedSeconds })}
              </span>
              <button
                onClick={copyScript}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-white"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("outreach.copied") : t("outreach.copy")}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/40 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">{t("outreach.sponsorReadHook")}</p>
            <p className="mt-2 text-base font-semibold leading-relaxed text-white">{read.hookLine}</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/40 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">{t("outreach.sponsorReadScript")}</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/80">{read.script}</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/40 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">{t("outreach.sponsorReadCta")}</p>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-white">{read.ctaLine}</p>
          </div>

          {/* handoff chain */}
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={sendToVoiceover}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110"
            >
              <Mic className="h-4 w-4" /> {t("outreach.sponsorReadVoiceover")}
            </button>
            <button
              onClick={addToScriptDrafts}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-6 py-3 text-sm font-bold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {t("outreach.sponsorReadAddScript")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
