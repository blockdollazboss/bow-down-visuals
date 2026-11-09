/**
 * Wave8HookBenches — the Wave8 singles that belong to the Hook
 * Desk (Stack 400 world parity, census B-19): the Hook
 * Rewriter and the Styled Caption Burn-in, stacked under the
 * desk beside the Caption Styler bench.
 *
 * Each bench is its page's own flow on its own rail: the
 * charged post rides the registry-priced spend confirmation,
 * a declined confirmation runs nothing, and the result lands
 * in the hub project as a script asset — the World's form of
 * the pages' handoffs. The burn bench is NOT the Caption
 * Styler bench: that bench rides /api/caption-styler (300,
 * the server-rendered video job); this one rides
 * /api/wave8/caption-styler/burn (100, the transcript timing
 * rail) — different rail, different price, different job.
 * Copy rides the twins' own catalog namespace (wave8.*); the
 * few bench-only lines live in worldWave8Bench.*.
 */
import { useState } from "react";
import { Captions, Download, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@/lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { DeskSelectField, DeskTextField, deskInputCls } from "./CreateDeskLeaf";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  HOOK_REWRITER_PATH,
  buildHookRewriterPayload,
  hookRewriterCost,
  hookRewriterResultOf,
  type HookRewriterResult,
} from "@/lib/world/hook-desk";
import {
  WAVE8_CAPTION_BURN_DEFAULT_WPS,
  WAVE8_CAPTION_BURN_PATH,
  WAVE8_CAPTION_BURN_PRESETS,
  buildWave8CaptionBurnPayload,
  wave8CaptionBurnCost,
  wave8CaptionBurnOf,
  type Wave8CaptionBurnPreset,
  type Wave8CaptionBurnResult,
} from "@/lib/world/wave8-benches";

/* ─── Shared bench chrome (the Wave8 bench files') ─────────── */

export function BenchShell({
  isLight,
  testId,
  icon,
  title,
  cost,
  subtitle,
  children,
}: {
  isLight: boolean;
  testId: string;
  icon: React.ReactNode;
  title: string;
  cost: number;
  subtitle: string;
  children: React.ReactNode;
}) {
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="flex items-center gap-2">
        <span className={isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}>{icon}</span>
        <p className={`text-base font-black ${strong}`}>{title}</p>
        <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
          {cost} VB
        </span>
      </div>
      <p className={`text-xs ${muted}`}>{subtitle}</p>
      {children}
    </div>
  );
}

export function BenchRunButton({
  testId,
  busy,
  busyLabel,
  label,
  disabled,
  onClick,
}: {
  testId: string;
  busy: boolean;
  busyLabel: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
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
    </div>
  );
}

export function BenchNotices({
  isLight,
  outOfCredits,
  feature,
  error,
  onRetry,
}: {
  isLight: boolean;
  outOfCredits: boolean;
  feature: string;
  error: string | null;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldBenches300.outOfBucs", { feature })}
        </p>
      )}
      {error &&
        (onRetry ? (
          <NativeErrorState isLight={isLight} message={error} onRetry={onRetry} />
        ) : (
          <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
        ))}
    </>
  );
}

/** A bench textarea with the desk label treatment (the desk
 *  leaf fields cover single-line inputs + selects). */
export function BenchTextArea({
  isLight,
  label,
  value,
  onChange,
  placeholder,
  rows,
}: {
  isLight: boolean;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows ?? 4}
        className={deskInputCls(isLight)}
      />
    </label>
  );
}

/* ─── Hook Rewriter ─────────────────────────────────────────── */

