import { useState, useEffect } from "react";
import {
  Download, Film, Loader2, AlertTriangle, CheckCircle2, XCircle,
  Clapperboard, ExternalLink, Check, Minus, Volume2, VolumeX,
  Shield, RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";
import type { SceneData } from "@/lib/scene-parser";
import type { VideoAudioSource, VideoFormat, ExportResolution, CaptionSettings, BrandingSettings, CaptionExportMode, OverlayItem, ClipEdit } from "@/lib/editor-settings";
import { computeManualTimings } from "@/lib/scene-timing";

interface ExportRecord {
  final_video_url: string;
  export_status: "completed" | "failed" | string;
  export_created_at: string;
  clips_used: number;
  audio_used: boolean;
  audio_source?: string;
  aspect_ratio?: string;
  timeline_order?: string[];
}

interface ClipCheckRow {
  sceneNumber: number;
  sceneTitle: string;
  clipDbId: string | null;
  provider: string | null;
  approved: boolean;
  selected: boolean;
  sourceFieldName: string;
  originalUrl: string;
  resolvedUrl: string;
  sourceType: string;
  sourceUrlStartsWithHttp: boolean;
  sourceUrlDownloadable: boolean;
  localPath: string;
  fileWritten: boolean;
  fileExistsAfterWrite: boolean;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  ffprobeValid: boolean;
  readyForFFmpeg: boolean;
  error: string | null;
  responseStatus: number;
  contentType: string;
}

interface AudioCheckRow {
  requested: boolean;
  sourceUrl: string;
  localPath: string;
  fileWritten: boolean;
  fileExistsAfterWrite: boolean;
  fileSize: number;
  duration: number;
  ffprobeValid: boolean;
  ready: boolean;
  error: string | null;
  responseStatus: number;
  contentType: string;
}

/** Parse a fetch Response as JSON, surfacing the route when HTML is returned (PART 5) */
async function parseJsonResponse<T>(res: Response, route: string): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!ct.toLowerCase().includes("application/json")) {
    const snippet = text.slice(0, 120).replace(/\s+/g, " ").trim();
    throw new Error(
      `Route ${route} returned ${ct || "non-JSON"} instead of JSON (HTTP ${res.status}). ` +
      `This is an API routing problem. First bytes: ${snippet || "(empty)"}`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Route ${route} returned malformed JSON (HTTP ${res.status}).`);
  }
}

interface FinalVideoExportProps {
  scenes: SceneData[];
  projectId?: string | null;
  audioUrl?: string | null;
  /** The EXACT audio URL the master player is using — preferred source. */
  masterAudioUrl?: string | null;
  audioSource?: VideoAudioSource;
  audioSourceLabel?: string;
  fadeAudioInSec?: number;
  fadeAudioOutSec?: number;
  loopAudio?: boolean;
  /** Offset (seconds) into the audio where playback begins at video time 0. */
  audioStartSec?: number;
  /** Trim the audio to match the video length (studio "match length"). */
  matchVideoLength?: boolean;
  addWatermark?: boolean;
  customWatermarkUrl?: string | null;
  /** Legacy (non-branding) watermark placement/size/margin — mirrors settings.watermarkPosition
   *  / watermarkSize / watermarkMargin so the burned-in watermark matches the Master Player preview. */
  watermarkPosition?: string;
  watermarkSize?: string;
  watermarkMargin?: number;
  aspectRatio?: VideoFormat;
  resolution?: ExportResolution;
  existingExport?: ExportRecord | null;
  onExportComplete?: (record: ExportRecord) => void;
  captions?: CaptionSettings | null;
  captionExportMode?: CaptionExportMode;
  branding?: BrandingSettings | null;
  /** When set, export only this time slice (seconds). null = full video. */
  exportRangeStart?: number | null;
  exportRangeEnd?: number | null;
  /** Human-readable label like "00:00.000 → 00:10.000" for the UI. */
  exportRangeLabel?: string;
  /** True when the caller (Export Range UI) determined the selected custom range
   *  doesn't resolve to a usable range (e.g. start/end left at 00:00.000, or end
   *  before start). Blocks export instead of letting it reach the backend/FFmpeg. */
  rangeInvalid?: boolean;
  /** Human-readable reason shown to the user when rangeInvalid is true. */
  rangeInvalidReason?: string;
  /** Per-clip transition overrides: index matches clipUrls, null = Cut */
  clipTransitions?: ({ type: string; duration: number } | null)[];
  /** Structured overlay items to burn in */
  overlayItems?: OverlayItem[];
  /** "manual" enables freeform clip placement — clips are reordered by manualStartSec and
   *  gaps (including a leading gap before the first clip) are held as freeze-frame padding
   *  in the export, mirroring the editor preview. */
  timelineLayout?: "auto" | "manual";
  /** Per-scene edits keyed by scene id — only manualStartSec is read here. */
  clipEdits?: Record<string, ClipEdit | undefined>;
  /** Known audio duration (seconds), used to resolve manual layout timings. */
  audioDurationSec?: number | null;
  /** Song crop/trim window — export range is intersected with this when enabled. */
  songCrop?: { enabled: boolean; startSec: number; endSec: number } | null;
  /** Global Auto AI effects (settings.effects) — mirrors the master player's live
   *  CSS preview. Burned into the real export via the shared cssToFfmpegChain
   *  translation (same one Export Doctor uses). */
  effects?: string[] | null;
  /** Active overlay effect names (settings.overlays) — Light Leaks, Animated Waveform,
   *  Logo / Watermark, etc. Burned into the export via FFmpeg filter injection. */
  overlays?: string[] | null;
  /** Per-overlay intensity (0–100) keyed by overlay name (settings.overlayIntensity). */
  overlayIntensity?: Record<string, number> | null;
  /** How source clips fill the target canvas: "fill" (crop), "fit" (letterbox), "blur" (blurred bg).
   *  Defaults to "fill" when omitted. Forwarded to the server for FFmpeg normalization. */
  fitMode?: string | null;
}

type ExportStatus = "idle" | "exporting" | "completed" | "failed";

function parseDuration(timestamp: string): number | null {
  const m = timestamp?.match(/(\d+):(\d+(?:\.\d+)?)\s*[-–]\s*(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const start = parseInt(m[1]!) * 60 + parseFloat(m[2]!);
  const end   = parseInt(m[3]!) * 60 + parseFloat(m[4]!);
  const dur   = end - start;
  return dur > 0 ? dur : null;
}

export function isSelected(s: SceneData): boolean {
  if (!s.demoClipUrl || !s.demoClipUrl.startsWith("http")) return false;
  const isRunway =
    s.provider === "Runway" ||
    s.demoClipUrl.includes("dnznrvs05pmza.cloudfront.net");
  const isComplete =
    s.generationStatus === "completed" ||
    s.approved === true ||
    (!s.generationStatus && !!s.demoClipUrl);
  return isRunway && isComplete;
}

function sceneLabel(s: SceneData, i: number): string {
  const parts = [s.section, s.lyricLine].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ") : `Scene ${i + 1}`;
}

function audioSourceSummary(source: VideoAudioSource | undefined, label: string | undefined): string {
  if (!source || source === "none") return "No audio";
  return label ?? source;
}

export function FinalVideoExport({
  scenes,
  projectId,
  audioUrl,
  masterAudioUrl,
  audioSource = "uploaded",
  audioSourceLabel,
  fadeAudioInSec = 0,
  fadeAudioOutSec = 0,
  loopAudio = false,
  audioStartSec = 0,
  matchVideoLength = true,
  addWatermark = false,
  customWatermarkUrl,
  watermarkPosition = "bottom-right",
  watermarkSize = "medium",
  watermarkMargin = 16,
  aspectRatio = "9:16",
  resolution = "1080p",
  existingExport,
  onExportComplete,
  captions,
  captionExportMode = "burn",
  branding,
  exportRangeStart = null,
  exportRangeEnd = null,
  exportRangeLabel,
  rangeInvalid = false,
  rangeInvalidReason,
  clipTransitions,
  overlayItems,
  timelineLayout = "auto",
  clipEdits,
  audioDurationSec = null,
  songCrop,
  effects,
  overlays,
  overlayIntensity,
  fitMode,
}: FinalVideoExportProps) {
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();

  const isManualLayout = timelineLayout === "manual";

  /* ── Freeform layout: reorder selected scenes/transitions into playback order
     and compute gap-after padding, mirroring the editor preview's behavior. ── */
  const baseSelectedScenes = scenes.filter(isSelected);
  const manualResult = isManualLayout
    ? computeManualTimings(scenes, audioDurationSec, clipEdits ?? {})
    : null;

  let selectedScenes = baseSelectedScenes;
  let orderedClipTransitions = clipTransitions;
  let manualGapsBeforeSec: number[] | null = null;

  if (isManualLayout && manualResult) {
    // Order = ALL scene array indices sorted by timeline startSec. Filter down to
    // just the indices that made it into baseSelectedScenes (have a usable clip).
    const selectedSceneIds = new Set(baseSelectedScenes.map((s) => s.id));
    const orderedIndices = manualResult.order.filter((idx) => selectedSceneIds.has(scenes[idx]!.id));
    selectedScenes = orderedIndices.map((idx) => scenes[idx]!);
    orderedClipTransitions = orderedIndices.map((idx) => {
      const scene = scenes[idx]!;
      const timing = manualResult.timings[idx]!;
      // Overlap with the previous clip in playback order becomes a crossfade;
      // otherwise fall back to whatever transition was explicitly configured.
      if (timing.overlapWithPrevSec > 0) {
        return { type: "Crossfade", duration: timing.overlapWithPrevSec };
      }
      const original = clipTransitions?.[baseSelectedScenes.findIndex((s) => s.id === scene.id)];
      return original ?? null;
    });
    // gapBeforeSec (index-aligned with the ordered/playback sequence) already
    // includes the leading gap before the very first clip — sent as-is, no
    // shifting. The server holds each gap as a freeze-frame pad immediately
    // before the corresponding clip (black lead-in for the first clip, the
    // previous clip's frozen last frame for any clip after it).
    manualGapsBeforeSec = orderedIndices.map((idx) => {
      const timing = manualResult.timings[idx]!;
      return Math.max(0, timing.gapBeforeSec ?? 0);
    });
  }

  const clipUrls = selectedScenes.map((s) => s.demoClipUrl!);
  /* Duplicate URLs block export only when they look accidental. Scenes
     assigned via "Use existing clip" carry clipReusedIntentionally — a URL
     group is explained when at most one of its scenes lacks the flag. */
  const urlGroups = new Map<string, boolean[]>();
  clipUrls.forEach((url, i) => {
    const g = urlGroups.get(url) ?? [];
    g.push(selectedScenes[i]?.clipReusedIntentionally === true);
    urlGroups.set(url, g);
  });
  const hasDuplicateUrls = [...urlGroups.values()].some(
    (g) => g.length > 1 && g.filter((flagged) => !flagged).length > 1,
  );
  const hasIntentionalReuse = [...urlGroups.values()].some(
    (g) => g.length > 1 && g.some((flagged) => flagged),
  );

  /* ── Song crop: intersect the requested export range with the crop window ── */
  const cropEnabled = !!songCrop?.enabled;
  const effectiveExportRangeStart = cropEnabled
    ? Math.max(typeof exportRangeStart === "number" ? exportRangeStart : 0, songCrop!.startSec)
    : exportRangeStart;
  const effectiveExportRangeEnd = cropEnabled
    ? Math.min(
        typeof exportRangeEnd === "number" ? exportRangeEnd : songCrop!.endSec,
        songCrop!.endSec > songCrop!.startSec ? songCrop!.endSec : (audioDurationSec ?? Infinity),
      )
    : exportRangeEnd;

  const [status, setStatus] = useState<ExportStatus>(
    existingExport?.export_status === "completed" ? "completed" : "idle",
  );
  const [exportUrl, setExportUrl] = useState<string | null>(
    existingExport?.final_video_url ?? null,
  );
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);
  const [errorStderr, setErrorStderr]   = useState<string[] | null>(null);
  const [errorExitCode, setErrorExitCode] = useState<number | null>(null);
  const [confirmed, setConfirmed]       = useState(false);
  const [progressStep, setProgressStep] = useState<string>("");
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [prepareState, setPrepareState]         = useState<"idle" | "running" | "done" | "failed">("idle");
  const [prepareId, setPrepareId]               = useState<string | null>(null);
  const [prepareExpiresAt, setPrepareExpiresAt] = useState<number | null>(null);
  const [clipCheckResults, setClipCheckResults] = useState<ClipCheckRow[] | null>(null);
  const [audioCheckResult, setAudioCheckResult] = useState<AudioCheckRow | null>(null);
  const [prepareError, setPrepareError]         = useState<string | null>(null);
  const [prepareAllReady, setPrepareAllReady]   = useState(false);
  const [prepareReadyCount, setPrepareReadyCount] = useState(0);
  const [checkTableExpanded, setCheckTableExpanded] = useState(true);
  const [isAutoRecovering, setIsAutoRecovering] = useState(false);

  /* ── Live "expires in" ticker for the prepared session ── */
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!prepareExpiresAt) return;
    const interval = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(interval);
  }, [prepareExpiresAt]);
  const msUntilExpiry = prepareExpiresAt ? prepareExpiresAt - nowTick : null;
  const isPrepareLikelyExpired = msUntilExpiry !== null && msUntilExpiry <= 0;

  /* ── Audio source: prefer the EXACT URL the master player uses ── */
  const effectiveAudioUrl = (masterAudioUrl?.trim() || audioUrl?.trim()) || null;

  const anyClip = scenes.some((s) => !!s.demoClipUrl);
  if (!anyClip) return null;

  async function handlePrepare(): Promise<{ ready: boolean; prepareId: string | null }> {
    if (!projectId || selectedScenes.length === 0) return { ready: false, prepareId: null };
    setPrepareState("running");
    setPrepareId(null);
    setPrepareExpiresAt(null);
    setClipCheckResults(null);
    setAudioCheckResult(null);
    setPrepareError(null);
    setPrepareAllReady(false);
    setPrepareReadyCount(0);
    setCheckTableExpanded(true);
    try {
      const token = await getAccessToken();
      const clips = selectedScenes.map((s) => {
        const sceneNum = scenes.indexOf(s) + 1;
        const sceneTitle = [s.section, s.lyricLine].filter(Boolean).join(" — ") || `Scene ${sceneNum}`;
        return {
          sceneNumber: sceneNum,
          sceneTitle,
          clipId: s.clipId ?? null,
          provider: s.provider ?? null,
          approved: s.approved,
          selected: true,
          urlFields: {
            "scene.demoClipUrl": s.demoClipUrl ?? "",
          },
        };
      });
      const res = await fetch("/api/prepare-export-files", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          projectId,
          clips,
          // PART 2/3 — prepare the SAME audio the master player plays
          audioUrl: hasAudio ? effectiveAudioUrl : null,
        }),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      const data = await parseJsonResponse<{
        prepareId: string;
        allReady: boolean;
        totalClips: number;
        readyClips: number;
        clips: ClipCheckRow[];
        audio?: AudioCheckRow | null;
        expiresAt?: number;
        error?: string;
      }>(res, "/api/prepare-export-files");
      if (!res.ok) throw new Error(data.error ?? `Prepare failed (HTTP ${res.status})`);
      setPrepareId(data.prepareId);
      setPrepareExpiresAt(data.expiresAt ?? null);
      setNowTick(Date.now());
      setClipCheckResults(data.clips);
      setAudioCheckResult(data.audio ?? null);
      setPrepareAllReady(data.allReady);
      setPrepareReadyCount(data.readyClips);
      setPrepareState(data.allReady ? "done" : "failed");
      return { ready: data.allReady, prepareId: data.prepareId };
    } catch (err) {
      setPrepareState("failed");
      setPrepareError(err instanceof Error ? err.message : "Prepare failed");
      return { ready: false, prepareId: null };
    }
  }

  const hasAudio = !!effectiveAudioUrl && audioSource !== "none";
  /** Master player has audio but export couldn't resolve any audio URL */
  const audioSourceMismatch = !!masterAudioUrl?.trim() && !effectiveAudioUrl;
  const aspectLabel = aspectRatio === "9:16" ? "1080×1920 · TikTok / Reels / Shorts"
    : aspectRatio === "16:9" ? "1920×1080 · YouTube"
    : "1080×1080 · Square";

  const isRangeExport = typeof effectiveExportRangeStart === "number" && typeof effectiveExportRangeEnd === "number"
    && effectiveExportRangeEnd > effectiveExportRangeStart;

  /** Below this, a "range" export is effectively meaningless and FFmpeg can fail
   *  (near-zero-duration output). Matches the server-side guard in export-video.ts. */
  const MIN_RANGE_DURATION_SEC = 0.25;
  /** A range was requested (start/end resolved to numbers, e.g. via the song-crop
   *  intersection) but doesn't resolve to a usable, positive-length window — catches
   *  cases the caller's own validity flag wouldn't see (e.g. crop window collapse). */
  const derivedRangeInvalid =
    (typeof effectiveExportRangeStart === "number" || typeof effectiveExportRangeEnd === "number") &&
    !(isRangeExport && (effectiveExportRangeEnd! - effectiveExportRangeStart!) >= MIN_RANGE_DURATION_SEC);
  const exportRangeBlocked = rangeInvalid || derivedRangeInvalid;
  const exportRangeBlockedReason = rangeInvalid
    ? (rangeInvalidReason ?? "The selected custom export range is invalid.")
    : "The selected export range resolves to less than a quarter-second of video. Adjust the range or switch to Full Video.";

  /** Fires the export request against a specific prepareId. Throws on failure,
   *  with `.code` set to "PREPARE_STALE" when the failure is recoverable by re-preparing. */
  async function runExportRequest(prepareIdToUse: string | null) {
    const token = await getAccessToken();
    const timelineOrder = scenes.map((s) => s.id);

    const res = await fetch("/api/export-final-video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token ?? ""}`,
      },
      body: JSON.stringify({
        projectId,
        clipUrls,
        audioUrl: hasAudio ? effectiveAudioUrl : null,
        timelineOrder,
        testMode: false,
        aspectRatio,
        fadeAudioInSec: hasAudio ? fadeAudioInSec : 0,
        fadeAudioOutSec: hasAudio ? fadeAudioOutSec : 0,
        loopAudio: hasAudio ? loopAudio : false,
        audioStartSec: hasAudio ? audioStartSec : 0,
        matchVideoLength: hasAudio ? matchVideoLength : false,
        addWatermark,
        customWatermarkUrl: addWatermark ? (customWatermarkUrl ?? null) : null,
        watermarkPosition,
        watermarkSize,
        watermarkMargin,
        audioSource,
        captions: captionExportMode === "burn" && captions && captions.mode !== "none" ? captions : null,
        captionExportMode,
        branding: branding ?? null,
        exportRangeStart: typeof effectiveExportRangeStart === "number" ? effectiveExportRangeStart : null,
        exportRangeEnd:   typeof effectiveExportRangeEnd   === "number" ? effectiveExportRangeEnd   : null,
        clipTransitions:  orderedClipTransitions ?? null,
        manualGapsBeforeSec: manualGapsBeforeSec ?? null,
        effects:               effects?.length ? effects : null,
        overlayItems:          overlayItems?.length ? overlayItems : null,
        overlayEffects:        overlays?.length ? overlays : null,
        overlayEffectIntensity: overlayIntensity ?? null,
        fitMode:               fitMode ?? "fill",
        prepareId:             prepareIdToUse ?? undefined,
      }),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });

    if (!res.ok) {
      const body = await parseJsonResponse<{
        error?: string;
        code?: string;
        exportStatus?: Record<string, unknown>;
        ffmpegStderr?: string;
        stderrTail?: string[];
        ffmpegExitCode?: number;
      }>(res, "POST /api/generate/export-video");
      const err = Object.assign(
        new Error(body.error ?? `Export failed (HTTP ${res.status})`),
        {
          code:           body.code,
          exportStatus:   body.exportStatus,
          ffmpegStderr:   body.ffmpegStderr,
          stderrTail:     body.stderrTail,
          ffmpegExitCode: body.ffmpegExitCode,
        },
      );
      throw err;
    }

    const data = await parseJsonResponse<{
      url: string;
      clipCount: number;
      audioIncluded: boolean;
      audioSource?: string;
      duration?: number;
      testMode?: boolean;
      exportStatus?: Record<string, unknown>;
      debug?: { identicalClipsDetected?: boolean };
    }>(res, "POST /api/generate/export-video");

    if (data.debug?.identicalClipsDetected && !hasIntentionalReuse) {
      throw new Error(
        "Server detected two or more downloaded clips with identical content. " +
        "Re-generate the affected Runway clips and try again.",
      );
    }

    return { data, timelineOrder };
  }

  async function handleExport() {
    if (!projectId) {
      toast({ title: "Save project first", description: "Save your project before exporting.", variant: "destructive" });
      return;
    }
    if (selectedScenes.length === 0) {
      toast({ title: "No clips ready", description: "Generate Runway clips on the scenes first.", variant: "destructive" });
      return;
    }
    if (hasDuplicateUrls) {
      toast({
        title: "Duplicate clip URLs detected",
        description: "Two or more scenes share the same clip URL. Re-generate the affected clips then export again.",
        variant: "destructive",
      });
      return;
    }
    if (exportRangeBlocked) {
      toast({ title: "Invalid export range", description: exportRangeBlockedReason, variant: "destructive" });
      return;
    }

    setStatus("exporting");
    setErrorMsg(null);
    setProgressStep("Verifying clips…");

    try {
      setProgressStep(
        `Stitching ${selectedScenes.length} clip${selectedScenes.length > 1 ? "s" : ""}` +
        ` · ${aspectRatio} · ${resolution}` +
        (hasAudio ? ` · mixing audio…` : " · no audio…"),
      );

      let result;
      try {
        result = await runExportRequest(prepareId);
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === "PREPARE_STALE") {
          // The prepared session vanished (server restart / TTL expiry / source
          // drift) between "Prepare Export Files Only" and this click. Silently
          // re-prepare once with the current clip/audio state and retry.
          setIsAutoRecovering(true);
          setProgressStep("Prepared files expired — re-preparing automatically…");
          const { ready, prepareId: freshPrepareId } = await handlePrepare();
          if (!ready || !freshPrepareId) {
            setIsAutoRecovering(false);
            throw new Error(
              "Prepared files expired and automatic re-preparation failed. " +
              "Click 'Prepare Export Files Only' again and try exporting.",
            );
          }
          setProgressStep(
            `Re-prepared — stitching ${selectedScenes.length} clip${selectedScenes.length > 1 ? "s" : ""}` +
            ` · ${aspectRatio} · ${resolution}` +
            (hasAudio ? ` · mixing audio…` : " · no audio…"),
          );
          result = await runExportRequest(freshPrepareId);
          setIsAutoRecovering(false);
        } else {
          throw err;
        }
      }

      const { data, timelineOrder } = result;

      setExportUrl(data.url);
      setStatus("completed");
      setProgressStep("");

      const record: ExportRecord = {
        final_video_url: data.url,
        export_status: "completed",
        export_created_at: new Date().toISOString(),
        clips_used: clipUrls.length,
        audio_used: data.audioIncluded,
        audio_source: audioSource,
        aspect_ratio: aspectRatio,
        timeline_order: timelineOrder,
      };
      onExportComplete?.(record);
      toast({
        title: "Export complete!",
        description: `${data.clipCount} clip${data.clipCount > 1 ? "s" : ""} · ${aspectRatio}${data.audioIncluded ? " · with audio" : " · video only"}.`,
      });
    } catch (err: unknown) {
      setIsAutoRecovering(false);
      const msg = err instanceof Error ? err.message : "Export failed";
      if (msg === "out_of_credits") {
        setStatus("idle");
        setProgressStep("");
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      setStatus("failed");
      setErrorMsg(msg);
      setErrorStderr((err as { stderrTail?: string[] }).stderrTail ?? null);
      setErrorExitCode((err as { ffmpegExitCode?: number }).ffmpegExitCode ?? null);
      setProgressStep("");
      toast({ title: "Export failed", description: msg.slice(0, 120), variant: "destructive" });
    }
  }

  return (
    <div
      className="rounded-2xl border border-primary/20 bg-black/40 overflow-hidden"
      data-testid="final-video-export"
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10">
        <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Clapperboard className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-white uppercase tracking-wider">Final Video Export</h3>
          <p className="text-xs text-white/40 mt-0.5">
            {selectedScenes.length} of {scenes.length} clip{scenes.length !== 1 ? "s" : ""} selected
            {" · "}{aspectLabel}
            {hasAudio ? ` · ${audioSourceSummary(audioSource, audioSourceLabel)}` : " · no audio"}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="p-5 space-y-4">

        {/* ── Out of credits ── */}
        {outOfCredits && <OutOfCredits />}

        {/* ── Completed ── */}
        {!outOfCredits && status === "completed" && exportUrl && (
          <div className="space-y-3" data-testid="export-result">
            <video
              src={exportUrl}
              controls
              playsInline
              className="w-full rounded-xl bg-black border border-white/10"
              style={{ maxHeight: 400 }}
              data-testid="export-video-player"
            />
            <a
              href={exportUrl}
              download="music-video-export.mp4"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button className="gold-glow w-full gap-2" data-testid="btn-download-final-video">
                <Download className="h-4 w-4" />
                Download Final Video ({selectedScenes.length} clip{selectedScenes.length !== 1 ? "s" : ""}{hasAudio ? " + audio" : ""})
              </Button>
            </a>
            <button
              onClick={() => { setStatus("idle"); setExportUrl(null); setConfirmed(false); }}
              className="w-full text-center text-[11px] text-white/25 hover:text-white/50 transition-colors"
              data-testid="btn-export-again"
            >
              Export again with updated settings
            </button>

            {/* ── Share: turn creators into marketers ── */}
            <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3 space-y-2">
              <p className="text-xs font-bold text-white/70">🔥 Your video is ready — show it off!</p>
              <p className="text-[11px] text-white/40 leading-relaxed">
                Share it and tag <span className="text-primary font-bold">@bowdownvisuals</span> for a chance to be featured.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const text = encodeURIComponent("Just made this with @bowdownvisuals 🔥");
                    window.open(`https://twitter.com/intent/tweet?text=${text}`, "_blank");
                  }}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors text-xs font-bold"
                >
                  𝕏 Post
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText("Made with Bow Down Visuals 🔥 bowdownvisuals.com");
                  }}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors text-xs font-bold"
                >
                  Copy Caption
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Failed ── */}
        {status === "failed" && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0 w-full">
              <p className="text-sm font-semibold text-red-300">
                Export Failed{errorExitCode !== null ? ` (exit ${errorExitCode})` : ""}
              </p>
              {errorMsg && (
                <p className="text-xs text-red-400/80 mt-1 leading-relaxed break-words">{errorMsg}</p>
              )}
              {errorStderr && errorStderr.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[10px] text-red-400/60 cursor-pointer hover:text-red-400/80 select-none">
                    FFmpeg error details ({errorStderr.length} lines)
                  </summary>
                  <pre className="mt-1 text-[9px] text-red-300/70 bg-black/40 rounded p-2 overflow-x-auto overflow-y-auto max-h-40 whitespace-pre-wrap break-all leading-relaxed">
                    {errorStderr.join("\n")}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}

        {/* ── Exporting ── */}
        {status === "exporting" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="export-status-exporting">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <div>
              <p className="text-sm font-bold text-white">Exporting Final Video…</p>
              <p className="text-xs text-white/40 mt-1">{progressStep || "Processing…"}</p>
              <p className="text-[11px] text-white/25 mt-2">Keep this page open · takes ~30–90 s</p>
            </div>
          </div>
        )}

        {/* ── Idle / Ready ── */}
        {(status === "idle" || status === "failed") && (
          <div className="space-y-3">

            {/* Clips panel */}
            <ClipsPanel scenes={scenes} />

            {/* Audio summary */}
            <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${
              hasAudio ? "border-green-500/20 bg-green-500/[0.04]" : "border-white/[0.07] bg-white/[0.02]"
            }`}>
              {hasAudio
                ? <Volume2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                : <VolumeX className="h-3.5 w-3.5 text-white/30 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold ${hasAudio ? "text-green-300" : "text-white/40"}`}>
                  {hasAudio ? `Audio: ${audioSourceSummary(audioSource, audioSourceLabel)}` : "No audio selected"}
                </p>
                {hasAudio && (
                  <p className="text-[10px] text-white/30 mt-0.5">
                    {[
                      fadeAudioInSec > 0 && "Fade in",
                      fadeAudioOutSec > 0 && "Fade out",
                      loopAudio && "Loop if shorter",
                    ].filter(Boolean).join(" · ") || "No audio effects"}
                  </p>
                )}
              </div>
            </div>

            {/* Caption export debug */}
            {(() => {
              const KNOWN_PRESETS = ["clean-white", "gold-hiphop", "karaoke", "boxed", "viral-shorts", "minimal"];
              const captionsFound = !!(captions && captions.lines && captions.lines.length > 0);
              const captionCount = captions?.lines?.length ?? 0;
              const styleFound = KNOWN_PRESETS.includes(captions?.stylePreset ?? "");
              const burnSelected = captionExportMode === "burn";
              const captionsSent = burnSelected && captionsFound && captions?.mode !== "none";
              const firstLine = captions?.lines?.[0];
              const lastLine = captions?.lines?.[captionCount - 1];
              const rows: [string, boolean | null, string][] = [
                ["Captions found", captionsFound, captionsFound ? "yes" : "no"],
                ["Caption count", null, String(captionCount)],
                ["Caption style found", styleFound, styleFound ? `yes (${captions?.stylePreset ?? "—"})` : `no (${captions?.stylePreset ?? "—"})`],
                ["Burn captions selected", burnSelected, burnSelected ? "yes" : "no"],
                ["Captions sent to render pipeline", captionsSent, captionsSent ? "yes" : "no"],
                ["First caption start/end", null, firstLine ? `${firstLine.startSec.toFixed(2)}s – ${firstLine.endSec.toFixed(2)}s` : "—"],
                ["Last caption start/end", null, lastLine ? `${lastLine.startSec.toFixed(2)}s – ${lastLine.endSec.toFixed(2)}s` : "—"],
              ];
              return (
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.03]">
                    <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">Export Caption Debug</p>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {rows.map(([label, ok, val]) => (
                      <div key={label} className="flex items-center justify-between px-3 py-1.5 gap-2">
                        <span className="text-[10px] text-white/40">{label}</span>
                        <span className={`text-[10px] font-mono font-bold ${
                          ok === true ? "text-green-400" : ok === false ? "text-red-400" : "text-white/50"
                        }`}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Warnings */}
            {selectedScenes.length === 1 && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200/80 leading-relaxed">
                  Only 1 clip is selected. Generate Runway clips for other scenes to include them.
                </p>
              </div>
            )}

            {hasDuplicateUrls && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-red-300">Duplicate clip URLs detected</p>
                  <p className="text-xs text-red-400/80 mt-0.5 leading-relaxed">
                    Two scenes point to the same URL. Re-generate those scenes first.
                  </p>
                </div>
              </div>
            )}

            {!hasDuplicateUrls && hasIntentionalReuse && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-primary">Clips intentionally reused</p>
                  <p className="text-xs text-white/50 mt-0.5 leading-relaxed">
                    Some scenes share a clip on purpose. Each scene still exports its own segment.
                  </p>
                </div>
              </div>
            )}

            {isRangeExport && (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-primary/20 bg-primary/5">
                <Minus className="h-3.5 w-3.5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-primary">Range export selected</p>
                  <p className="text-[10px] text-white/40 mt-0.5">{exportRangeLabel ?? `${exportRangeStart?.toFixed(2)}s → ${exportRangeEnd?.toFixed(2)}s`}</p>
                </div>
              </div>
            )}

            {!confirmed && !hasDuplicateUrls && selectedScenes.length > 0 && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-white/[0.03] border border-white/[0.08]">
                <AlertTriangle className="h-4 w-4 text-white/30 shrink-0 mt-0.5" />
                <p className="text-xs text-white/40 leading-relaxed">
                  Clips download fresh, normalize to {aspectLabel}, and stitch in timeline order.
                  {hasAudio ? " Audio is mixed underneath." : " No audio in this export."}
                  {isRangeExport ? " Only the selected time range will be in the output." : ""}
                  {" "}Keep the page open.
                </p>
              </div>
            )}

            {/* ── Prepare Export Files ── */}
            {!hasDuplicateUrls && selectedScenes.length > 0 && (
              <div className="space-y-3">

                {/* Prepare status summary */}
                {prepareState !== "idle" && (
                  <div className={`flex flex-wrap gap-x-4 gap-y-1.5 px-3 py-2.5 rounded-xl border text-[10px] font-mono ${
                    prepareAllReady
                      ? "border-green-500/25 bg-green-500/[0.05]"
                      : prepareState === "failed"
                      ? "border-red-500/20 bg-red-500/[0.04]"
                      : "border-white/[0.07] bg-white/[0.02]"
                  }`}>
                    <span className="text-white/40">Export files prepared:
                      <span className={`ml-1 font-bold ${prepareAllReady ? "text-green-400" : prepareState === "running" ? "text-white/50" : "text-red-400"}`}>
                        {prepareState === "running" ? "…" : prepareAllReady ? "yes" : "no"}
                      </span>
                    </span>
                    {prepareState !== "running" && clipCheckResults && (
                      <span className="text-white/40">Clips ready:
                        <span className={`ml-1 font-bold ${prepareAllReady ? "text-green-400" : "text-amber-400"}`}>
                          {prepareReadyCount}/{clipCheckResults.length}
                        </span>
                      </span>
                    )}
                    {prepareState !== "running" && hasAudio && (
                      <span className="text-white/40">Audio ready:
                        <span className={`ml-1 font-bold ${audioCheckResult?.ready ? "text-green-400" : "text-red-400"}`}>
                          {audioCheckResult?.ready ? "yes" : "no"}
                        </span>
                      </span>
                    )}
                    <span className="text-white/40">FFmpeg started:
                      <span className="ml-1 font-bold text-white/30">no</span>
                    </span>
                    {prepareState === "failed" && prepareError && (
                      <span className="w-full text-red-400/80 mt-0.5">{prepareError}</span>
                    )}
                  </div>
                )}

                {/* Two action buttons — neither runs FFmpeg */}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={handlePrepare}
                    disabled={prepareState === "running"}
                    variant="outline"
                    className="gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs"
                    data-testid="btn-debug-export-sources"
                  >
                    {prepareState === "running" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {prepareState === "running" ? "Checking…" : "Debug Export Sources"}
                  </Button>
                  <Button
                    onClick={handlePrepare}
                    disabled={prepareState === "running"}
                    variant="outline"
                    className={`gap-2 text-xs ${
                      prepareAllReady
                        ? "border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10"
                        : "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                    }`}
                    data-testid="btn-prepare-export"
                  >
                    {prepareState === "running" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : prepareAllReady ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <Shield className="h-3.5 w-3.5" />
                    )}
                    {prepareAllReady
                      ? `Re-prepare (${prepareReadyCount}/${selectedScenes.length} ready)`
                      : "Prepare Export Files Only"}
                  </Button>
                </div>

                {/* Audio source mismatch warning (PART 2) */}
                {audioSourceMismatch && (
                  <div className="px-3 py-2 rounded-xl border border-red-500/25 bg-red-500/[0.05] text-[11px] text-red-400/90 leading-relaxed">
                    Export audio source not connected to master player audio source.
                    The master player is playing audio but no export audio URL could be resolved.
                  </div>
                )}

                {/* Check table */}
                {clipCheckResults && clipCheckResults.length > 0 && (
                  <ExportFileCheckTable
                    rows={clipCheckResults}
                    expanded={checkTableExpanded}
                    onToggle={() => setCheckTableExpanded((x) => !x)}
                  />
                )}

                {/* Export Audio Source debug (PART 2) */}
                {prepareState !== "idle" && hasAudio && (
                  <ExportAudioDebug
                    audio={audioCheckResult}
                    masterAudioUrl={masterAudioUrl ?? null}
                    effectiveAudioUrl={effectiveAudioUrl}
                  />
                )}

                {/* Export Readiness summary (PART 6) */}
                {prepareState !== "idle" && prepareState !== "running" && clipCheckResults && (
                  <ExportReadinessPanel
                    clipSourcesFound={clipCheckResults.filter((r) => !!r.sourceFieldName).length}
                    clipsDownloaded={clipCheckResults.filter((r) => r.fileExistsAfterWrite).length}
                    clipsValid={clipCheckResults.filter((r) => r.ffprobeValid).length}
                    totalClips={clipCheckResults.length}
                    hasAudio={hasAudio}
                    audioSourceFound={hasAudio}
                    audioDownloaded={!!audioCheckResult?.fileExistsAfterWrite}
                    audioValid={!!audioCheckResult?.ffprobeValid}
                    readyForFFmpeg={prepareAllReady}
                  />
                )}

                {/* Prepared-session expiry indicator */}
                {prepareAllReady && msUntilExpiry !== null && (
                  <p className={`text-center text-[10px] leading-relaxed ${
                    isPrepareLikelyExpired ? "text-amber-400/80" : "text-white/25"
                  }`}>
                    {isPrepareLikelyExpired
                      ? "Prepared files may have expired — clicking export will auto re-prepare if needed."
                      : `Prepared files expire in ~${Math.max(1, Math.round(msUntilExpiry / 60_000))} min. Export before then, or re-prepare.`}
                  </p>
                )}

                {/* Invalid export range — block before the confirm/export buttons */}
                {exportRangeBlocked && (
                  <div className="space-y-2">
                    <Button disabled className="w-full gap-2 opacity-50 cursor-not-allowed" data-testid="btn-export-range-blocked">
                      <XCircle className="h-4 w-4" />
                      Export Blocked — Invalid Export Range
                    </Button>
                    <p className="text-center text-[11px] text-red-400/80 leading-relaxed">{exportRangeBlockedReason}</p>
                  </div>
                )}

                {/* Export buttons — only shown when all clips are ready and the range is valid */}
                {prepareAllReady && !exportRangeBlocked && (
                  <>
                    {!confirmed ? (
                      <Button
                        onClick={() => setConfirmed(true)}
                        variant="outline"
                        className="w-full border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 gap-2"
                        data-testid="btn-confirm-export"
                      >
                        <Film className="h-4 w-4" />
                        {isRangeExport
                          ? `Export Selected Range — ${exportRangeLabel ?? "custom range"}`
                          : `Export Full Video — ${selectedScenes.length} clip${selectedScenes.length !== 1 ? "s" : ""}${hasAudio ? " + audio" : ", no audio"} · ${aspectRatio}`}
                      </Button>
                    ) : (
                      <Button
                        onClick={handleExport}
                        disabled={isAutoRecovering}
                        className="gold-glow w-full gap-2"
                        data-testid="btn-start-export"
                      >
                        {isAutoRecovering ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Film className="h-4 w-4" />
                        )}
                        {isAutoRecovering ? "Re-preparing…" : "Confirm & Start Export"}
                      </Button>
                    )}
                  </>
                )}

                {/* Block message when prepare not done */}
                {prepareState === "idle" && (
                  <p className="text-center text-[11px] text-white/25 leading-relaxed">
                    Click <span className="text-white/45">Debug Export Sources</span> or <span className="text-white/45">Prepare Export Files Only</span> to verify all clips.{" "}
                    FFmpeg will not start until all clips are ready.
                  </p>
                )}
                {prepareState === "failed" && !prepareAllReady && (
                  <p className="text-center text-[11px] text-red-400/60 leading-relaxed">
                    Some clips failed — fix the errors above and re-prepare before exporting.
                  </p>
                )}
              </div>
            )}

            {/* Blocked states */}
            {hasDuplicateUrls && (
              <Button disabled className="w-full gap-2 opacity-50 cursor-not-allowed">
                <XCircle className="h-4 w-4" />
                Export Blocked — Fix Duplicate Clips First
              </Button>
            )}
            {selectedScenes.length === 0 && (
              <Button disabled className="w-full gap-2 opacity-50 cursor-not-allowed">
                <Film className="h-4 w-4" />
                No Clips Ready to Export
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Clips panel ─────────────────────────────────────── */
function ClipsPanel({ scenes }: { scenes: SceneData[] }) {
  const selectedCount = scenes.filter(isSelected).length;
  const urls = scenes.filter(isSelected).map((s) => s.demoClipUrl!);
  const urlCounts = new Map<string, number>();
  for (const u of urls) urlCounts.set(u, (urlCounts.get(u) ?? 0) + 1);

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
      <div className="px-3 py-2 bg-white/[0.04] border-b border-white/[0.06] flex items-center justify-between">
        <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">
          Clips Included In Export
        </p>
        <span className="text-[10px] font-bold text-white/30">
          {selectedCount} / {scenes.length} selected
        </span>
      </div>

      <div className="grid grid-cols-[20px_1fr_60px_72px_44px_44px_40px] gap-x-2 px-3 py-1.5 bg-white/[0.02] border-b border-white/[0.04]">
        <span className="text-[9px] font-bold text-white/20 uppercase">#</span>
        <span className="text-[9px] font-bold text-white/20 uppercase">Description</span>
        <span className="text-[9px] font-bold text-white/20 uppercase">Provider</span>
        <span className="text-[9px] font-bold text-white/20 uppercase">Status</span>
        <span className="text-[9px] font-bold text-white/20 uppercase">URL</span>
        <span className="text-[9px] font-bold text-white/20 uppercase">Selected</span>
        <span className="text-[9px] font-bold text-white/20 uppercase text-right">Dur.</span>
      </div>

      <div className="divide-y divide-white/[0.04]">
        {scenes.map((scene, i) => {
          const selected  = isSelected(scene);
          const hasUrl    = !!scene.demoClipUrl && scene.demoClipUrl.startsWith("http");
          const isDupe    = hasUrl && (urlCounts.get(scene.demoClipUrl!) ?? 0) > 1;
          const dur       = parseDuration(scene.timestamp ?? "");

          let skipReason = "";
          if (!hasUrl) skipReason = "no clip URL";
          else if (!selected) {
            const isRunway =
              scene.provider === "Runway" ||
              scene.demoClipUrl!.includes("dnznrvs05pmza.cloudfront.net");
            skipReason = !isRunway ? "provider not Runway" : "status not completed";
          }

          return (
            <div
              key={scene.id}
              className={`grid grid-cols-[20px_1fr_60px_72px_44px_44px_40px] gap-x-2 items-start px-3 py-2.5 ${
                isDupe ? "bg-red-500/5" : selected ? "" : "opacity-50"
              }`}
            >
              <span className="text-[11px] font-black text-white/30 pt-0.5">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-[11px] text-white/70 font-medium truncate leading-tight">
                  {sceneLabel(scene, i)}
                </p>
                {hasUrl && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[9px] font-mono truncate ${isDupe ? "text-red-400/70" : "text-white/20"}`}>
                      {"…" + scene.demoClipUrl!.replace(/[?#].*$/, "").slice(-36)}
                    </span>
                    <a
                      href={scene.demoClipUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-primary/40 hover:text-primary/80 transition-colors"
                      title="Open clip"
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                )}
                {skipReason && <p className="text-[9px] text-red-400/60 mt-0.5">{skipReason}</p>}
                {isDupe && <p className="text-[9px] text-red-400 font-bold mt-0.5">⚠ duplicate URL</p>}
              </div>
              <span className={`text-[10px] font-bold pt-0.5 ${scene.provider === "Runway" ? "text-purple-400" : "text-white/25"}`}>
                {scene.provider || "—"}
              </span>
              <span className={`text-[10px] font-bold pt-0.5 ${statusColor(scene)}`}>
                {statusLabel(scene)}
              </span>
              <span className="flex items-center pt-1">
                {hasUrl ? <Check className="h-3 w-3 text-green-400" /> : <Minus className="h-3 w-3 text-white/20" />}
              </span>
              <span className="flex items-center pt-1">
                {selected ? <Check className="h-3 w-3 text-green-400" /> : <Minus className="h-3 w-3 text-white/20" />}
              </span>
              <span className="text-[10px] text-white/30 text-right pt-0.5">
                {dur !== null ? `${dur}s` : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-2 bg-white/[0.02] border-t border-white/[0.06] flex items-center justify-between gap-2">
        <span className="text-[10px] text-white/25">
          {selectedCount === 0
            ? "No clips ready — generate Runway clips above"
            : selectedCount === scenes.length
            ? "All scenes have clips — ready to export"
            : `${scenes.length - selectedCount} scene${scenes.length - selectedCount > 1 ? "s" : ""} without clips will be skipped`}
        </span>
        <span className="text-[10px] font-bold text-white/40 shrink-0">
          {selectedCount} clip{selectedCount !== 1 ? "s" : ""} → export
        </span>
      </div>
    </div>
  );
}

/* ── Export File Check Table ─────────────────────────── */
function ExportFileCheckTable({
  rows, expanded, onToggle,
}: {
  rows: ClipCheckRow[];
  expanded: boolean;
  onToggle: () => void;
}) {
  function fmt(bytes: number): string {
    if (bytes === 0) return "—";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  function fmtDur(s: number): string {
    return s > 0 ? `${s.toFixed(1)}s` : "—";
  }
  function yn(v: boolean | null, forceShow = true): React.ReactElement {
    if (v === null || (!forceShow && v === false)) return <span className="text-white/25">—</span>;
    return v
      ? <span className="text-green-400 font-bold">yes</span>
      : <span className="text-red-400 font-bold">no</span>;
  }

  const allReady = rows.every((r) => r.readyForFFmpeg);

  return (
    <div className="rounded-xl border border-white/[0.08] overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.03] border-b border-white/[0.06] hover:bg-white/[0.05] transition-colors"
      >
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Debug Export Sources</p>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${allReady ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-400"}`}>
            {rows.filter((r) => r.readyForFFmpeg).length}/{rows.length} ready for FFmpeg
          </span>
        </div>
        {expanded
          ? <ChevronUp className="h-3 w-3 text-white/30" />
          : <ChevronDown className="h-3 w-3 text-white/30" />}
      </button>

      {expanded && (
        <div className="space-y-0 divide-y divide-white/[0.04]">
          {rows.map((row) => {
            const ok = row.readyForFFmpeg;
            const httpOk = row.responseStatus >= 200 && row.responseStatus < 300;
            const ctShort = row.contentType ? row.contentType.split(";")[0]?.trim() ?? "" : "";
            const ctBad = ctShort.startsWith("text/") || ctShort.startsWith("application/json") || ctShort.startsWith("application/xml");
            const hasUrl = !!row.originalUrl;
            const sourceUrlValue = row.resolvedUrl || row.originalUrl || "";

            return (
              <div
                key={row.sceneNumber}
                className={`px-3 py-3 ${ok ? "" : "bg-red-500/[0.03]"}`}
              >
                {/* Card header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-black text-white/60">Scene {row.sceneNumber}</span>
                    {row.sceneTitle && (
                      <span className="text-[10px] text-white/35 truncate max-w-[200px]">— {row.sceneTitle}</span>
                    )}
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${ok ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                    {ok ? "Ready for FFmpeg ✓" : "Not ready ✗"}
                  </span>
                </div>

                {/* Fields grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[9px]">
                  <Field label="Scene number" value={String(row.sceneNumber)} />
                  <Field label="Scene title" value={row.sceneTitle || "—"} />
                  <Field label="Clip database ID" value={row.clipDbId || "—"} mono />
                  <Field label="Provider" value={row.provider || "—"} />
                  <Field label="Approved" node={yn(row.approved)} />
                  <Field label="Selected" node={yn(row.selected)} />

                  {/* URL fields — full row */}
                  <div className="col-span-2 mt-1 mb-0.5 border-t border-white/[0.04] pt-1">
                    <div className="flex items-start gap-2">
                      <span className="text-white/25 shrink-0 w-[130px]">Actual source URL field</span>
                      <span className={`font-mono font-bold ${row.sourceFieldName ? "text-amber-300/80" : "text-red-400"}`}>
                        {row.sourceFieldName || "none found"}
                      </span>
                    </div>
                  </div>
                  <div className="col-span-2 mb-0.5">
                    <div className="flex items-start gap-2">
                      <span className="text-white/25 shrink-0 w-[130px]">Actual source URL value</span>
                      {sourceUrlValue ? (
                        <div className="flex items-start gap-1 min-w-0">
                          <span className="font-mono text-white/40 break-all leading-tight">{sourceUrlValue}</span>
                          <a
                            href={sourceUrlValue}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 mt-0.5 text-primary/40 hover:text-primary/80 transition-colors"
                            title="Open URL"
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </div>
                      ) : (
                        <span className="text-red-400 font-bold">
                          {hasUrl ? "URL checkmark was false. No downloadable URL found." : "missing — no URL in any field"}
                        </span>
                      )}
                    </div>
                  </div>

                  <Field
                    label="Source URL starts with http"
                    node={yn(row.sourceUrlStartsWithHttp)}
                  />
                  <Field
                    label="Source URL downloadable"
                    node={yn(row.sourceUrlDownloadable)}
                  />

                  <div className="col-span-2 mt-1 mb-0.5 border-t border-white/[0.04] pt-1">
                    <div className="flex items-start gap-2">
                      <span className="text-white/25 shrink-0 w-[130px]">Download HTTP status</span>
                      <span className={`font-mono font-bold ${row.responseStatus > 0 ? (httpOk ? "text-green-400" : "text-red-400") : "text-white/25"}`}>
                        {row.responseStatus > 0 ? String(row.responseStatus) : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="col-span-2 mb-0.5">
                    <div className="flex items-start gap-2">
                      <span className="text-white/25 shrink-0 w-[130px]">Download content-type</span>
                      <span className={`font-mono ${ctShort ? (ctBad ? "text-red-400 font-bold" : "text-white/40") : "text-white/25"}`}>
                        {ctShort || "—"}
                      </span>
                    </div>
                  </div>

                  <div className="col-span-2 mt-1 mb-0.5 border-t border-white/[0.04] pt-1">
                    <div className="flex items-start gap-2">
                      <span className="text-white/25 shrink-0 w-[130px]">Local export path</span>
                      <span className="font-mono text-white/30 break-all leading-tight">
                        {row.localPath || "—"}
                      </span>
                    </div>
                  </div>
                  <Field label="File written" node={yn(row.fileWritten)} />
                  <Field label="File exists after write" node={yn(row.fileExistsAfterWrite)} />
                  <Field label="File size bytes" value={row.fileSize > 0 ? `${row.fileSize.toLocaleString()} bytes (${fmt(row.fileSize)})` : "0"} />
                  <Field label="FFprobe valid" node={row.fileSize > 0 ? yn(row.ffprobeValid) : <span className="text-white/25">—</span>} />
                  <Field label="Duration" value={fmtDur(row.duration)} />
                  <Field label="Resolution" value={row.width > 0 ? `${row.width}×${row.height}` : "—"} />
                  <Field label="Codec" value={row.codec || "—"} mono />
                  <Field
                    label="Ready for FFmpeg"
                    node={ok
                      ? <span className="text-green-400 font-bold">yes ✓</span>
                      : <span className="text-red-400 font-bold">no ✗</span>}
                  />

                  {row.error && (
                    <div className="col-span-2 mt-1 pt-1 border-t border-red-500/20">
                      <div className="flex items-start gap-2">
                        <span className="text-white/25 shrink-0 w-[130px]">Error</span>
                        <span className="text-red-400/80 break-words leading-snug">{row.error}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, node, mono,
}: {
  label: string;
  value?: string;
  node?: React.ReactElement;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-white/25 shrink-0 w-[130px]">{label}</span>
      {node ?? (
        <span className={`${mono ? "font-mono" : ""} text-white/50 break-all leading-tight`}>
          {value ?? "—"}
        </span>
      )}
    </div>
  );
}

/* ── Export Audio Source debug (PART 2) ───────────────── */
function ExportAudioDebug({
  audio, masterAudioUrl, effectiveAudioUrl,
}: {
  audio: AudioCheckRow | null;
  masterAudioUrl: string | null;
  effectiveAudioUrl: string | null;
}) {
  function fmt(bytes: number): string {
    if (bytes === 0) return "—";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  const yn = (v: boolean) => v
    ? <span className="text-green-400 font-bold">yes</span>
    : <span className="text-red-400 font-bold">no</span>;

  return (
    <div className="rounded-xl border border-white/[0.08] overflow-hidden">
      <div className="px-3 py-2 bg-white/[0.03] border-b border-white/[0.06]">
        <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Export Audio Source</p>
      </div>
      <div className="px-3 py-3 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[9px]">
        <Field label="Master player audio URL found" node={yn(!!masterAudioUrl)} />
        <Field label="Final audio URL used" value={effectiveAudioUrl ? "set" : "none"} />
        <div className="col-span-2 mb-0.5">
          <div className="flex items-start gap-2">
            <span className="text-white/25 shrink-0 w-[150px]">Audio URL value</span>
            {effectiveAudioUrl ? (
              <div className="flex items-start gap-1 min-w-0">
                <span className="font-mono text-white/40 break-all leading-tight">{effectiveAudioUrl}</span>
                <a href={effectiveAudioUrl} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 mt-0.5 text-primary/40 hover:text-primary/80" title="Open audio URL">
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
            ) : <span className="text-red-400 font-bold">missing</span>}
          </div>
        </div>
        <Field label="Downloaded local audio file" node={yn(!!audio?.fileWritten)} />
        <Field label="Audio file exists" node={yn(!!audio?.fileExistsAfterWrite)} />
        <Field label="Audio file size" value={audio && audio.fileSize > 0 ? `${audio.fileSize.toLocaleString()} bytes (${fmt(audio.fileSize)})` : "—"} />
        <Field label="Audio HTTP status" value={audio && audio.responseStatus > 0 ? String(audio.responseStatus) : "—"} mono />
        <Field label="Audio duration" value={audio && audio.duration > 0 ? `${audio.duration.toFixed(1)}s` : "—"} />
        <Field label="ffprobe audio valid" node={yn(!!audio?.ffprobeValid)} />
        {audio?.error && (
          <div className="col-span-2 mt-1 pt-1 border-t border-red-500/20">
            <div className="flex items-start gap-2">
              <span className="text-white/25 shrink-0 w-[150px]">Audio error</span>
              <span className="text-red-400/80 break-words leading-snug">{audio.error}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Export Readiness summary (PART 6) ────────────────── */
function ExportReadinessPanel({
  clipSourcesFound, clipsDownloaded, clipsValid, totalClips,
  hasAudio, audioSourceFound, audioDownloaded, audioValid, readyForFFmpeg,
}: {
  clipSourcesFound: number;
  clipsDownloaded: number;
  clipsValid: number;
  totalClips: number;
  hasAudio: boolean;
  audioSourceFound: boolean;
  audioDownloaded: boolean;
  audioValid: boolean;
  readyForFFmpeg: boolean;
}) {
  const rows: [string, string, boolean][] = [
    ["master clip sources found", `${clipSourcesFound}/${totalClips}`, clipSourcesFound === totalClips && totalClips > 0],
    ["clip files downloaded",     `${clipsDownloaded}/${totalClips}`, clipsDownloaded === totalClips && totalClips > 0],
    ["clip files valid",          `${clipsValid}/${totalClips}`,      clipsValid === totalClips && totalClips > 0],
    ["master audio source found", hasAudio ? (audioSourceFound ? "yes" : "no") : "no audio", !hasAudio || audioSourceFound],
    ["audio file downloaded",     hasAudio ? (audioDownloaded ? "yes" : "no") : "—",        !hasAudio || audioDownloaded],
    ["audio valid",               hasAudio ? (audioValid ? "yes" : "no") : "—",             !hasAudio || audioValid],
    ["ready for FFmpeg",          readyForFFmpeg ? "yes" : "no",                            readyForFFmpeg],
  ];
  return (
    <div className={`rounded-xl border overflow-hidden ${readyForFFmpeg ? "border-green-500/25 bg-green-500/[0.04]" : "border-amber-500/25 bg-amber-500/[0.03]"}`}>
      <div className="px-3 py-2 border-b border-white/[0.06]">
        <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Export Readiness</p>
      </div>
      <div className="px-3 py-2.5 space-y-1">
        {rows.map(([label, value, ok]) => (
          <div key={label} className="flex items-center justify-between gap-2 text-[10px] font-mono">
            <span className="text-white/35">{label}:</span>
            <span className={`font-bold ${ok ? "text-green-400" : "text-red-400"}`}>{value}{ok && value !== "—" && value !== "no audio" ? " ✓" : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function statusLabel(s: SceneData): string {
  if (s.approved && s.generationStatus === "completed") return "Approved";
  if (s.generationStatus === "completed") return "Completed";
  if (s.generationStatus === "failed")    return "Failed";
  if (s.generationStatus === "pending")   return "Pending";
  if (s.demoClipUrl)                      return "Ready";
  return "—";
}

function statusColor(s: SceneData): string {
  if (s.approved && s.generationStatus === "completed") return "text-primary";
  if (s.generationStatus === "completed") return "text-green-400";
  if (s.generationStatus === "failed")    return "text-red-400";
  if (s.generationStatus === "pending")   return "text-amber-400";
  if (s.demoClipUrl)                      return "text-green-400";
  return "text-white/25";
}

function StatusBadge({ status }: { status: ExportStatus }) {
  if (status === "idle") {
    return (
      <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest border border-white/10 rounded-full px-2 py-0.5">
        Ready to Export
      </span>
    );
  }
  if (status === "exporting") {
    return (
      <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest border border-amber-400/30 bg-amber-400/10 rounded-full px-2 py-0.5 flex items-center gap-1">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Exporting Final Video…
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest border border-green-400/30 bg-green-400/10 rounded-full px-2 py-0.5 flex items-center gap-1">
        <CheckCircle2 className="h-2.5 w-2.5" /> Export Complete
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest border border-red-400/30 bg-red-400/10 rounded-full px-2 py-0.5 flex items-center gap-1">
      <XCircle className="h-2.5 w-2.5" /> Export Failed
    </span>
  );
}
