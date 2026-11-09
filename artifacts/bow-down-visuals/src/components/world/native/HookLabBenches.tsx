/**
 * HookLabBenches — the hooks family's remaining rails, native at
 * the Hook Desk (Stack 400 world parity, census B-16 / B-17 /
 * B-20; seams in lib/world/hook-desk.ts):
 *
 *   AiInterviewBench   — B-16, the /hooks page's AI Interview:
 *     5 sharp questions (100 VB) → your answers → clips, quote
 *     cards + a 60s promo outline (200 VB).
 *   OpeningsBench      — B-17, the editor rail's 3-Second Lab
 *     openings: 5 scored alternate openings (200 VB).
 *   DiagnosticsBenches — B-20, the loose diagnostics as one
 *     bench group: Hook Analyzer (75), SEO Score (75),
 *     Retention Doctor (150), Trend Jacker (200), Style
 *     Stealer (200).
 *
 * Every run rides the confirmed-spend seam (useConfirmedApi's
 * confirmedFetch — the registry-priced confirmation stands
 * before anything runs; a decline runs nothing) and every price
 * printed on a bench is the registry's, read live from the
 * seam. Failed generations are refunded server-side; a 402
 * reads as out-of-Visual-Bucs, never as a mystery. Copy rides
 * the twins' own catalog namespaces wherever they exist
 * (aiInterview.* defaults, videoEditor.lab*, retentionDoctor.*,
 * contentIntelligence.*, trendJacker.*, videoEditor.styleStealer*)
 * plus this family's worldHooksBenches.* chrome — the benches'
 * labels can never drift from the pages'.
 */
import { useState } from "react";
import {
  Check,
  Copy,
  Gauge,
  Loader2,
  Mic2,
  Plus,
  Sparkles,
  Stethoscope,
  Timer,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@/lib/api-error";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { DeskSelectField, DeskTextField } from "./CreateDeskLeaf";
import {
  DIAG_PLATFORMS,
  DOCTOR_PLATFORMS,
  DOCTOR_VIDEO_TYPES,
  aiInterviewPackageCost,
  aiInterviewQuestionsCost,
  buildDoctorPayload,
  buildHookAnalysisPayload,
  buildInterviewPackagePayload,
  buildInterviewQuestionsPayload,
  buildOpeningsPayload,
  buildSeoScorePayload,
  buildStyleStealerPayload,
  buildTrendDraftPayload,
  doctorOfResponse,
  doctorReady,
  hookAnalysisOfResponse,
  hookAnalysisReady,
  hookAnalyzerCost,
  interviewPackageOfResponse,
  interviewPackageReady,
  interviewQaPairs,
  interviewQuestionsOfResponse,
  interviewQuestionsReady,
  openingsCost,
  openingsOfResponse,
  openingsReady,
  retentionDoctorCost,
  seoScoreCost,
  seoScoreOfResponse,
  seoScoreReady,
  styleFormulaOfResponse,
  styleStealerCost,
  styleStealerReady,
  trendDraftOfResponse,
  trendDraftReady,
  trendJackerCost,
  type DiagPlatform,
  type DoctorDiagnosis,
  type DoctorDropOffRow,
  type DoctorResult,
  type HookAnalysisMode,
  type HookAnalysisResult,
  type InterviewPackageResult,
  type OpeningResult,
  type SeoScoreResult,
  type StyleFormulaResult,
  type TrendDraftResult,
} from "@/lib/world/hook-desk";

/* ─── Shared bench chrome ─────────────────────────────────────── */

function benchCard(isLight: boolean): string {
  return isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
}

function BenchHeader({
  icon: Icon,
  title,
  cost,
  isLight,
}: {
  icon: LucideIcon;
  title: string;
  cost: number;
  isLight: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
      <p className={`text-base font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{title}</p>
      <span
        className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
          isLight
            ? "border-[#C9A84C]/50 text-[#7A5A12]"
            : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"
        }`}
      >
        {cost} VB
      </span>
    </div>
  );
}

function RunButton({
  busy,
  disabled,
  onClick,
  testId,
  label,
  busyLabel,
}: {
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  testId: string;
  label: string;
  busyLabel: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={busy || disabled}
      className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {busy ? busyLabel : label}
    </button>
  );
}

function BenchNotes({
  note,
  outOfCredits,
  feature,
  isLight,
}: {
  note: string | null;
  outOfCredits: boolean;
  feature: string;
  isLight: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldBenches300.outOfBucs", { feature })}
        </p>
      )}
      {note && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>
      )}
    </>
  );
}

