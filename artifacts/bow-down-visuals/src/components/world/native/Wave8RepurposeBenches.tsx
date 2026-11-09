/**
 * Wave8RepurposeBenches — the Wave8 single that belongs to
 * the Repurpose family (Stack 400 world parity, census
 * B-19): the Stream Highlight Auto-Editor, stacked at the My
 * Studio board right after the Repurpose Desk, where a
 * finished stream's next step lives.
 *
 * The bench is its page's own flow on its own rail (lib/
 * world/wave8-benches.ts): the charged post rides the
 * registry-priced spend confirmation, a declined
 * confirmation runs nothing, and the scored edit plan lands
 * in the hub project as a script asset. The page's own
 * honesty carries over verbatim — the result is a scored
 * edit plan, not rendered video (wave8.highlights.
 * disclaimer). Copy rides the twin's own catalog namespace
 * (wave8.highlights.*); the few bench-only lines live in
 * worldWave8Bench.*.
 */
import { useState } from "react";
import { Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@/lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { DeskSelectField, DeskTextField } from "./CreateDeskLeaf";
import { NativeEmptyState, NativeLoadingState } from "./NativeStates";
import { BenchNotices, BenchRunButton, BenchShell, BenchTextArea } from "./Wave8HookBenches";
import {
  WAVE8_HIGHLIGHTS_PATH,
  WAVE8_HIGHLIGHT_TARGET_SECONDS,
  buildWave8HighlightsPayload,
  wave8HighlightsCost,
  wave8HighlightsOf,
  wave8HighlightsReady,
  type Wave8HighlightsResult,
} from "@/lib/world/wave8-benches";

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function HighlightsBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const [vodUrl, setVodUrl] = useState("");
  const [vodTitle, setVodTitle] = useState("");
  const [chatLog, setChatLog] = useState("");
  const [transcript, setTranscript] = useState("");
  const [targetSeconds, setTargetSeconds] = useState(60);
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [result, setResult] = useState<Wave8HighlightsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = wave8HighlightsCost();
  const busy = phase === "working";
  const ready = wave8HighlightsReady({ vodUrl, chatLog, transcript });
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";

  async function cut() {
    if (busy) return;
    if (!ready) {
      setError(t("wave8.highlights.errorNoSource"));
      return;
    }
    setPhase("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(WAVE8_HIGHLIGHTS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        overrideFeature: "Stream Highlight Auto-Editor",
        body: JSON.stringify(buildWave8HighlightsPayload({ vodUrl, vodTitle, chatLog, transcript, targetSeconds })),
      });
      if (!res) { setPhase("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("idle");
        return;
      }
      const parsed = wave8HighlightsOf(data);
      if (!res.ok || !parsed) {
        setPhase("idle");
        setError(apiErrorMessage(data, t("wave8.highlights.errorGeneric")));
        return;
      }
      setResult(parsed);
      setPhase("done");
      try {
        addAsset({
          kind: "script",
          url: "",
          label: vodTitle.trim() ? `Highlight reel plan — ${vodTitle.trim()}` : "Highlight reel plan",
          detail: parsed.reelPlan.segments.map((s) => `${mmss(s.startSec)}–${mmss(s.endSec)} ${s.caption}`).join(" · "),
        });
      } catch { /* non-fatal — the hub tray is a bonus, not the result */ }
    } catch {
      setPhase("idle");
      setError(t("wave8.highlights.errorGeneric"));
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave8-highlights-bench"
      icon={<Scissors className="h-4 w-4" />}
      title={t("wave8.highlights.title")}
      cost={cost}
      subtitle={t("wave8.highlights.subtitle")}
    >
      <DeskTextField
        isLight={isLight}
        label={t("wave8.highlights.vodUrlLabel")}
        value={vodUrl}
        onChange={setVodUrl}
        placeholder={t("wave8.highlights.vodUrlPlaceholder")}
      />
      <DeskTextField
        isLight={isLight}
        label={t("wave8.highlights.vodTitleLabel")}
        value={vodTitle}
        onChange={setVodTitle}
        placeholder={t("wave8.highlights.vodTitlePlaceholder")}
      />
      <BenchTextArea
        isLight={isLight}
        label={t("wave8.highlights.chatLogLabel")}
        value={chatLog}
        onChange={setChatLog}
        placeholder={t("wave8.highlights.chatLogPlaceholder")}
        rows={3}
      />
      <BenchTextArea
        isLight={isLight}
        label={t("wave8.highlights.transcriptLabel")}
        value={transcript}
        onChange={setTranscript}
        placeholder={t("wave8.highlights.transcriptPlaceholder")}
        rows={3}
      />
      <DeskSelectField
        isLight={isLight}
        label={t("wave8.highlights.targetLengthLabel")}
        value={String(targetSeconds)}
        onChange={(v) => setTargetSeconds(Number(v))}
        options={WAVE8_HIGHLIGHT_TARGET_SECONDS.map((n) => ({
          value: String(n),
          label: t("wave8.highlights.reelLengthSeconds", { n }),
        }))}
      />
      <BenchRunButton
        testId="world-wave8-highlights-run"
        busy={busy}
        busyLabel={t("wave8.highlights.cutting")}
        label={t("worldWave8Bench.highlightsRun")}
        onClick={cut}
      />
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Stream Highlight Auto-Editor" error={error} />
      {busy && <NativeLoadingState isLight={isLight} message={t("wave8.highlights.cutting")} />}
      {!busy && !result && !error && (
        <NativeEmptyState isLight={isLight} message={t("worldWave8Bench.highlightsEmpty")} />
      )}
      {result && (
        <div className="space-y-3" data-testid="world-wave8-highlights-result">
          {result.summary && (
            <div className={`rounded-xl border p-3 ${cardCls}`}>
              <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                {t("wave8.highlights.summaryHeading")}
              </p>
              <p className={`mt-1 text-sm ${strong}`}>{result.summary}</p>
            </div>
          )}
          <div>
            <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {t("wave8.highlights.momentsHeading")}
            </p>
            <div className="mt-2 space-y-2">
              {result.moments.map((m, i) => (
                <div key={i} className={`rounded-xl border p-3 ${cardCls}`}>
                  <p className={`text-sm font-bold ${strong}`}>
                    {m.label} <span className={muted}>· {mmss(m.startSec)}–{mmss(m.endSec)} · {m.score}</span>
                  </p>
                  {m.reason && <p className={`mt-1 text-xs ${muted}`}>{m.reason}</p>}
                </div>
              ))}
            </div>
          </div>
          {result.reelPlan.segments.length > 0 && (
            <div>
              <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                {t("wave8.highlights.planHeading")} — {t("wave8.highlights.segmentsTotal", { total: result.reelPlan.totalSec, count: result.reelPlan.segments.length })}
              </p>
              <div className="mt-2 space-y-1.5">
                {result.reelPlan.segments.map((s, i) => (
                  <p key={i} className={`text-xs ${muted}`}>
                    <span className={`font-bold ${strong}`}>{mmss(s.startSec)}–{mmss(s.endSec)}</span> {s.caption}
                  </p>
                ))}
              </div>
            </div>
          )}
          <p className={`text-[11px] ${muted}`}>{t("wave8.highlights.disclaimer")}</p>
          {result.creditsRemaining !== null && (
            <p className={`text-[11px] ${muted}`}>
              {t("worldWave8Bench.creditsRemaining", { n: result.creditsRemaining })}
            </p>
          )}
        </div>
      )}
    </BenchShell>
  );
}
