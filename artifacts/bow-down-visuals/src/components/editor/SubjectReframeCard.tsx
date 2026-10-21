import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Crosshair, Loader2, CheckCircle2, AlertTriangle, XCircle,
  Download, Scissors, Sparkles, Film,
} from "lucide-react";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import type { SceneData } from "@/lib/scene-parser";
import {
  SUBJECT_REFRAME_ENDPOINT,
  SUBJECT_REFRAME_ASPECTS,
  subjectReframeAspectSpec,
  subjectReframeCost,
  buildSubjectReframeBody,
  parseSubjectReframeResult,
  subjectReframeReasonKey,
  type SubjectReframeAspect,
  type SubjectReframeResult,
} from "@/lib/subject-reframe";

/* ─── Smart Reframe — Subject Tracking ────────────────────────────────
   Docks POST /api/auto-reframe into the Export tab, next to the
   multi-ratio card. Not the Pro Tools "Smart Reframe" chip (that one
   is an export-settings centre crop, applied at render): this card
   runs the subject-tracking render — it samples the clip, finds the
   subject, and moves the crop window to keep them in frame. When no
   subject can be followed, the API renders a centre crop and says so
   in its `reframe` block; this card shows that label verbatim in
   spirit — a centre crop is never dressed up as tracking. The charge
   (registry-priced, confirmed before it fires) is refunded by the
   server on any failure, and the failure state says that. */

type SourceKind = "export" | "scene" | "manual";

/* Static i18n keys per aspect (aspect strings contain ":", which the
   i18n parser reads as a namespace separator — never build keys from
   them dynamically). */
const ASPECT_NAME_KEYS: Record<SubjectReframeAspect, string> = {
  "16:9": "videoEditor.subjectReframe.aspectLandscape",
  "9:16": "videoEditor.subjectReframe.aspectVertical",
  "1:1": "videoEditor.subjectReframe.aspectSquare",
  "4:5": "videoEditor.subjectReframe.aspectPortrait",
};

const ASPECT_PLATFORM_KEYS: Record<SubjectReframeAspect, string> = {
  "16:9": "videoEditor.subjectReframe.platformYoutube",
  "9:16": "videoEditor.subjectReframe.platformVertical",
  "1:1": "videoEditor.subjectReframe.platformSquare",
  "4:5": "videoEditor.subjectReframe.platformPortrait",
};

interface SourceOption {
  kind: SourceKind;
  id: string;
  url: string;
  sceneId?: string;
  sceneNumber?: number;
}