function CopyLine({ text, isLight }: { text: string; isLight: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-start gap-2">
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        aria-label={t("worldCreateMedia.hookCopyLabel")}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(text)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            })
            .catch(() => {});
        }}
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold bdv-touch-box ${
          isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/70"
        }`}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

/** The one confirmed-post shape every bench here shares:
 *  confirmedFetch → null (declined) / 402 / !ok / parsed body. */
function useBenchRunner() {
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();
  return async function run<T>(
    path: string,
    body: Record<string, unknown>,
    parse: (data: unknown) => T | null,
    opts: {
      setBusy: (b: boolean) => void;
      setNote: (n: string | null) => void;
      setOutOfCredits: (b: boolean) => void;
      emptyNote: string;
      hiccupNote: string;
    },
  ): Promise<T | null> {
    opts.setBusy(true);
    opts.setNote(null);
    opts.setOutOfCredits(false);
    try {
      const res = await confirmedFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res) return null; // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        opts.setOutOfCredits(true);
        refreshProfile();
        return null;
      }
      if (!res.ok) {
        opts.setNote(apiErrorMessage(data as { message?: string; error?: string }, opts.hiccupNote));
        return null;
      }
      const parsed = parse(data);
      if (!parsed) {
        opts.setNote(opts.emptyNote);
        return null;
      }
      refreshProfile();
      return parsed;
    } catch {
      opts.setNote(opts.hiccupNote);
      return null;
    } finally {
      opts.setBusy(false);
    }
  };
}

/* ═══ B-16 · AI Interview ═══════════════════════════════════════ */

export function AiInterviewBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const run = useBenchRunner();
  const [topic, setTopic] = useState("");
  const [niche, setNiche] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [pkg, setPkg] = useState<InterviewPackageResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const qCost = aiInterviewQuestionsCost();
  const pkgCost = aiInterviewPackageCost();
  const answeredCount = answers.filter((a) => a.trim()).length;
  const pkgReady = interviewPackageReady(questions, answers);

  const getQuestions = async () => {
    if (busy || !interviewQuestionsReady(topic)) return;
    setPkg(null);
    const got = await run(
      "/api/ai-interview/questions",
      buildInterviewQuestionsPayload({ topic, niche }),
      interviewQuestionsOfResponse,
      {
        setBusy,
        setNote,
        setOutOfCredits,
        emptyNote: t("worldHooksBenches.interviewEmptyQuestions"),
        hiccupNote: t("worldHooksBenches.diagHiccup"),
      },
    );
    if (got) {
      setQuestions(got);
      setAnswers(new Array(got.length).fill(""));
      setCurrentQ(0);
    }
  };

  const buildPackage = async () => {
    if (busy || !pkgReady) return;
    const got = await run(
      "/api/ai-interview/package",
      buildInterviewPackagePayload({ topic, qa: interviewQaPairs(questions, answers) }),
      interviewPackageOfResponse,
      {
        setBusy,
        setNote,
        setOutOfCredits,
        emptyNote: t("worldHooksBenches.interviewEmptyPackage"),
        hiccupNote: t("worldHooksBenches.diagHiccup"),
      },
    );
    if (got) setPkg(got);
  };

  const chipCls = (active: boolean) =>
    `h-2.5 rounded-full transition-all ${
      active ? "w-8 bg-[#d4af37]" : "w-2.5 bg-white/15 hover:bg-white/25"
    }`;

  return (
    <div className="space-y-3" data-testid="world-ai-interview-bench">
      <BenchHeader
        icon={Mic2}
        title={t("worldHooksBenches.interviewTitle")}
        cost={qCost + pkgCost}
        isLight={isLight}
      />
      <p className={`text-xs ${muted}`}>
        {t("aiInterview.desc", {
          defaultValue: "5 sharp questions → your answers → clips, quote cards, promo outline.",
        })}
      </p>

      {questions.length === 0 ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskTextField
              isLight={isLight}
              label={t("aiInterview.topicLabel", { defaultValue: "Interview topic *" })}
              value={topic}
              onChange={setTopic}
              placeholder={t("aiInterview.topicPh", { defaultValue: "e.g. my new single, touring life…" })}
            />
            <DeskTextField
              isLight={isLight}
              label={t("aiInterview.nicheLabel", { defaultValue: "Niche (optional)" })}
              value={niche}
              onChange={setNiche}
              placeholder={t("aiInterview.nichePh", { defaultValue: "e.g. hip-hop, fitness…" })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RunButton
              busy={busy}
              disabled={!interviewQuestionsReady(topic)}
              onClick={() => void getQuestions()}
              testId="world-ai-interview-questions-run"
              label={`${t("aiInterview.getQuestions", { defaultValue: "Start the Interview" })} · ${qCost} VB`}
              busyLabel={t("worldCreateMedia.hookWriting")}
            />
          </div>
          {!interviewQuestionsReady(topic) && (
            <p className={`text-xs ${muted}`}>{t("worldHooksBenches.interviewNeedTopic")}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {questions.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Question ${i + 1}`}
                onClick={() => setCurrentQ(i)}
                className={
                  i === currentQ
                    ? chipCls(true)
                    : answers[i]?.trim()
                      ? "h-2.5 w-2.5 rounded-full bg-[#d4af37]/50 transition-all hover:bg-[#d4af37]/70"
                      : chipCls(false)
                }
              />
            ))}
            <span className={`ml-2 text-[11px] font-bold ${muted}`}>
              {currentQ + 1} / {questions.length} · {answeredCount} answered
            </span>
          </div>
          <div className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
            <p className="font-semibold">{questions[currentQ]}</p>
          </div>
          <DeskTextField
            isLight={isLight}
            label={t("aiInterview.answerPh", { defaultValue: "Speak your mind — the rawer the better…" })}
            value={answers[currentQ] ?? ""}
            onChange={(v) => {
              const next = [...answers];
              next[currentQ] = v;
              setAnswers(next);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {currentQ > 0 && (
              <button
                type="button"
                onClick={() => setCurrentQ(currentQ - 1)}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold bdv-touch-target ${
                  isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/70"
                }`}
              >
                ← Back
              </button>
            )}
            {currentQ < questions.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentQ(currentQ + 1)}
                className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-black text-black bdv-touch-target"
              >
                Next Question →
              </button>
            ) : (
              <RunButton
                busy={busy}
                disabled={!pkgReady}
                onClick={() => void buildPackage()}
                testId="world-ai-interview-package-run"
                label={`${t("aiInterview.buildPackage", { defaultValue: "Cut My Clips + Cards" })} · ${pkgCost} VB`}
                busyLabel={t("worldCreateMedia.hookWriting")}
              />
            )}
          </div>
          {!pkgReady && (
            <p className={`text-xs ${muted}`}>{t("worldHooksBenches.interviewNeedAnswers")}</p>
          )}
          <button
            type="button"
            onClick={() => {
              setQuestions([]);
              setAnswers([]);
              setPkg(null);
              setNote(null);
            }}
            className={`text-[11px] font-bold underline underline-offset-2 ${muted}`}
          >
            {t("worldHooksBenches.interviewStartOver")}
          </button>
        </div>
      )}

      <BenchNotes note={note} outOfCredits={outOfCredits} feature="AI Interview" isLight={isLight} />

      {pkg && (
        <div className="space-y-3" data-testid="world-ai-interview-result">
          <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            {t("aiInterview.package", { defaultValue: "Your interview package" })}
          </p>
          {pkg.clips.length > 0 && (
            <div className="space-y-2">
              <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                {t("aiInterview.clips", { defaultValue: "Clip moments" })}
              </p>
              {pkg.clips.map((c, i) => (
                <div key={i} className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                  <CopyLine text={`“${c.quote}”`} isLight={isLight} />
                  {c.why && <p className={`mt-1 text-xs ${muted}`}>{c.why}</p>}
                </div>
              ))}
            </div>
          )}
          {pkg.quoteCards.length > 0 && (
            <div className="space-y-2">
              <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                {t("aiInterview.quoteCards", { defaultValue: "Quote cards" })}
              </p>
              {pkg.quoteCards.map((q, i) => (
                <p key={i} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${benchCard(isLight)}`}>
                  <CopyLine text={`“${q}”`} isLight={isLight} />
                </p>
              ))}
            </div>
          )}
          {pkg.promoOutline.length > 0 && (
            <div className="space-y-1.5">
              <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                {t("aiInterview.promoOutline", { defaultValue: "60s promo cut outline" })}
              </p>
              <ol className="list-inside list-decimal space-y-1 text-sm">
                {pkg.promoOutline.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══ B-17 · Three-Second Lab openings ══════════════════════════ */

export function OpeningsBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const run = useBenchRunner();
  const [description, setDescription] = useState("");
  const [niche, setNiche] = useState("");
  const [openings, setOpenings] = useState<OpeningResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const cost = openingsCost();

  const generate = async () => {
    if (busy || !openingsReady(description)) return;
    const got = await run(
      "/api/three-second-lab/openings",
      buildOpeningsPayload({ videoDescription: description, niche }),
      openingsOfResponse,
      {
        setBusy,
        setNote,
        setOutOfCredits,
        emptyNote: t("worldHooksBenches.openingsEmpty"),
        hiccupNote: t("worldHooksBenches.diagHiccup"),
      },
    );
    if (got) setOpenings(got);
  };

  return (
    <div className="space-y-3" data-testid="world-openings-bench">
      <BenchHeader icon={Timer} title={t("worldHooksBenches.openingsTitle")} cost={cost} isLight={isLight} />
      <p className={`text-xs ${muted}`}>{t("worldHooksBenches.openingsIntro")}</p>
      <DeskTextField
        isLight={isLight}
        label={t("worldHooksBenches.openingsDescriptionLabel")}
        value={description}
        onChange={setDescription}
        placeholder={t("worldHooksBenches.openingsDescriptionPh")}
      />
      <DeskTextField
        isLight={isLight}
        label={t("worldHooksBenches.openingsNicheLabel")}
        value={niche}
        onChange={setNiche}
      />
      <div className="flex flex-wrap items-center gap-3">
        <RunButton
          busy={busy}
          disabled={!openingsReady(description)}
          onClick={() => void generate()}
          testId="world-openings-run"
          label={`${t("worldHooksBenches.openingsRun")} · ${cost} VB`}
          busyLabel={t("worldCreateMedia.hookWriting")}
        />
      </div>
      {!openingsReady(description) && (
        <p className={`text-xs ${muted}`}>{t("worldHooksBenches.openingsNeedDescription")}</p>
      )}
      <BenchNotes note={note} outOfCredits={outOfCredits} feature="3-Second Lab" isLight={isLight} />
      {openings && (
        <div className="space-y-2" data-testid="world-openings-result">
          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
            {t("videoEditor.labResults", { defaultValue: "Scored openings" })}
          </p>
          {openings.map((o, i) => (
            <div key={i} className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
              <div className="flex items-start justify-between gap-3">
                <CopyLine text={o.text} isLight={isLight} />
                <span
                  className={`shrink-0 text-sm font-black ${
                    o.score >= 80 ? "text-green-400" : o.score >= 60 ? "text-[#e8c86a]" : muted
                  }`}
                >
                  {o.score}
                </span>
              </div>
              {o.visual && <p className={`mt-1 text-xs ${muted}`}>{o.visual}</p>}
              {o.reasoning && <p className={`mt-1 text-xs italic ${muted}`}>{o.reasoning}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══ B-20 · the diagnostics bench group ════════════════════════ */

type DiagTool = "hook" | "seo" | "doctor" | "trend" | "style";

const DIAG_TOOLS: ReadonlyArray<{ key: DiagTool; labelKey: string; icon: LucideIcon }> = [
  { key: "hook", labelKey: "worldHooksBenches.diagToolHook", icon: Zap },
  { key: "seo", labelKey: "worldHooksBenches.diagToolSeo", icon: Gauge },
  { key: "doctor", labelKey: "worldHooksBenches.diagToolDoctor", icon: Stethoscope },
  { key: "trend", labelKey: "worldHooksBenches.diagToolTrend", icon: Sparkles },
  { key: "style", labelKey: "worldHooksBenches.diagToolStyle", icon: Wand2 },
];

export function DiagnosticsBenches({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const run = useBenchRunner();
  const [tool, setTool] = useState<DiagTool>("hook");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* hook analyzer */
  const [hookText, setHookText] = useState("");
  const [hookPlatform, setHookPlatform] = useState<DiagPlatform>("tiktok");
  const [hookNiche, setHookNiche] = useState("");
  const [viralMode, setViralMode] = useState(true);
  const [hookResult, setHookResult] = useState<HookAnalysisResult | null>(null);
  /* seo score */
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [seoTags, setSeoTags] = useState("");
  const [seoNiche, setSeoNiche] = useState("");
  const [seoChapters, setSeoChapters] = useState(false);
  const [seoCaptions, setSeoCaptions] = useState(false);
  const [seoResult, setSeoResult] = useState<SeoScoreResult | null>(null);
  /* retention doctor */
  const [docTitle, setDocTitle] = useState("");
  const [docRows, setDocRows] = useState<DoctorDropOffRow[]>([{ at: "", dropPct: "" }]);
  const [docLength, setDocLength] = useState("");
  const [docNiche, setDocNiche] = useState("");
  const [docType, setDocType] = useState("");
  const [docPlatform, setDocPlatform] = useState("");
  const [docResult, setDocResult] = useState<DoctorResult | null>(null);
  /* trend jacker */
  const [trend, setTrend] = useState("");
  const [trendWhy, setTrendWhy] = useState("");
  const [trendNiche, setTrendNiche] = useState("Music");
  const [trendStyle, setTrendStyle] = useState("");
  const [trendResult, setTrendResult] = useState<TrendDraftResult | null>(null);
  /* style stealer */
  const [styleUrl, setStyleUrl] = useState("");
  const [styleDesc, setStyleDesc] = useState("");
  const [styleNiche, setStyleNiche] = useState("");
  const [styleResult, setStyleResult] = useState<StyleFormulaResult | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const costs: Record<DiagTool, number> = {
    hook: hookAnalyzerCost(),
    seo: seoScoreCost(),
    doctor: retentionDoctorCost(),
    trend: trendJackerCost(),
    style: styleStealerCost(),
  };
  const features: Record<DiagTool, string> = {
    hook: "Hook Analyzer",
    seo: "SEO Score",
    doctor: "Retention Doctor",
    trend: "Trend Jacker",
    style: "Style Stealer",
  };

  const switchTool = (next: DiagTool) => {
    setTool(next);
    setNote(null);
    setOutOfCredits(false);
  };

  const opts = (emptyNote: string) => ({
    setBusy,
    setNote,
    setOutOfCredits,
    emptyNote,
    hiccupNote: t("worldHooksBenches.diagHiccup"),
  });

  const runHook = async () => {
    if (busy || !hookAnalysisReady(hookText)) return;
    const mode: HookAnalysisMode = viralMode ? "viral" : "standard";
    const got = await run(
      "/api/analyze-hook",
      buildHookAnalysisPayload({ transcript: hookText, platform: hookPlatform, niche: hookNiche, mode }),
      hookAnalysisOfResponse,
      opts(t("worldHooksBenches.hookEmpty")),
    );
    if (got) setHookResult(got);
  };

  const runSeo = async () => {
    if (busy || !seoScoreReady(seoTitle)) return;
    const got = await run(
      "/api/seo-score",
      buildSeoScorePayload({
        title: seoTitle,
        description: seoDescription,
        tagsText: seoTags,
        niche: seoNiche,
        hasChapters: seoChapters,
        hasCaptions: seoCaptions,
      }),
      seoScoreOfResponse,
      opts(t("worldHooksBenches.seoEmpty")),
    );
    if (got) setSeoResult(got);
  };

  const runDoctor = async () => {
    if (busy || !doctorReady(docTitle, docRows)) return;
    const got = await run(
      "/api/retention-doctor",
      buildDoctorPayload({
        title: docTitle,
        dropOffs: docRows,
        totalLength: docLength,
        niche: docNiche,
        videoType: docType,
        platform: docPlatform,
      }),
      doctorOfResponse,
      opts(t("worldHooksBenches.doctorEmpty")),
    );
    if (got) setDocResult(got);
  };

  const runTrend = async () => {
    if (busy || !trendDraftReady(trend)) return;
    const got = await run(
      "/api/trend-jacker/draft",
      buildTrendDraftPayload({ trend, trendWhy, niche: trendNiche, styleNotes: trendStyle }),
      trendDraftOfResponse,
      opts(t("worldHooksBenches.trendEmpty")),
    );
    if (got) setTrendResult(got);
  };

  const runStyle = async () => {
    if (busy || !styleStealerReady(styleDesc)) return;
    const got = await run(
      "/api/style-stealer/analyze",
      buildStyleStealerPayload({ videoUrl: styleUrl, description: styleDesc, niche: styleNiche }),
      styleFormulaOfResponse,
      opts(t("worldHooksBenches.styleEmpty")),
    );
    if (got) setStyleResult(got);
  };

  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;

  const checkboxCls = `flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${benchCard(isLight)}`;

  return (
    <div className="space-y-3" data-testid="world-diagnostics-benches">
      <BenchHeader
        icon={Gauge}
        title={t("worldHooksBenches.diagTitle")}
        cost={costs[tool]}
        isLight={isLight}
      />
      <p className={`text-xs ${muted}`}>{t("worldHooksBenches.diagIntro")}</p>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldHooksBenches.diagTitle")}>
        {DIAG_TOOLS.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tool === key}
            data-testid={`world-diagnostics-tool-${key}`}
            onClick={() => switchTool(key)}
            className={chipCls(tool === key)}
          >
            <Icon className="h-3.5 w-3.5" /> {t(labelKey)}
          </button>
        ))}
      </div>

      {tool === "hook" && (
        <div className="space-y-3">
          <DeskTextField
            isLight={isLight}
            label={t("worldHooksBenches.hookTranscriptLabel")}
            value={hookText}
            onChange={setHookText}
            placeholder={t("worldHooksBenches.hookTranscriptPh")}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskSelectField
              isLight={isLight}
              label={t("contentIntelligence.platformLabel", { defaultValue: "Platform" })}
              value={hookPlatform}
              onChange={(v) => setHookPlatform(v as DiagPlatform)}
              options={DIAG_PLATFORMS.map((p) => ({ value: p, label: p }))}
            />
            <DeskTextField
              isLight={isLight}
              label={t("worldHooksBenches.hookNicheLabel")}
              value={hookNiche}
              onChange={setHookNiche}
            />
          </div>
          <label className={checkboxCls}>
            <input
              type="checkbox"
              checked={viralMode}
              onChange={(e) => setViralMode(e.target.checked)}
              className="h-4 w-4 accent-amber-400"
            />
            <span className="text-sm">{t("worldHooksBenches.hookViralLabel")}</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <RunButton
              busy={busy}
              disabled={!hookAnalysisReady(hookText)}
              onClick={() => void runHook()}
              testId="world-diagnostics-hook-run"
              label={`${t("worldHooksBenches.hookRun")} · ${costs.hook} VB`}
              busyLabel={t("contentIntelligence.scoringHook", { defaultValue: "Scoring…" })}
            />
          </div>
          {!hookAnalysisReady(hookText) && (
            <p className={`text-xs ${muted}`}>{t("worldHooksBenches.hookNeedTranscript")}</p>
          )}
          {hookResult && (
            <div className="space-y-2" data-testid="world-diagnostics-hook-result">
              <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {t("contentIntelligence.hookScoreTitle", { defaultValue: "Hook score" })} · {hookResult.overallScore}/100
              </p>
              {(
                [
                  ["contentIntelligence.axisCuriosity", hookResult.curiosityGap],
                  ["contentIntelligence.axisPattern", hookResult.patternInterrupt],
                  ["contentIntelligence.axisClarity", hookResult.clarity],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold">{t(key, { defaultValue: key })}</span>
                    <span className="font-black">{value}/10</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-[#d4af37]" style={{ width: `${value * 10}%` }} />
                  </div>
                </div>
              ))}
              {hookResult.verdict && (
                <p className="text-sm">
                  <span className={`font-bold ${muted}`}>{t("worldHooksBenches.hookVerdictLabel")}: </span>
                  {hookResult.verdict}
                </p>
              )}
              {hookResult.weaknesses.length > 0 && (
                <div className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                  <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                    {t("worldHooksBenches.hookWeaknessesLabel")}
                  </p>
                  {hookResult.weaknesses.map((w, i) => (
                    <p key={i}>· {w}</p>
                  ))}
                </div>
              )}
              {hookResult.rewrittenHook && (
                <div className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                  <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                    {t("worldHooksBenches.hookRewriteLabel")}
                  </p>
                  <CopyLine text={hookResult.rewrittenHook} isLight={isLight} />
                  {hookResult.rewriteNotes.map((n, i) => (
                    <p key={i} className={`mt-1 text-xs ${muted}`}>
                      {n}
                    </p>
                  ))}
                </div>
              )}
              {hookResult.alternativeHooks.length > 0 && (
                <div className="space-y-2">
                  <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                    {t("worldHooksBenches.hookAlternativesLabel")}
                  </p>
                  {hookResult.alternativeHooks.map((h, i) => (
                    <p key={i} className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                      <CopyLine text={h} isLight={isLight} />
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tool === "seo" && (
        <div className="space-y-3">
          <DeskTextField
            isLight={isLight}
            label={t("worldHooksBenches.seoTitleLabel")}
            value={seoTitle}
            onChange={setSeoTitle}
            placeholder={t("worldHooksBenches.seoTitlePh")}
          />
          <DeskTextField
            isLight={isLight}
            label={t("worldHooksBenches.seoDescriptionLabel")}
            value={seoDescription}
            onChange={setSeoDescription}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskTextField
              isLight={isLight}
              label={t("worldHooksBenches.seoTagsLabel")}
              value={seoTags}
              onChange={setSeoTags}
            />
            <DeskTextField
              isLight={isLight}
              label={t("worldHooksBenches.seoNicheLabel")}
              value={seoNiche}
              onChange={setSeoNiche}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={checkboxCls}>
              <input
                type="checkbox"
                checked={seoChapters}
                onChange={(e) => setSeoChapters(e.target.checked)}
                className="h-4 w-4 accent-amber-400"
              />
              <span className="text-sm">{t("worldHooksBenches.seoChaptersLabel")}</span>
            </label>
            <label className={checkboxCls}>
              <input
                type="checkbox"
                checked={seoCaptions}
                onChange={(e) => setSeoCaptions(e.target.checked)}
                className="h-4 w-4 accent-amber-400"
              />
              <span className="text-sm">{t("worldHooksBenches.seoCaptionsLabel")}</span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RunButton
              busy={busy}
              disabled={!seoScoreReady(seoTitle)}
              onClick={() => void runSeo()}
              testId="world-diagnostics-seo-run"
              label={`${t("worldHooksBenches.seoRun")} · ${costs.seo} VB`}
              busyLabel={t("worldCreateMedia.hookWriting")}
            />
          </div>
          {!seoScoreReady(seoTitle) && (
            <p className={`text-xs ${muted}`}>{t("worldHooksBenches.seoNeedTitle")}</p>
          )}
          {seoResult && (
            <div className="space-y-2" data-testid="world-diagnostics-seo-result">
              <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {seoResult.overallScore}/100
              </p>
              {(
                [
                  ["Title strength", seoResult.dimensions.titleStrength],
                  ["Keyword coverage", seoResult.dimensions.keywordCoverage],
                  ["Description quality", seoResult.dimensions.descriptionQuality],
                  ["Tag relevance", seoResult.dimensions.tagRelevance],
                  ["Packaging complete", seoResult.dimensions.packagingComplete],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold">{label}</span>
                    <span className="font-black">{value}/100</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-[#d4af37]" style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
              {seoResult.issues.length > 0 && (
                <div className="space-y-2">
                  <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                    {t("worldHooksBenches.seoIssuesLabel")}
                  </p>
                  {seoResult.issues.map((issue, i) => (
                    <div key={i} className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                      <p>
                        <span className="font-bold uppercase">{issue.severity}</span> · {issue.message}
                      </p>
                      {issue.fix && <p className={muted}>{issue.fix}</p>}
                    </div>
                  ))}
                </div>
              )}
              {seoResult.optimizedTitle && (
                <div className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                  <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                    {t("worldHooksBenches.seoOptimizedTitleLabel")}
                  </p>
                  <CopyLine text={seoResult.optimizedTitle} isLight={isLight} />
                </div>
              )}
              {seoResult.optimizedDescriptionFirst150 && (
                <div className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                  <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                    {t("worldHooksBenches.seoOptimizedDescLabel")}
                  </p>
                  <p>{seoResult.optimizedDescriptionFirst150}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tool === "doctor" && (
        <div className="space-y-3">
          <DeskTextField
            isLight={isLight}
            label={t("retentionDoctor.titleLabel")}
            value={docTitle}
            onChange={setDocTitle}
            placeholder={t("retentionDoctor.titlePlaceholder")}
          />
          <div className="space-y-2">
            <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
              {t("retentionDoctor.dropOffsLabel")}
            </p>
            {docRows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <DeskTextField
                  isLight={isLight}
                  label={t("retentionDoctor.atLabel")}
                  value={row.at}
                  onChange={(v) => {
                    const next = [...docRows];
                    next[i] = { ...row, at: v };
                    setDocRows(next);
                  }}
                  placeholder={t("retentionDoctor.atPlaceholder")}
                />
                <DeskTextField
                  isLight={isLight}
                  label={t("retentionDoctor.dropLabel")}
                  value={row.dropPct}
                  onChange={(v) => {
                    const next = [...docRows];
                    next[i] = { ...row, dropPct: v };
                    setDocRows(next);
                  }}
                  placeholder={t("retentionDoctor.dropPlaceholder")}
                />
                <button
                  type="button"
                  aria-label={t("retentionDoctor.removeRow")}
                  onClick={() => setDocRows(docRows.filter((_, j) => j !== i))}
                  className={`self-end rounded-full border p-2 bdv-touch-box ${
                    isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/70"
                  }`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setDocRows([...docRows, { at: "", dropPct: "" }])}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold bdv-touch-target ${
                isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"
              }`}
            >
              <Plus className="h-3.5 w-3.5" /> {t("retentionDoctor.addDropOff")}
            </button>
            <p className={`text-xs ${muted}`}>{t("retentionDoctor.dropOffsHint")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskTextField
              isLight={isLight}
              label={t("retentionDoctor.lengthLabel")}
              value={docLength}
              onChange={setDocLength}
              placeholder={t("retentionDoctor.lengthPlaceholder")}
            />
            <DeskTextField
              isLight={isLight}
              label={t("retentionDoctor.nicheLabel")}
              value={docNiche}
              onChange={setDocNiche}
              placeholder={t("retentionDoctor.nichePlaceholder")}
            />
            <DeskSelectField
              isLight={isLight}
              label={t("retentionDoctor.typeLabel")}
              value={docType}
              onChange={setDocType}
              options={[
                { value: "", label: t("retentionDoctor.typeAny") },
                ...DOCTOR_VIDEO_TYPES.map((v) => ({
                  value: v,
                  label: t(`retentionDoctor.type_${v}`),
                })),
              ]}
            />
            <DeskSelectField
              isLight={isLight}
              label={t("retentionDoctor.platformLabel")}
              value={docPlatform}
              onChange={setDocPlatform}
              options={[
                { value: "", label: t("retentionDoctor.typeAny") },
                ...DOCTOR_PLATFORMS.map((p) => ({
                  value: p,
                  label: t(`retentionDoctor.platform_${p}`),
                })),
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RunButton
              busy={busy}
              disabled={!doctorReady(docTitle, docRows)}
              onClick={() => void runDoctor()}
              testId="world-diagnostics-doctor-run"
              label={`${t("retentionDoctor.cta")} · ${costs.doctor} VB`}
              busyLabel={t("retentionDoctor.diagnosing")}
            />
          </div>
          {!doctorReady(docTitle, docRows) && (
            <p className={`text-xs ${muted}`}>{t("worldHooksBenches.doctorNeedForm")}</p>
          )}
          {docResult && (
            <div className="space-y-2" data-testid="world-diagnostics-doctor-result">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 bg-black/50 font-black text-xl ${
                    isLight ? "text-[#2a1e07]" : "text-white"
                  }`}
                >
                  {docResult.reportCard.grade}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                    {t("retentionDoctor.reportCard")} · {docResult.reportCard.score}/100
                  </p>
                  {docResult.reportCard.headline && (
                    <p className={`text-sm ${muted}`}>{docResult.reportCard.headline}</p>
                  )}
                </div>
              </div>
              {docResult.summary && (
                <p className="text-sm">
                  <span className={`font-bold ${muted}`}>{t("worldHooksBenches.doctorSummaryLabel")}: </span>
                  {docResult.summary}
                </p>
              )}
              <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                {t("retentionDoctor.diagnosesTitle")}
              </p>
              {docResult.diagnoses.map((d: DoctorDiagnosis, i) => (
                <div key={i} className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                  <p className="font-bold">
                    {d.at} · −{d.dropPct}% · {d.causeLabel}
                  </p>
                  {d.diagnosis && <p className={`mt-1 ${muted}`}>{d.diagnosis}</p>}
                  <p className="mt-1">
                    <span className={`font-bold ${muted}`}>{t("retentionDoctor.prescriptionLabel")}: </span>
                    {d.prescription}
                  </p>
                  {d.fixLabel && (
                    <p className={`mt-1 text-xs font-bold ${muted}`}>
                      {t("retentionDoctor.fixEditor")} · {d.fixLabel}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tool === "trend" && (
        <div className="space-y-3">
          <DeskTextField
            isLight={isLight}
            label={t("worldHooksBenches.trendTrendLabel")}
            value={trend}
            onChange={setTrend}
            placeholder={t("worldHooksBenches.trendTrendPh")}
          />
          <DeskTextField
            isLight={isLight}
            label={t("worldHooksBenches.trendWhyLabel")}
            value={trendWhy}
            onChange={setTrendWhy}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskTextField
              isLight={isLight}
              label={t("worldHooksBenches.trendNicheLabel")}
              value={trendNiche}
              onChange={setTrendNiche}
            />
            <DeskTextField
              isLight={isLight}
              label={t("worldHooksBenches.trendStyleLabel")}
              value={trendStyle}
              onChange={setTrendStyle}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RunButton
              busy={busy}
              disabled={!trendDraftReady(trend)}
              onClick={() => void runTrend()}
              testId="world-diagnostics-trend-run"
              label={`${t("worldHooksBenches.trendRun")} · ${costs.trend} VB`}
              busyLabel={t("worldCreateMedia.hookWriting")}
            />
          </div>
          {!trendDraftReady(trend) && (
            <p className={`text-xs ${muted}`}>{t("worldHooksBenches.trendNeedTrend")}</p>
          )}
          {trendResult && (
            <div className="space-y-2" data-testid="world-diagnostics-trend-result">
              <div className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                  {t("trendJacker.hook", { defaultValue: "Hook" })}
                </p>
                <CopyLine text={trendResult.hook} isLight={isLight} />
              </div>
              <div className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                  {t("trendJacker.script", { defaultValue: "Script" })}
                </p>
                <p className="whitespace-pre-line">{trendResult.script}</p>
              </div>
              {trendResult.visualPlan.length > 0 && (
                <div className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                  <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                    {t("trendJacker.visualPlan", { defaultValue: "Visual plan" })}
                  </p>
                  <ol className="list-inside list-decimal space-y-1">
                    {trendResult.visualPlan.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ol>
                </div>
              )}
              {trendResult.caption && (
                <div className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                  <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                    {t("worldHooksBenches.trendCaptionLabel")}
                  </p>
                  <CopyLine text={trendResult.caption} isLight={isLight} />
                </div>
              )}
              {trendResult.hashtags.length > 0 && (
                <p className={`text-xs ${muted}`}>{trendResult.hashtags.map((h) => `#${h}`).join(" ")}</p>
              )}
            </div>
          )}
        </div>
      )}

      {tool === "style" && (
        <div className="space-y-3">
          <DeskTextField
            isLight={isLight}
            label={t("worldHooksBenches.styleUrlLabel")}
            value={styleUrl}
            onChange={setStyleUrl}
            placeholder={t("worldHooksBenches.styleUrlPh")}
          />
          <DeskTextField
            isLight={isLight}
            label={t("worldHooksBenches.styleDescLabel")}
            value={styleDesc}
            onChange={setStyleDesc}
            placeholder={t("worldHooksBenches.styleDescPh")}
          />
          <DeskTextField
            isLight={isLight}
            label={t("worldHooksBenches.styleNicheLabel")}
            value={styleNiche}
            onChange={setStyleNiche}
          />
          <div className="flex flex-wrap items-center gap-3">
            <RunButton
              busy={busy}
              disabled={!styleStealerReady(styleDesc)}
              onClick={() => void runStyle()}
              testId="world-diagnostics-style-run"
              label={`${t("worldHooksBenches.styleRun")} · ${costs.style} VB`}
              busyLabel={t("worldCreateMedia.hookWriting")}
            />
          </div>
          {!styleStealerReady(styleDesc) && (
            <p className={`text-xs ${muted}`}>{t("worldHooksBenches.styleNeedDesc")}</p>
          )}
          {styleResult && (
            <div className="space-y-2" data-testid="world-diagnostics-style-result">
              {(
                [
                  ["videoEditor.styleStealerHook", styleResult.formula.hook],
                  ["videoEditor.styleStealerPacing", styleResult.formula.pacing],
                  ["videoEditor.styleStealerCuts", styleResult.formula.cutPattern],
                  ["videoEditor.styleStealerCaptions", styleResult.formula.captionStyle],
                  ["videoEditor.styleStealerAudio", styleResult.formula.audioCues],
                  ["videoEditor.styleStealerWhy", styleResult.formula.whyItWorks],
                ] as const
              )
                .filter(([, v]) => v.length > 0)
                .map(([key, v]) => (
                  <div key={key} className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                    <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                      {t(key, { defaultValue: key })}
                    </p>
                    <p>{v}</p>
                  </div>
                ))}
              {styleResult.editRecipe && (styleResult.editRecipe.name || styleResult.editRecipe.steps.length > 0) && (
                <div className={`rounded-xl border px-3 py-2 text-sm ${benchCard(isLight)}`}>
                  <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                    {t("worldHooksBenches.styleRecipeLabel")}
                    {styleResult.editRecipe.name ? ` · ${styleResult.editRecipe.name}` : ""}
                  </p>
                  <ol className="list-inside list-decimal space-y-1">
                    {styleResult.editRecipe.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <BenchNotes note={note} outOfCredits={outOfCredits} feature={features[tool]} isLight={isLight} />
    </div>
  );
}