export function HookRewriterBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const [post, setPost] = useState("");
  const [niche, setNiche] = useState("");
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [result, setResult] = useState<HookRewriterResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = hookRewriterCost();
  const busy = phase === "working";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";

  async function rewrite() {
    if (busy || !post.trim()) return;
    setPhase("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(HOOK_REWRITER_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        overrideFeature: "Hook Rewriter",
        body: JSON.stringify(buildHookRewriterPayload({ post, niche })),
      });
      if (!res) { setPhase("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("idle");
        return;
      }
      const parsed = hookRewriterResultOf(data);
      if (!res.ok || !parsed) {
        setPhase("idle");
        setError(apiErrorMessage(data, t("wave8.hookRewriter.errorRewrite")));
        return;
      }
      setResult(parsed);
      setPhase("done");
      try {
        addAsset({
          kind: "script",
          url: "",
          label: "Hook rewrites",
          detail: parsed.variants.map((v) => `${v.angle}: ${v.hook}`).join(" · "),
        });
      } catch { /* non-fatal — the hub tray is a bonus, not the result */ }
    } catch {
      setPhase("idle");
      setError(t("wave8.hookRewriter.errorRewrite"));
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave8-hook-rewriter-bench"
      icon={<Wand2 className="h-4 w-4" />}
      title={t("wave8.hookRewriter.title")}
      cost={cost}
      subtitle={t("wave8.hookRewriter.sub")}
    >
      <BenchTextArea
        isLight={isLight}
        label={t("wave8.hookRewriter.postLabel")}
        value={post}
        onChange={setPost}
        placeholder={t("wave8.hookRewriter.postPlaceholder")}
        rows={3}
      />
      <DeskTextField
        isLight={isLight}
        label={t("wave8.hookRewriter.nicheLabel")}
        value={niche}
        onChange={setNiche}
        placeholder={t("wave8.hookRewriter.nichePlaceholder")}
      />
      <BenchRunButton
        testId="world-wave8-hook-rewriter-run"
        busy={busy}
        busyLabel={t("wave8.hookRewriter.rewriting")}
        label={t("worldWave8Bench.rewriteRun")}
        disabled={!post.trim()}
        onClick={rewrite}
      />
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Hook Rewriter" error={error} />
      {busy && <NativeLoadingState isLight={isLight} message={t("wave8.hookRewriter.rewriting")} />}
      {!busy && !result && !error && (
        <NativeEmptyState isLight={isLight} message={t("worldWave8Bench.hookEmpty")} />
      )}
      {result && (
        <div className="space-y-2" data-testid="world-wave8-hook-rewriter-result">
          {result.variants.map((v, i) => (
            <div key={i} className={`rounded-xl border p-3 ${cardCls}`}>
              <p className={`text-sm font-bold ${strong}`}>{v.hook}</p>
              <p className={`mt-1 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                {t("wave8.hookRewriter.angleLabel")}: {v.angle}
              </p>
              <p className={`mt-1 text-xs ${muted}`}>
                {t("wave8.hookRewriter.whyLabel")}: {v.whyItWorks}
              </p>
            </div>
          ))}
        </div>
      )}
    </BenchShell>
  );
}

/* ─── Styled Caption Burn-in ────────────────────────────────── */

const CAPTION_BURN_PRESET_LABEL_KEYS: Record<Wave8CaptionBurnPreset, string> = {
  karaoke: "wave8.captionStyler.presetKaraoke",
  popin: "wave8.captionStyler.presetPopin",
  lowerthird: "wave8.captionStyler.presetLowerthird",
};

function downloadTextFile(name: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function CaptionBurnBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const [transcript, setTranscript] = useState("");
  const [preset, setPreset] = useState<Wave8CaptionBurnPreset>("karaoke");
  const [wordsPerSecond, setWordsPerSecond] = useState(WAVE8_CAPTION_BURN_DEFAULT_WPS);
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [result, setResult] = useState<Wave8CaptionBurnResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = wave8CaptionBurnCost();
  const busy = phase === "working";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";

  async function burn() {
    if (busy) return;
    if (!transcript.trim()) {
      setError(t("wave8.captionStyler.errorEmpty"));
      return;
    }
    setPhase("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(WAVE8_CAPTION_BURN_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        overrideFeature: "Styled Caption Burn-in",
        body: JSON.stringify(buildWave8CaptionBurnPayload({ transcript, preset, wordsPerSecond })),
      });
      if (!res) { setPhase("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("idle");
        return;
      }
      const parsed = wave8CaptionBurnOf(data);
      if (!res.ok || !parsed) {
        setPhase("idle");
        setError(apiErrorMessage(data, t("wave8.captionStyler.errorFailed")));
        return;
      }
      setResult(parsed);
      setPhase("done");
      try {
        addAsset({
          kind: "script",
          url: "",
          label: `Styled captions — ${parsed.preset || preset}`,
          detail: t("wave8.captionStyler.styledSummary", { count: parsed.words.length }),
        });
      } catch { /* non-fatal — the hub tray is a bonus, not the result */ }
    } catch {
      setPhase("idle");
      setError(t("wave8.captionStyler.errorFailed"));
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave8-caption-burn-bench"
      icon={<Captions className="h-4 w-4" />}
      title={t("wave8.captionStyler.title")}
      cost={cost}
      subtitle={t("wave8.captionStyler.subtitle")}
    >
      <BenchTextArea
        isLight={isLight}
        label={t("wave8.captionStyler.transcriptLabel")}
        value={transcript}
        onChange={setTranscript}
        placeholder={t("wave8.captionStyler.transcriptPlaceholder")}
        rows={4}
      />
      <div className="grid grid-cols-2 gap-3">
        <DeskSelectField
          isLight={isLight}
          label={t("worldWave8Bench.presetStyleLabel")}
          value={preset}
          onChange={(v) => setPreset(v as Wave8CaptionBurnPreset)}
          options={WAVE8_CAPTION_BURN_PRESETS.map((p) => ({ value: p, label: t(CAPTION_BURN_PRESET_LABEL_KEYS[p]) }))}
        />
        <label className="block">
          <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("wave8.captionStyler.paceLabel")} — {wordsPerSecond}
          </span>
          <input
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={wordsPerSecond}
            onChange={(e) => setWordsPerSecond(Number(e.target.value))}
            className="w-full accent-[#d4af37] bdv-touch-target"
          />
        </label>
      </div>
      <BenchRunButton
        testId="world-wave8-caption-burn-run"
        busy={busy}
        busyLabel={t("wave8.captionStyler.burnBusy")}
        label={t("worldWave8Bench.captionBurnRun")}
        onClick={burn}
      />
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Styled Caption Burn-in" error={error} />
      {busy && <NativeLoadingState isLight={isLight} message={t("wave8.captionStyler.burnBusy")} />}
      {!busy && !result && !error && (
        <NativeEmptyState isLight={isLight} message={t("worldWave8Bench.captionEmpty")} />
      )}
      {result && (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-wave8-caption-burn-result">
          <p className={`text-sm font-bold ${strong}`}>{t("wave8.captionStyler.styledTitle")}</p>
          <p className={`mt-1 text-xs ${muted}`}>
            {t("wave8.captionStyler.styledSummary", { count: result.words.length })}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {result.words.slice(0, 40).map((w, i) => (
              <span key={i} className={`rounded-full border px-2 py-0.5 text-[11px] ${cardCls}`}>
                {w.word} <span className={muted}>{w.start.toFixed(1)}s</span>
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadTextFile("captions.srt", result.srt)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
            >
              <Download className="h-3.5 w-3.5" /> {t("wave8.captionStyler.downloadSrt")}
            </button>
            <button
              type="button"
              onClick={() => downloadTextFile("captions.vtt", result.vtt)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
            >
              <Download className="h-3.5 w-3.5" /> {t("wave8.captionStyler.downloadVtt")}
            </button>
          </div>
          {result.creditsRemaining !== null && (
            <p className={`mt-2 text-[11px] ${muted}`}>
              {t("worldWave8Bench.creditsRemaining", { n: result.creditsRemaining })}
            </p>
          )}
        </div>
      )}
    </BenchShell>
  );
}
