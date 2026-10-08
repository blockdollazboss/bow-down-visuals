import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Loader2, Copy, Check, Download, AlertTriangle, Sparkles,
  Flame, MessagesSquare, Zap, Flag, PenLine, Mic, Scissors, Wand2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { VisualBucsIcon } from "@/components/VisualBucsIcon";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Podcast Guest Question Generator ────────────────────────────────
   Docked inside the podcast flow (/podcast, "Guest Questions" tab).
   AI writes 12-15 interview questions from the guest name + topic + any
   research the user pastes — and the panel is honest that research comes
   ONLY from what the user pastes (no web lookup, no invented facts).
   Chain: Send to Script Writer (prefilled) → Teleprompter there · Generate
   intro (podcast-intro API, guest baked into the tagline) · after the
   interview: show notes + audiogram. 75 Visual Bucs per set. */

interface QuestionItem {
  question: string;
  why: string;
}

interface QuestionsResult {
  guestName: string;
  topic: string;
  warmup: QuestionItem[];
  deepDive: QuestionItem[];
  rapidFire: QuestionItem[];
  closer: QuestionItem[];
  total: number;
  creditsUsed?: number;
  creditsRemaining?: number;
}

interface IntroStyle {
  id: string;
  label: string;
  blurb: string;
}

interface IntroResult {
  url: string;
  creditsRemaining?: number;
}

interface NotesResult {
  episodeTitle: string;
  notes: unknown;
  creditsRemaining?: number;
}

interface AudiogramResult {
  url: string;
  creditsRemaining?: number;
}

const QUESTION_COST = 75;
const INTRO_COST = 300;
const SHOW_NOTES_COST = 100;
const AUDIOGRAM_COST = 250;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const SECTIONS = [
  { key: "warmup", icon: Flame },
  { key: "deepDive", icon: MessagesSquare },
  { key: "rapidFire", icon: Zap },
  { key: "closer", icon: Flag },
] as const;