export function SubjectReframeCard({
  scenes,
  videoUrl,
  onReplaceClipVideo,
  onUseAsExport,
}: {
  scenes: SceneData[];
  /** Finished export / handoff video URL — the default source when set. */
  videoUrl: string | null;
  /** Puts the reframed render on the source scene's timeline slot. */
  onReplaceClipVideo?: (sceneId: string, url: string) => void;
  /** Makes the reframed render the export chain's finished video. */
  onUseAsExport?: (url: string) => void;
}) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  const cost = subjectReframeCost();

  const sceneSources: SourceOption[] = scenes
    .filter((s) => !!s.demoClipUrl)
    .map((s) => ({
      kind: "scene" as const,
      id: `scene:${s.id}`,
      url: s.demoClipUrl!,
      sceneId: s.id,
      sceneNumber: s.sceneNumber,
    }));
  const exportSource: SourceOption | null = videoUrl
    ? { kind: "export", id: "export", url: videoUrl }
    : null;
  const options: SourceOption[] = [
    ...(exportSource ? [exportSource] : []),
    ...sceneSources,
  ];

  const [sourceId, setSourceId] = useState<string>("");
  const [manualUrl, setManualUrl] = useState("");
  const [aspect, setAspect] = useState<SubjectReframeAspect>("9:16");
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "failed">("idle");
  const [result, setResult] = useState<SubjectReframeResult | null>(null);
  const [resultSource, setResultSource] = useState<SourceOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeOption: SourceOption | null =
    options.find((o) => o.id === sourceId) ?? options[0] ?? null;
  const usingManual = !activeOption;
  const sourceUrl = usingManual ? manualUrl.trim() || null : activeOption.url;

  /* Default the picker to the finished export, else the first scene. */
  useEffect(() => {
    if (!sourceId && options[0]) setSourceId(options[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length]);

  function pickSource(id: string) {
    setSourceId(id);
    setResult(null);
    setError(null);
    setPhase("idle");
  }

  function pickAspect(key: SubjectReframeAspect) {
    setAspect(key);
    setResult(null);
    setError(null);
    setPhase("idle");
  }

  async function handleReframe() {
    if (!sourceUrl || phase === "working") {
      if (!sourceUrl) {
        toast({
          title: t("videoEditor.subjectReframe.noSourceTitle"),
          description: t("videoEditor.subjectReframe.noSourceDesc"),
        });
      }
      return;
    }
    setPhase("working");
    setError(null);
    setResult(null);
    try {
      const res = await confirmedFetch(SUBJECT_REFRAME_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSubjectReframeBody(sourceUrl, aspect)),
        overrideCost: cost,
        overrideFeature: t("videoEditor.subjectReframe.confirmFeature"),
      });
      if (res === null) {
        setPhase("idle"); // user cancelled the credit confirmation
        return;
      }
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const serverMsg = typeof data.message === "string" ? data.message : null;
        if (res.status === 402) {
          setError(serverMsg ?? t("videoEditor.subjectReframe.outOfCredits"));
        } else if (res.status === 500) {
          setError(t("videoEditor.subjectReframe.failedRefunded", { cost }));
        } else {
          setError(serverMsg ?? t("videoEditor.subjectReframe.failedPlain"));
        }
        setPhase("failed");
        return;
      }
      const parsed = parseSubjectReframeResult(data);
      if (!parsed) {
        setError(t("videoEditor.subjectReframe.failedPlain"));
        setPhase("failed");
        return;
      }
      setResult(parsed);
      setResultSource(usingManual ? null : activeOption);
      setPhase("done");
      toast({ title: t("videoEditor.subjectReframe.doneTitle") });
    } catch {
      setError(t("videoEditor.subjectReframe.failedNetwork"));
      setPhase("failed");
    }
  }

  function handleUseInTimeline() {
    if (!result || !resultSource?.sceneId || !onReplaceClipVideo) return;
    onReplaceClipVideo(resultSource.sceneId, result.url);
    toast({
      title: t("videoEditor.subjectReframe.inTimelineTitle"),
      description: t("videoEditor.subjectReframe.inTimelineDesc", {
        number: resultSource.sceneNumber ?? "",
      }),
    });
  }

  function handleUseAsExport() {
    if (!result || !onUseAsExport) return;
    onUseAsExport(result.url);
    toast({
      title: t("videoEditor.subjectReframe.asExportTitle"),
      description: t("videoEditor.subjectReframe.asExportDesc"),
    });
  }

  const working = phase === "working";
  const reasonKey =
    result?.reframe.mode === "centre-crop"
      ? subjectReframeReasonKey(result.reframe.reason)
      : null;

  return (
    <EditorCard
      title={t("videoEditor.subjectReframe.title")}
      subtitle={t("videoEditor.subjectReframe.subtitle")}
      icon={<Crosshair className="h-4 w-4" />}
      right={
        <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/25 rounded-full px-2.5 py-1">
          {t("videoEditor.subjectReframe.costLabel", { cost })}
        </span>
      }
    >
      <div className="p-5 space-y-4">
        {/* Source picker — finished export, timeline scenes, or a URL */}
        <div>
          <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-2">
            {t("videoEditor.subjectReframe.sourceLabel")}
          </p>
          <div className="flex flex-wrap gap-2">
            {options.map((o) => (
              <button
                key={o.id}
                onClick={() => pickSource(o.id)}
                disabled={working}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors disabled:opacity-50 ${
                  activeOption?.id === o.id
                    ? "bg-primary text-black border-primary"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {o.kind === "export"
                  ? t("videoEditor.subjectReframe.sourceExport")
                  : t("videoEditor.subjectReframe.sourceScene", { number: o.sceneNumber ?? "" })}
              </button>
            ))}
            {options.length === 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs text-white/40">
                <Film className="h-3.5 w-3.5" />
                {t("videoEditor.subjectReframe.noClips")}
              </span>
            )}
          </div>
          {options.length === 0 && (
            <input
              value={manualUrl}
              onChange={(e) => {
                setManualUrl(e.target.value);
                setResult(null);
                setError(null);
                setPhase("idle");
              }}
              placeholder={t("videoEditor.subjectReframe.sourcePlaceholder")}
              className="mt-2.5 w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-primary/60"
            />
          )}
        </div>

        {/* Aspect picker — the four shapes the tracking render offers */}
        <div>
          <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-2">
            {t("videoEditor.subjectReframe.aspectLabel")}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SUBJECT_REFRAME_ASPECTS.map((spec) => {
              const active = aspect === spec.key;
              const sw = spec.width / spec.height;
              return (
                <button
                  key={spec.key}
                  onClick={() => pickAspect(spec.key)}
                  disabled={working}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/[0.07]"
                      : "border-white/10 bg-white/[0.02] hover:border-white/25"
                  } disabled:opacity-50`}
                >
                  <div className="flex items-center justify-center h-14">
                    <div
                      className={`border-2 rounded-[3px] ${active ? "border-primary" : "border-white/30"}`}
                      style={{ aspectRatio: `${spec.width} / ${spec.height}`, height: sw >= 1 ? 40 : 52, maxWidth: "100%" }}
                    />
                  </div>
                  <p className="mt-2 text-xs font-black text-white">
                    {spec.key}{" "}
                    <span className="text-[10px] font-semibold text-white/45">
                      {t(ASPECT_NAME_KEYS[spec.key])}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[10px] font-mono text-white/40">
                    {spec.width} × {spec.height}
                  </p>
                  <p className="text-[10px] text-primary/70 font-semibold">
                    {t(ASPECT_PLATFORM_KEYS[spec.key])}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* How it works — including the honest fallback promise */}
        <p className="text-[11px] leading-relaxed text-white/40">
          {t("videoEditor.subjectReframe.trackingNote")}
        </p>

        {/* Render */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            onClick={() => void handleReframe()}
            disabled={working || !sourceUrl}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-black text-black hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {working ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {working
              ? t("videoEditor.subjectReframe.working")
              : t("videoEditor.subjectReframe.renderButton", { cost })}
          </button>
          <p className="text-xs text-white/50 text-center sm:text-right">
            <span className="font-black text-primary">{cost}</span>{" "}
            {t("videoEditor.subjectReframe.costSuffix")}
          </p>
        </div>
        {working && (
          <p className="text-[11px] text-white/40 -mt-1">
            {t("videoEditor.subjectReframe.workingHint")}
          </p>
        )}

        {/* Failure — the server refunds on any failure; say so */}
        {phase === "failed" && error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-200">{error}</p>
          </div>
        )}

        {/* Result */}
        {phase === "done" && result && (
          <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
            {result.reframe.mode === "subject-tracked" ? (
              <div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                  <p className="text-xs font-bold text-white">
                    {t("videoEditor.subjectReframe.doneTracked")} · {result.aspect} ·{" "}
                    {subjectReframeAspectSpec(result.aspect).width} ×{" "}
                    {subjectReframeAspectSpec(result.aspect).height}
                  </p>
                </div>
                <p className="mt-1 text-[11px] text-white/45">
                  {t("videoEditor.subjectReframe.doneTrackedDesc")}
                  {result.reframe.samples > 0 && (
                    <>
                      {" "}
                      {t("videoEditor.subjectReframe.trackedDetail", {
                        tracked: result.reframe.trackedSamples,
                        total: result.reframe.samples,
                      })}
                    </>
                  )}
                </p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0" />
                  <p className="text-xs font-bold text-white">
                    {t("videoEditor.subjectReframe.doneCentre")} · {result.aspect} ·{" "}
                    {subjectReframeAspectSpec(result.aspect).width} ×{" "}
                    {subjectReframeAspectSpec(result.aspect).height}
                  </p>
                </div>
                <p className="mt-1 text-[11px] text-white/45">
                  {t("videoEditor.subjectReframe.centreDesc")}
                  {reasonKey && (
                    <> {t(`videoEditor.subjectReframe.${reasonKey}`)}</>
                  )}
                </p>
              </div>
            )}

            <video
              src={result.url}
              controls
              playsInline
              className="w-full rounded-lg border border-white/10 max-h-64 bg-black"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <a
                href={result.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-black text-black hover:bg-primary/90 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                {t("videoEditor.subjectReframe.download")}
              </a>
              {resultSource?.sceneId && onReplaceClipVideo && (
                <button
                  onClick={handleUseInTimeline}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-white/80 hover:text-white hover:border-primary/40 transition-colors"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  {t("videoEditor.subjectReframe.useInTimeline")}
                </button>
              )}
              {onUseAsExport && (
                <button
                  onClick={handleUseAsExport}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-white/80 hover:text-white hover:border-primary/40 transition-colors"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("videoEditor.subjectReframe.useAsExport")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