export default function GuestQuestions({ guestName: prefillGuest }: { guestName?: string }) {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [guestName, setGuestName] = useState(prefillGuest ?? "");
  const [topic, setTopic] = useState("");
  const [bio, setBio] = useState("");

  const [result, setResult] = useState<QuestionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copied, setCopied] = useState(false);

  /* ── intro handoff ── */
  const [introOpen, setIntroOpen] = useState(false);
  const [podcastName, setPodcastName] = useState("");
  const [hostName, setHostName] = useState("");
  const [tagline, setTagline] = useState("");
  const [introStyles, setIntroStyles] = useState<IntroStyle[]>([]);
  const [musicStyle, setMusicStyle] = useState("upbeat");
  const [introLoading, setIntroLoading] = useState(false);
  const [introError, setIntroError] = useState<string | null>(null);
  const [introResult, setIntroResult] = useState<IntroResult | null>(null);

  /* ── post-interview handoffs ── */
  const [postOpen, setPostOpen] = useState(false);
  const [notesTitle, setNotesTitle] = useState("");
  const [notesTranscript, setNotesTranscript] = useState("");
  const [notesAudioUrl, setNotesAudioUrl] = useState("");
  const [notesContext, setNotesContext] = useState("");
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notesResult, setNotesResult] = useState<NotesResult | null>(null);

  const [agAudioUrl, setAgAudioUrl] = useState("");
  const [agCoverUrl, setAgCoverUrl] = useState("");
  const [agColor, setAgColor] = useState("gold");
  const [agLoading, setAgLoading] = useState(false);
  const [agError, setAgError] = useState<string | null>(null);
  const [agResult, setAgResult] = useState<AudiogramResult | null>(null);

  /* Prefill tagline/context once a question set exists. */
  useEffect(() => {
    if (!result) return;
    const line = `${result.guestName} on ${result.topic}`;
    if (!tagline) setTagline(`A conversation with ${line}`);
    if (!notesTitle) setNotesTitle(`Interview: ${line}`);
    if (!notesContext) setNotesContext(`Episode topic: ${result.topic}. Guest research summary:\n${result.warmup.concat(result.deepDive).slice(0, 4).map((q, i) => `${i + 1}. ${q.question}`).join("\n")}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  /* Load intro music styles (no cost) when the intro card opens. */
  useEffect(() => {
    if (!introOpen || introStyles.length > 0 || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/podcast-intro-styles", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await res.json().catch(() => ({}))) as { styles?: IntroStyle[] };
        if (!cancelled && Array.isArray(data.styles)) setIntroStyles(data.styles);
      } catch {
        /* styles fall back to the default list */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [introOpen, introStyles.length, user, getAccessToken]);

  async function generate() {
    if (loading || !user) return;
    if (!guestName.trim()) {
      setError(t("podcast.guestQuestions.errors.guestRequired"));
      return;
    }
    if (!topic.trim()) {
      setError(t("podcast.guestQuestions.errors.topicRequired"));
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const res = await confirmedFetch("/api/guest-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName: guestName.trim(),
          topic: topic.trim(),
          bio: bio.trim(),
        }),
        overrideCost: QUESTION_COST,
        overrideFeature: t("podcast.guestQuestions.form.title"),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as QuestionsResult & {
        error?: string;
        message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.warmup)) {
        throw new Error(data.message || data.error || t("podcast.guestQuestions.errors.generationFailed"));
      }
      setResult(data);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("podcast.guestQuestions.errors.generationFailed"));
    } finally {
      setLoading(false);
    }
  }

  function toPlainText(): string {
    if (!result) return "";
    const lines = [
      `${t("podcast.guestQuestions.results.forGuest", { guest: result.guestName }).toUpperCase()}`,
      `${t("podcast.guestQuestions.results.aboutTopic", { topic: result.topic })}`,
      "",
    ];
    for (const s of SECTIONS) {
      lines.push(t(`podcast.guestQuestions.sections.${s.key}`).toUpperCase());
      (result[s.key] as QuestionItem[]).forEach((q, i) => {
        lines.push(`${i + 1}. ${q.question}`);
        lines.push(`   ${t("podcast.guestQuestions.sections.whyLabel")}: ${q.why}`);
      });
      lines.push("");
    }
    return lines.join("\n");
  }

  function copyAll() {
    const text = toPlainText();
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setError(t("podcast.guestQuestions.errors.copyFailed")),
    );
  }

  function downloadTxt() {
    const text = toPlainText();
    if (!result || !text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `guest-questions-${result.guestName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const scriptWriterUrl =
    result != null
      ? `/script-writer?topic=${encodeURIComponent(
          `Interview with ${result.guestName}: ${result.topic}`.slice(0, 300),
        )}&audience=${encodeURIComponent(result.guestName.slice(0, 200))}`
      : "/script-writer";

  async function generateIntro() {
    if (introLoading || !user) return;
    if (!podcastName.trim() || !hostName.trim()) {
      setIntroError(t("podcast.guestQuestions.errors.introNameRequired"));
      return;
    }
    setIntroLoading(true);
    setIntroError(null);
    setIntroResult(null);
    try {
      const res = await confirmedFetch("/api/podcast-intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          podcastName: podcastName.trim(),
          hostName: hostName.trim(),
          tagline: tagline.trim() || `Featuring ${result?.guestName ?? "this week's guest"}`,
          musicStyle,
        }),
        overrideCost: INTRO_COST,
        overrideFeature: t("podcast.guestQuestions.chain.generateIntro"),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as IntroResult & {
        error?: string;
        message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.url) {
        throw new Error(data.message || data.error || t("podcast.guestQuestions.errors.generationFailed"));
      }
      setIntroResult(data);
      refreshProfile();
    } catch (err) {
      setIntroError(err instanceof Error ? err.message : t("podcast.guestQuestions.errors.generationFailed"));
    } finally {
      setIntroLoading(false);
    }
  }

  async function writeShowNotes() {
    if (notesLoading || !user) return;
    if (!notesTitle.trim() || (!notesTranscript.trim() && !notesAudioUrl.trim())) {
      setNotesError(t("podcast.guestQuestions.errors.notesInputRequired"));
      return;
    }
    setNotesLoading(true);
    setNotesError(null);
    setNotesResult(null);
    try {
      const res = await confirmedFetch("/api/show-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeTitle: notesTitle.trim(),
          transcript: notesTranscript.trim() || undefined,
          audioUrl: notesAudioUrl.trim() || undefined,
          context: notesContext.trim() || undefined,
        }),
        overrideCost: SHOW_NOTES_COST,
        overrideFeature: t("podcast.guestQuestions.chain.writeShowNotes"),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as NotesResult & {
        error?: string;
        message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || data.notes == null) {
        throw new Error(data.message || data.error || t("podcast.guestQuestions.errors.generationFailed"));
      }
      setNotesResult(data);
      refreshProfile();
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : t("podcast.guestQuestions.errors.generationFailed"));
    } finally {
      setNotesLoading(false);
    }
  }

  async function makeAudiogram() {
    if (agLoading || !user) return;
    if (!agAudioUrl.trim() || !agCoverUrl.trim()) {
      setAgError(t("podcast.guestQuestions.errors.audiogramInputRequired"));
      return;
    }
    setAgLoading(true);
    setAgError(null);
    setAgResult(null);
    try {
      const res = await confirmedFetch("/api/audiogram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrl: agAudioUrl.trim(),
          coverUrl: agCoverUrl.trim(),
          waveColor: agColor,
        }),
        overrideCost: AUDIOGRAM_COST,
        overrideFeature: t("podcast.guestQuestions.chain.makeAudiogram"),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as AudiogramResult & {
        error?: string;
        message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.url) {
        throw new Error(data.message || data.error || t("podcast.guestQuestions.errors.generationFailed"));
      }
      setAgResult(data);
      refreshProfile();
    } catch (err) {
      setAgError(err instanceof Error ? err.message : t("podcast.guestQuestions.errors.generationFailed"));
    } finally {
      setAgLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {outOfCredits && <OutOfCredits />}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── input ── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/70">
          <Sparkles className="h-4 w-4 text-primary" />
          {t("podcast.guestQuestions.form.title")}
        </h2>
        <p className="mb-4 text-xs leading-relaxed text-white/40">
          {t("podcast.guestQuestions.form.subtitle")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/60">
              {t("podcast.guestQuestions.form.guestNameLabel")}
            </label>
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              maxLength={100}
              placeholder={t("podcast.guestQuestions.form.guestNamePh")}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/60">
              {t("podcast.guestQuestions.form.topicLabel")}
            </label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={300}
              placeholder={t("podcast.guestQuestions.form.topicPh")}
              className={inputClass}
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-medium text-white/60">
            {t("podcast.guestQuestions.form.bioLabel")}
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder={t("podcast.guestQuestions.form.bioPh")}
            className={`${inputClass} resize-y`}
          />
          <p className="mt-1.5 text-xs text-white/35">
            {t("podcast.guestQuestions.form.honestyNote")}
          </p>
        </div>
        <button
          onClick={generate}
          disabled={loading || !user}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-base font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("podcast.guestQuestions.form.generating")}
            </>
          ) : (
            <>
              <Sparkles className="h-5 w-5" />
              {t("podcast.guestQuestions.form.generate")} ·
              <span className="inline-flex items-center gap-1">
                <VisualBucsIcon className="h-4 w-4" /> {QUESTION_COST}
              </span>
            </>
          )}
        </button>
      </section>

      {/* ── results ── */}
      {result && (
        <section className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">
                {t("podcast.guestQuestions.results.forGuest", { guest: result.guestName })}
              </h2>
              <p className="text-xs text-white/45">
                {t("podcast.guestQuestions.results.aboutTopic", { topic: result.topic })} ·{" "}
                {t("podcast.guestQuestions.results.questionsCount", { count: result.total })}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs font-medium transition hover:border-primary/50 hover:text-primary"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("podcast.guestQuestions.results.copied") : t("podcast.guestQuestions.results.copyAll")}
              </button>
              <button
                onClick={downloadTxt}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs font-medium transition hover:border-primary/50 hover:text-primary"
              >
                <Download className="h-3.5 w-3.5" />
                {t("podcast.guestQuestions.results.downloadTxt")}
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-5">
            {SECTIONS.map((s) => {
              const items = result[s.key] as QuestionItem[];
              if (items.length === 0) return null;
              return (
                <div key={s.key}>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                    <s.icon className="h-3.5 w-3.5" />
                    {t(`podcast.guestQuestions.sections.${s.key}`)}
                    <span className="text-white/30">· {items.length}</span>
                  </h3>
                  <ol className="space-y-2.5">
                    {items.map((q, i) => (
                      <li key={i} className="rounded-xl border border-white/10 bg-black/40 p-3.5">
                        <p className="text-sm font-medium leading-relaxed text-white">
                          <span className="mr-2 text-primary">{i + 1}.</span>
                          {q.question}
                        </p>
                        {q.why && (
                          <p className="mt-1.5 pl-6 text-xs italic leading-relaxed text-amber-200/70">
                            {t("podcast.guestQuestions.sections.whyLabel")}: {q.why}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>

          {(result.creditsUsed != null || result.creditsRemaining != null) && (
            <p className="mt-4 text-center text-xs text-white/35">
              {t("podcast.guestQuestions.results.creditsNote", {
                used: result.creditsUsed ?? QUESTION_COST,
                remaining: result.creditsRemaining ?? 0,
              })}
            </p>
          )}
        </section>
      )}

      {/* ── the interview chain ── */}
      {result && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/70">
            <Wand2 className="h-4 w-4 text-primary" />
            {t("podcast.guestQuestions.chain.title")}
          </h2>
          <p className="mb-4 text-xs text-white/40">
            {t("podcast.guestQuestions.chain.subtitle")}
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <Link
              href={scriptWriterUrl}
              className="group rounded-xl border border-white/10 bg-black/40 p-4 text-left transition hover:border-primary/50"
            >
              <PenLine className="mb-2 h-5 w-5 text-primary" />
              <div className="text-sm font-semibold group-hover:text-primary">
                {t("podcast.guestQuestions.chain.scriptWriter")}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-white/40">
                {t("podcast.guestQuestions.chain.scriptWriterBlurb")}
              </p>
            </Link>

            <button
              onClick={() => setIntroOpen((v) => !v)}
              className="rounded-xl border border-white/10 bg-black/40 p-4 text-left transition hover:border-primary/50"
            >
              <Mic className="mb-2 h-5 w-5 text-primary" />
              <div className="text-sm font-semibold">{t("podcast.guestQuestions.chain.generateIntro")}</div>
              <p className="mt-1 text-xs leading-relaxed text-white/40">
                {t("podcast.guestQuestions.chain.generateIntroBlurb")}
              </p>
            </button>

            <button
              onClick={() => setPostOpen((v) => !v)}
              className="rounded-xl border border-white/10 bg-black/40 p-4 text-left transition hover:border-primary/50"
            >
              <Scissors className="mb-2 h-5 w-5 text-primary" />
              <div className="text-sm font-semibold">{t("podcast.guestQuestions.chain.afterInterview")}</div>
              <p className="mt-1 text-xs leading-relaxed text-white/40">
                {t("podcast.guestQuestions.chain.afterInterviewBlurb")}
              </p>
            </button>
          </div>

          {/* intro panel */}
          {introOpen && (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/40 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={podcastName}
                  onChange={(e) => setPodcastName(e.target.value)}
                  maxLength={80}
                  placeholder={t("podcast.guestQuestions.chain.introPodcastName")}
                  className={inputClass}
                />
                <input
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  maxLength={80}
                  placeholder={t("podcast.guestQuestions.chain.introHostName")}
                  className={inputClass}
                />
              </div>
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                maxLength={200}
                placeholder={t("podcast.guestQuestions.chain.introTaglinePh")}
                className={`${inputClass} mt-3`}
              />
              <div className="mt-3">
                <label className="mb-1.5 block text-xs font-medium text-white/60">
                  {t("podcast.guestQuestions.chain.introStyle")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {(introStyles.length > 0
                    ? introStyles
                    : [
                        { id: "upbeat", label: "Upbeat Pop", blurb: "" },
                        { id: "chill", label: "Chill Lo-Fi", blurb: "" },
                        { id: "epic", label: "Epic Cinematic", blurb: "" },
                        { id: "corporate", label: "Corporate Clean", blurb: "" },
                        { id: "jazz", label: "Smooth Jazz", blurb: "" },
                        { id: "electronic", label: "Electronic Drive", blurb: "" },
                      ]
                  ).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setMusicStyle(s.id)}
                      title={s.blurb}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        musicStyle === s.id
                          ? "border-primary bg-primary text-black"
                          : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              {introError && (
                <p className="mt-3 text-xs text-red-300">{introError}</p>
              )}
              <button
                onClick={generateIntro}
                disabled={introLoading || !user}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {introLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
                {t("podcast.guestQuestions.chain.introGenerate", { cost: INTRO_COST })}
              </button>
              {introResult?.url && (
                <div className="mt-3">
                  <audio controls src={introResult.url} className="w-full" />
                  <a
                    href={introResult.url}
                    download="podcast-intro.mp3"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary underline"
                  >
                    <Download className="h-3.5 w-3.5" /> MP3
                  </a>
                </div>
              )}
            </div>
          )}

          {/* post-interview panel */}
          {postOpen && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/60">
                  {t("podcast.guestQuestions.chain.writeShowNotes")}
                </h3>
                <input
                  value={notesTitle}
                  onChange={(e) => setNotesTitle(e.target.value)}
                  maxLength={300}
                  placeholder={t("podcast.guestQuestions.chain.showNotesTitle")}
                  className={inputClass}
                />
                <textarea
                  value={notesTranscript}
                  onChange={(e) => setNotesTranscript(e.target.value)}
                  rows={4}
                  placeholder={t("podcast.guestQuestions.chain.showNotesTranscript")}
                  className={`${inputClass} mt-3 resize-y`}
                />
                <input
                  value={notesAudioUrl}
                  onChange={(e) => setNotesAudioUrl(e.target.value)}
                  placeholder={t("podcast.guestQuestions.chain.showNotesAudioUrl")}
                  className={`${inputClass} mt-3`}
                />
                <textarea
                  value={notesContext}
                  onChange={(e) => setNotesContext(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder={t("podcast.guestQuestions.chain.showNotesContext")}
                  className={`${inputClass} mt-3 resize-y`}
                />
                {notesError && <p className="mt-3 text-xs text-red-300">{notesError}</p>}
                <button
                  onClick={writeShowNotes}
                  disabled={notesLoading || !user}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-6 py-3 text-sm font-bold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {notesLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("podcast.guestQuestions.chain.showNotesGenerate", { cost: SHOW_NOTES_COST })}
                </button>
                {notesResult?.notes != null && (
                  <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/60 p-3 text-xs leading-relaxed text-white/70">
                    {typeof notesResult.notes === "string"
                      ? notesResult.notes
                      : JSON.stringify(notesResult.notes, null, 2)}
                  </pre>
                )}
              </div>

              <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/60">
                  {t("podcast.guestQuestions.chain.makeAudiogram")}
                </h3>
                <input
                  value={agAudioUrl}
                  onChange={(e) => setAgAudioUrl(e.target.value)}
                  placeholder={t("podcast.guestQuestions.chain.audiogramAudioUrl")}
                  className={inputClass}
                />
                <input
                  value={agCoverUrl}
                  onChange={(e) => setAgCoverUrl(e.target.value)}
                  placeholder={t("podcast.guestQuestions.chain.audiogramCoverUrl")}
                  className={`${inputClass} mt-3`}
                />
                <div className="mt-3">
                  <label className="mb-1.5 block text-xs font-medium text-white/60">
                    {t("podcast.guestQuestions.chain.audiogramWaveColor")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {["gold", "white", "cyan", "pink", "green"].map((c) => (
                      <button
                        key={c}
                        onClick={() => setAgColor(c)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition ${
                          agColor === c
                            ? "border-primary bg-primary text-black"
                            : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                {agError && <p className="mt-3 text-xs text-red-300">{agError}</p>}
                <button
                  onClick={makeAudiogram}
                  disabled={agLoading || !user}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-6 py-3 text-sm font-bold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {agLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("podcast.guestQuestions.chain.audiogramGenerate", { cost: AUDIOGRAM_COST })}
                </button>
                {agResult?.url && (
                  <video controls src={agResult.url} className="mt-3 w-full rounded-lg" playsInline />
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {!user && (
        <p className="text-center text-sm text-white/40">
          <Link href="/login" className="text-primary underline">{t("podcast.generate.signIn")}</Link>{" "}
          {t("podcast.generate.signInPrompt")}
        </p>
      )}
    </div>
  );
}
