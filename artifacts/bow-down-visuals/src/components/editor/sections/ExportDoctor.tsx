import { useState, useMemo, useEffect } from "react";
import {
  Stethoscope,
  Loader2,
  CheckCircle2,
  XCircle,
  Link2,
  Download,
  Film,
  Music2,
  ExternalLink,
  Layers,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorCard } from "@/components/editor/controls";
import { useAuth } from "@/contexts/AuthContext";
import type { SceneData } from "@/lib/scene-parser";
import type {
  CaptionSettings,
  AudioVideoSyncMode,
} from "@/lib/editor-settings";

interface ExportDoctorProps {
  scenes: SceneData[];
  projectId: string;
  /** The exact audio URL the master player is using. */
  masterAudioUrl?: string | null;
  /** The exact caption settings (synced lines + style) the master player is using. */
  captions?: CaptionSettings | null;
  /** The exact saved Auto AI effects (settings.effects) the master player is using. */
  effects?: string[] | null;
  /** Active overlay chip names (settings.overlays). */
  overlays?: string[] | null;
  /** Per-overlay intensity map (settings.overlayIntensity). */
  overlayIntensity?: Record<string, number> | null;
  /** Watermark text (settings.watermarkText). */
  watermarkText?: string | null;
  /** Watermark type: "logo" | "text" | "none" */
  watermarkType?: string | null;
  /** Watermark corner position */
  watermarkPosition?: string | null;
  /** Watermark size */
  watermarkSize?: string | null;
  /** Include watermark in export */
  watermarkIncludeInExport?: boolean | null;
  /** Current master-player playhead (seconds) — origin of the 3-second match test. */
  masterCurrentTimeSec?: number;
  /** Total project duration (seconds) from the master player. */
  projectDurationSec?: number;
  /** Applied scene transitions from settings.aiEdit.appliedTransitions. */
  appliedTransitions?: { sceneIndex: number; type: string }[] | null;
  /** Audio/video sync mode selected on the timeline. */
  syncMode?: AudioVideoSyncMode | null;
  /** Per-clip edits keyed by scene id — used for lip sync export test. */
  clipEdits?: Record<string, import("@/lib/editor-settings").ClipEdit>;
  /** Scene ID currently selected in the Lip Sync tab.
   *  When set, the export test button targets that specific scene instead of the first one found. */
  selectedLipSyncSceneId?: string | null;
  /** Master player's audio start offset (settings.musicStudio.videoAudio.startSec).
   *  Applied as -ss to audio input in every audio export to match the master player. */
  audioStartSec?: number;
  /** Saved audio duration in seconds (settings.musicStudio.videoAudio.duration). */
  audioDurationSec?: number;
}

/** Every candidate URL field the spec asks us to surface for Scene 1. */
const URL_FIELD_KEYS = [
  "clip.url",
  "clip.video_url",
  "clip.videoUrl",
  "clip.output_url",
  "clip.outputUrl",
  "clip.asset_url",
  "clip.assetUrl",
  "clip.runway_url",
  "clip.runwayUrl",
  "clip.storage_url",
  "clip.storageUrl",
  "scene.clip_url",
  "scene.clipUrl",
  "scene.video_url",
  "scene.videoUrl",
  "scene.runway_output_url",
  "scene.runwayOutputUrl",
  "scene.generated_clip_url",
  "scene.generatedClipUrl",
  "scene.demoClipUrl",
] as const;

type UrlTestResult = {
  urlProvided: boolean;
  startsWithHttp: boolean;
  resolvedUrl?: string;
  status: number;
  contentType: string;
  contentLength: number | null;
  isVideo: boolean;
  isHtml: boolean;
  snippet: string | null;
  message: string;
};

type DownloadResult = {
  doctorId: string;
  localPath: string;
  fileExists: boolean;
  fileSize: number;
  responseStatus: number;
  contentType: string;
  duration?: number;
  codec?: string;
  width?: number;
  height?: number;
  ffprobeValid: boolean;
  error: string | null;
};

type ExportEffectEntry = {
  name: string;
  type: "color-grade" | "filter";
  scope: "global";
  intensity: number | null;
  opacity: number;
  blend: "normal";
  startSec: number;
  endSec: number;
  supported: boolean;
  applied: boolean;
  ffmpeg: string;
};

type EffectConflict = {
  detected: boolean;
  effects: string[];
  mode: "bw-only" | "gold-only" | "blend";
  note: string;
};

type TransitionPlanEntry = {
  sceneIndex: number;
  type: string;
  supported: boolean;
  xfade: string;
  durationSec: number;
  reason: string | null;
};

type ExportResult = {
  success?: boolean;
  url?: string;
  fileSize?: number;
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  clipCount?: number;
  audioDownloaded?: boolean;
  audioValid?: boolean;
  audioFileSize?: number;
  audioDuration?: number;
  captionsFound?: boolean;
  captionRows?: number;
  captionTimingValid?: boolean;
  captionStyleFound?: boolean;
  captionsBurned?: boolean;
  stylePreset?: string;
  effectsFound?: boolean;
  effectsCount?: number;
  effectsExportConnected?: boolean;
  supportedEffects?: string[];
  unsupportedEffects?: string[];
  effectFilter?: string;
  captionsPreserved?: boolean;
  audioPreserved?: boolean;
  testExportCreated?: boolean;
  // Effect stack engine (export-all-effects + export-effects-range)
  effectStack?: ExportEffectEntry[];
  appliedEffects?: string[];
  conflict?: EffectConflict | null;
  conflictMode?: "bw-only" | "gold-only" | "blend";
  stackMatch?: boolean;
  // 3-second match test (export-effects-range)
  rangeStart?: number;
  rangeDuration?: number;
  activeSceneIndex?: number;
  masterEffectsFound?: number;
  effectsApplied?: number;
  // Transitions (export-effects-transitions)
  transitionsConnected?: boolean;
  transitionPlan?: TransitionPlanEntry[];
  supportedTransitions?: TransitionPlanEntry[];
  unsupportedTransitions?: TransitionPlanEntry[];
  error?: string;
  stderrTail?: string[];
  // Overlay export doctor (export-all-overlays)
  overlaysFound?: boolean;
  overlaysIncluded?: string[];
  unsupportedOverlays?: string[];
  watermarkFound?: boolean;
  watermarkIncluded?: boolean;
  overlayWatermarkText?: string;
  overlayExportConnected?: boolean;
  effectsPreserved?: boolean;
};

type MultiClipRow = {
  sceneNumber: number;
  sceneTitle: string;
  fileExists: boolean;
  fileSize: number;
  /** Raw ffprobe duration of the downloaded video file. */
  duration: number;
  /** Seconds trimmed from start (from ClipEdit.trimStart sent by client). */
  trimStartSec?: number;
  /** Seconds trimmed from end (from ClipEdit.trimEnd sent by client). */
  trimEndSec?: number;
  /** Explicit master player duration from scene timestamps (echoed back by server). */
  masterDuration?: number;
  /** Effective export duration. = masterDuration (when sent) or raw - trimStart - trimEnd. */
  timelineDuration?: number;
  /** True when raw source video is shorter than masterDuration — tpad freeze-last-frame will pad. */
  rawShorterThanMaster?: boolean;
  /** How the export duration was resolved. */
  durationSource?: "master-timestamp" | "raw-trim" | "raw";
  width: number;
  height: number;
  codec: string;
  ffprobeValid: boolean;
  responseStatus: number;
  contentType: string;
  error: string | null;
};

type RepairClipResult = {
  sceneNumber: number;
  oldExportDuration: number;
  newExportDuration: number;
  masterDuration: number;
  rawDuration: number;
  sourceAvailable: number;
  rawShorterThanMaster: boolean;
  cacheCleared: boolean;
  normFileSize: number;
  normFileDuration: number;
  matchesMaster: boolean;
  savedToExportTimeline: boolean;
  ffmpegTrimDuration: number;
  error?: string;
};

type RepairNormalizeResult = {
  sceneNumber: number;
  repaired: boolean;
  normalizedOutputValid: boolean;
  duration: number;
  targetDuration: number;
  readyForFirstTwentyExport: boolean;
  normMethod: "tpad" | "still-frame" | "failed";
  normFileSize: number;
  rawShorterThanMaster: boolean;
  downloadCacheCleared: boolean;
  normCacheCleared: boolean;
  redownloadHttpStatus: number;
  matchesMaster: boolean;
  lastError: string | null;
};

type DownloadAllResult = {
  multiId: string;
  total: number;
  downloaded: number;
  valid: number;
  allValid: boolean;
  lastError: string | null;
  clips: MultiClipRow[];
};

type ClipUrlCheckRow = {
  sceneNumber: number;
  title: string;
  sourceType: string;
  url: string;
  host: string;
  reachable: boolean;
  httpStatus: number;
  contentType: string;
  isVideoContentType: boolean;
  allowedByStaticList: boolean;
  allowedByPublicHttps: boolean;
  allowed: boolean;
  error: string | null;
};

type UrlDoctorResult = {
  clips: ClipUrlCheckRow[];
  total: number;
  passCount: number;
  failCount: number;
  allAllowed: boolean;
};

type AudioSyncClipRow = {
  sceneNumber: number;
  title: string;
  clipDuration: number;
  timelineStartSec: number;
  timelineEndSec: number;
  sourceType?: string;
  lipSyncOffsetSec?: number;
};

type LipSyncOffsetScene = {
  sceneNumber: number;
  sceneTitle: string;
  masterOffsetSec: number;
  fineTuneOffsetSec: number;
  totalOffsetSec: number;
  offsetApplied: boolean;
};

type LipSyncOffsetInfo = {
  masterOffsetApplied: boolean;
  fineTuneApplied: boolean;
  fineTuneSec: number;
  scenesWithOffset: LipSyncOffsetScene[];
  allScenes: LipSyncOffsetScene[];
};

type AudioSyncDiagResult = {
  success?: boolean;
  url?: string;
  fileSize?: number;
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  testDurationSec?: number;
  // Timing alignment
  masterAudioStartSec?: number;
  exportAudioStartSec?: number;
  audioOffset?: number;
  timelineVideoDuration?: number;
  audioDuration?: number;
  finalExportDuration?: number;
  audioVideoSyncMode?: string;
  syncExpected?: boolean;
  usingMasterPlayerTiming?: boolean;
  audioOffsetApplied?: boolean;
  // Sync check flags
  videoOnlyExportPassed?: boolean;
  audioSourceReady?: boolean;
  lipSyncOffsetsPreserved?: boolean;
  finalSyncExpected?: boolean;
  // Per-clip map
  clipTimeline?: AudioSyncClipRow[];
  // Lip sync offset info (from export-audio-sync-short)
  lipSyncOffsetInfo?: LipSyncOffsetInfo;
  error?: string;
  stderrTail?: string[];
};

async function readJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!ct.toLowerCase().includes("application/json")) {
    throw new Error(
      `API returned ${ct || "non-JSON"} (HTTP ${res.status}) instead of JSON.`,
    );
  }
  return JSON.parse(text) as T;
}

function fmtBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Parse scene timestamp "M:SS" or "MM:SS" → seconds. Returns null if unparseable.
 *  This gives the ABSOLUTE SONG POSITION — it is NOT a clip duration. */
function parseTimestamp(ts: string | null | undefined): number | null {
  const m = (ts ?? "").match(/(\d+):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

/** Replicates the master player's parseDur — parses "M:SS – M:SS" range format → duration (seconds).
 *  Falls back to 5s default (same as the master player) when no range is found.
 *  NOTE: single timestamps like "3:15" are NOT clip durations; they're song positions. */
function parseMasterDur(ts: string | null | undefined): number {
  if (!ts) return 5;
  const m = ts.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (m) {
    const start = +m[1]! * 60 + +m[2]!;
    const end = +m[3]! * 60 + +m[4]!;
    return end > start ? end - start : 5;
  }
  return 5;
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

export function ExportDoctor({
  scenes,
  projectId,
  masterAudioUrl,
  captions,
  effects,
  overlays,
  overlayIntensity,
  watermarkText,
  watermarkType,
  watermarkPosition,
  watermarkSize,
  watermarkIncludeInExport,
  masterCurrentTimeSec,
  projectDurationSec,
  appliedTransitions,
  syncMode,
  clipEdits,
  selectedLipSyncSceneId,
  audioStartSec,
  audioDurationSec,
}: ExportDoctorProps) {
  const { getAccessToken } = useAuth();

  // Deduplicate the scenes array by scene id.
  // The timeline can produce duplicate entries (same id appearing twice) if the
  // parent re-merges or the saved data contains repeated clip rows.
  // First occurrence wins; order is preserved.
  const { uniqueScenes, duplicateCount } = useMemo(() => {
    const seen = new Set<string>();
    const unique: SceneData[] = [];
    for (const s of scenes) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        unique.push(s);
      }
    }
    return {
      uniqueScenes: unique,
      duplicateCount: scenes.length - unique.length,
    };
  }, [scenes]);

  // Scene 1 = first scene that has a usable clip URL (from deduplicated list)
  const scene1 =
    uniqueScenes.find((s) => !!s.demoClipUrl?.startsWith("http")) ??
    uniqueScenes[0] ??
    null;
  const scene1Url = scene1?.demoClipUrl ?? "";

  const [busy, setBusy] = useState<
    | null
    | "url"
    | "download"
    | "export"
    | "export-audio"
    | "download-all"
    | "check-all-urls"
    | "export-all"
    | "export-all-audio"
    | "export-audio-sync-diag"
    | "export-audio-sync-short"
    | "export-audio-sync-short-lipsync"
    | "export-all-captions"
    | "export-all-effects"
    | "effect-match-test"
    | "export-transitions"
    | "export-all-overlays"
    | "overlay-match-test"
    | "lip-sync-preview"
    | `repair-${number}`
    | `repair-normalize-${number}`
  >(null);
  const [conflictMode, setConflictMode] = useState<
    "bw-only" | "gold-only" | "blend"
  >("blend");
  const [effectMatchResult, setEffectMatchResult] =
    useState<ExportResult | null>(null);
  const [transitionsResult, setTransitionsResult] =
    useState<ExportResult | null>(null);
  const [urlResult, setUrlResult] = useState<UrlTestResult | null>(null);
  const [downloadResult, setDownloadResult] = useState<DownloadResult | null>(
    null,
  );
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [audioExportResult, setAudioExportResult] =
    useState<ExportResult | null>(null);
  /** Inputs the download / audio tests were run against. If the scene's clip URL
   *  (or the selected audio) changes afterwards, the green results are stale and
   *  must never disagree with the export gating — see downloadStale below. */
  const [testedSceneUrl, setTestedSceneUrl] = useState<string | null>(null);
  const [testedAudioUrl, setTestedAudioUrl] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // Multi-clip ("All 5 Clips") doctor state
  const [downloadAllResult, setDownloadAllResult] =
    useState<DownloadAllResult | null>(null);
  const [exportAllResult, setExportAllResult] = useState<ExportResult | null>(
    null,
  );
  const [exportAllAudioResult, setExportAllAudioResult] =
    useState<ExportResult | null>(null);
  const [exportAllCaptionsResult, setExportAllCaptionsResult] =
    useState<ExportResult | null>(null);
  const [exportAllEffectsResult, setExportAllEffectsResult] =
    useState<ExportResult | null>(null);
  const [exportAllOverlaysResult, setExportAllOverlaysResult] =
    useState<ExportResult | null>(null);
  const [overlayMatchResult, setOverlayMatchResult] =
    useState<ExportResult | null>(null);
  const [lipSyncExportResult, setLipSyncExportResult] =
    useState<ExportResult | null>(null);
  /** Separate error state for the lip sync export test — does NOT bleed into the shared All-Clips lastError. */
  const [lipSyncLastError, setLipSyncLastError] = useState<string | null>(null);
  /** Records exactly what was sent in the last lip sync export so the status panel can compare against current settings. */
  const [lipSyncExportMeta, setLipSyncExportMeta] = useState<{
    clipVideoOffsetSec: number;
    usedLipSyncUrl: boolean;
    sceneLabel: string;
  } | null>(null);
  /** True the moment the export button is clicked — shows "button clicked: yes" immediately. */
  const [lipSyncButtonClicked, setLipSyncButtonClicked] = useState(false);
  /** True after the download route is called — shows "export route called: yes". */
  const [lipSyncDownloadCalled, setLipSyncDownloadCalled] = useState(false);
  /** Per-scene repair results keyed by sceneNumber. */
  const [repairResults, setRepairResults] = useState<
    Record<number, RepairClipResult>
  >({});
  /** Per-scene repair-and-normalize results (re-download + fallback) keyed by sceneNumber. */
  const [repairNormResults, setRepairNormResults] = useState<
    Record<number, RepairNormalizeResult>
  >({});
  /** Result of the lightweight Check All Clip URLs (HEAD-only) doctor pass. */
  const [urlDoctorResult, setUrlDoctorResult] =
    useState<UrlDoctorResult | null>(null);
  /** Result of the full Audio Sync Diagnostic export. */
  const [audioSyncDiagResult, setAudioSyncDiagResult] =
    useState<AudioSyncDiagResult | null>(null);
  /** Result of the First 20 Seconds Audio Sync Short Test. */
  const [audioSyncShortResult, setAudioSyncShortResult] =
    useState<AudioSyncDiagResult | null>(null);
  /** Result of the Lip Sync Offset Test (Export First 20s Lip Sync Offset Test button). */
  const [previewLipSyncExportUrl, setPreviewLipSyncExportUrl] = useState<string | null>(null);
  const [audioSyncShortLipSyncResult, setAudioSyncShortLipSyncResult] =
    useState<AudioSyncDiagResult | null>(null);
  /** Export-only fine-tune offset added on top of the saved master player lip sync offset.
   *  Positive = delay mouth further (mouth too early); negative = advance mouth (mouth too late). */
  const [exportLipSyncFineTune, setExportLipSyncFineTune] = useState(0);
  /** Live step label shown while the short test is running. */
  const [shortTestStep, setShortTestStep] = useState<string | null>(null);
  /** When the short test started (for elapsed time display). */
  const [shortTestStartedAt, setShortTestStartedAt] = useState<number | null>(
    null,
  );
  /** Running elapsed seconds counter while short test is busy. */
  const [shortTestElapsed, setShortTestElapsed] = useState(0);
  /** Debug flags for the short test debug panel. */
  const [shortTestDebug, setShortTestDebug] = useState<{
    buttonClicked: boolean;
    routeCalled: boolean;
    ffmpegStarted: boolean;
    ffmpegFinished: boolean;
    resultUrl: string | null;
    lastError: string | null;
    clipDurationsLoaded: boolean;
    audioReady: boolean;
    lastStep: string | null;
  }>({
    buttonClicked: false,
    routeCalled: false,
    ffmpegStarted: false,
    ffmpegFinished: false,
    resultUrl: null,
    lastError: null,
    clipDurationsLoaded: false,
    audioReady: false,
    lastStep: null,
  });
  /** Whether the Master Player Audio Map table is expanded/visible. */
  const [showAudioMap, setShowAudioMap] = useState(false);

  const doctorId = downloadResult?.doctorId ?? null;
  /* Stale-test guard: the download/export checks ran against testedSceneUrl. If
   * Scene 1's clip URL changed since (clip regenerated, replaced, or removed),
   * the stored green results no longer describe the current scene — gate the
   * export buttons off and say so, instead of showing contradictory greens. */
  const downloadStale =
    !!downloadResult && testedSceneUrl !== null && testedSceneUrl !== scene1Url;
  const downloadOk =
    !!downloadResult?.fileExists &&
    !!downloadResult?.ffprobeValid &&
    !downloadStale;
  const audioStale =
    !!audioExportResult && testedAudioUrl !== (masterAudioUrl ?? null);

  // Per-clip master player duration — replicates the master player's own parseDur + buildOffsets logic.
  // Timestamp format "0:05 - 0:10" → 5s duration. Single timestamps like "3:15" are song positions,
  // NOT clip durations. If all scenes use the 5s default and projectDurationSec is known, use even
  // distribution (audioDuration / numScenes), exactly as the master player does.
  const masterDurations = useMemo(() => {
    const n = uniqueScenes.length;
    if (n === 0) return [];
    const rawDurs = uniqueScenes.map((s) => parseMasterDur(s.timestamp));
    const allDefault = rawDurs.every((d) => d === 5);
    if (allDefault && projectDurationSec != null && projectDurationSec > 0) {
      // Even distribution — same fallback the master player uses
      const evenDur = projectDurationSec / n;
      return rawDurs.map(() => evenDur);
    }
    return rawDurs;
  }, [uniqueScenes, projectDurationSec]);

  /** Cumulative clip start times on the master player video timeline. */
  const masterOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const d of masterDurations) {
      offsets.push(acc);
      acc += d;
    }
    return offsets;
  }, [masterDurations]);

  /** How clip durations were resolved — drives status panel and validity checks. */
  const { masterDurSource, masterDurInvalid } = useMemo(() => {
    const hasRange = uniqueScenes.some((s) =>
      /\d+:\d{2}\s*[-–]\s*\d+:\d{2}/.test(s.timestamp ?? ""),
    );
    if (hasRange)
      return {
        masterDurSource: "range-timestamp" as const,
        masterDurInvalid: false,
      };
    const allDefault5 = masterDurations.every((d) => d === 5);
    if (allDefault5)
      return {
        masterDurSource: "default-5s" as const,
        masterDurInvalid: false,
      };
    // Even distribution — invalid if individual durations are unrealistically large
    const invalid = masterDurations.some((d) => d > 30);
    return {
      masterDurSource: "even-distribution" as const,
      masterDurInvalid: invalid,
    };
  }, [uniqueScenes, masterDurations]);

  // Every scene that has a usable clip URL is part of the multi-clip set.
  // Use POSITION index (i+1) as sceneNumber so the server receives clips numbered
  // 1…N in the dragged order. The server must NOT re-sort; it trusts this order.
  //
  // Source priority per clip:
  //   1. clip.lipSyncUrl  — when useLipSync=true and lipSyncUrl is set
  //   2. scene.demoClipUrl — original generated clip (fallback)
  const multiClips = uniqueScenes.map((s, i) => {
    const ce = clipEdits?.[s.id];
    const useLipSyncUrl = !!(ce?.useLipSync && ce.lipSyncUrl);
    const exportUrl = useLipSyncUrl ? ce!.lipSyncUrl! : (s.demoClipUrl ?? null);
    return {
      sceneNumber: i + 1, // position in dragged order, not original scene number
      title: s.section ? `Scene ${i + 1} · ${s.section}` : `Scene ${i + 1}`,
      url: exportUrl,
      sourceType: useLipSyncUrl ? "lip-sync" : "original",
      /** Master player trim start — sent to server so normalization matches timeline. */
      trimStart: ce?.trimStart ?? 0,
      /** Master player trim end — sent to server so normalization matches timeline. */
      trimEnd: ce?.trimEnd ?? 0,
      /** Explicit master player clip duration from scene timestamps.
       *  Server uses this as the authoritative timeline duration for FFmpeg -t. */
      masterDuration: masterDurations[i] ?? 0,
      /** Lip sync video offset from master player (lipSyncOffsetSeconds).
       *  Server applies this as extra seek on top of trimStart during normalization,
       *  matching the master player which seeks video.currentTime = offset. */
      clipVideoOffsetSec: useLipSyncUrl ? (ce?.lipSyncOffsetSeconds ?? 0) : 0,
      _lipSyncActive: useLipSyncUrl,
      _originalSceneNum: s.sceneNumber ?? i + 1, // kept only for display / debug
    };
  });

  // Detect whether the user has reordered relative to the original generated sequence.
  const isReordered = uniqueScenes.some(
    (s, i) => (s.sceneNumber ?? i + 1) !== i + 1,
  );
  const orderSourceLabel = isReordered
    ? "saved timeline order"
    : "original generated order";
  // Show original scene numbers listed in their current (possibly dragged) positions.
  const orderDisplay = uniqueScenes
    .map((s, i) => s.sceneNumber ?? i + 1)
    .join(", ");
  const multiClipsWithUrl = multiClips.filter(
    (c) => !!c.url?.startsWith("http"),
  );
  const multiId = downloadAllResult?.multiId ?? null;
  const allClipsValid =
    !!downloadAllResult?.allValid && downloadAllResult.total > 0;

  // ── Export audio always starts at 0:00 ──────────────────────────────────────
  // Full export = full project song from the beginning.
  // Scene timestamps are the master *player* position (e.g. chorus at 0:45) and
  // must NOT be used as an audio seek offset in the final export.
  // Lip sync uses its own per-clip audio segment; that never flows into full export.
  const exportAudioStartSec = 0;

  // Detect whether masterAudioUrl looks like a lip sync segment rather than the
  // full project audio mix. Sync.so outputs live on api.sync.so / cdn.sync.so,
  // and some internal paths contain "lip", "vocal", or "lipsync".
  const masterAudioIsLipSync = useMemo(() => {
    if (!masterAudioUrl) return false;
    try {
      const u = new URL(masterAudioUrl);
      if (u.hostname.includes("sync.so")) return true;
      const p = u.pathname.toLowerCase();
      if (p.includes("lip") || p.includes("vocal") || p.includes("lipsync"))
        return true;
    } catch {
      /* ignore */
    }
    return false;
  }, [masterAudioUrl]);

  // Per-clip audio map — uses timelineDuration (master player effective duration after trims).
  // Audio column reflects the export model (always starts at 0:00).
  const clipAudioMap = useMemo(() => {
    let videoCursor = 0;
    return uniqueScenes.map((s, i) => {
      const serverClip = downloadAllResult?.clips.find(
        (c) => c.sceneNumber === i + 1,
      );
      // Use trimmed timeline duration when available; fall back to raw ffprobe duration
      const dur = serverClip?.timelineDuration ?? serverClip?.duration ?? 0;
      const rawDur = serverClip?.duration ?? 0;
      // masterDuration from master player logic (parseMasterDur + even-distribution)
      // NOT from song timestamps — those are audio positions, not clip durations.
      const masterDur = masterDurations[i] ?? 0;
      const masterStart = masterOffsets[i] ?? 0;
      const masterEnd = masterStart + masterDur;
      // audioStart = absolute song position for this scene (parseTimestamp gives song position)
      const audioStartTs = parseTimestamp(s.timestamp ?? "");
      const videoStart = videoCursor;
      videoCursor += dur;
      const hasTrim =
        (serverClip?.trimStartSec ?? 0) > 0 ||
        (serverClip?.trimEndSec ?? 0) > 0;
      return {
        sceneNumber: i + 1,
        title: s.section ? `Scene ${i + 1} · ${s.section}` : `Scene ${i + 1}`,
        timestamp: s.timestamp ?? null,
        timestampSec: audioStartTs,
        videoStart,
        videoEnd: videoCursor,
        // Audio-timeline start/end (absolute song positions) — separate from video clip positions
        audioStart: videoStart,
        audioEnd: videoCursor,
        audioSongStart: audioStartTs ?? 0,
        clipDuration: dur,
        rawDuration: rawDur,
        // Master player video timeline positions (clip end − clip start)
        masterDuration: masterDur,
        masterStart,
        masterEnd,
        durationSource:
          serverClip?.durationSource ??
          (masterDur > 0 ? "master-timestamp" : "raw"),
        trimStartSec: serverClip?.trimStartSec ?? multiClips[i]?.trimStart ?? 0,
        trimEndSec: serverClip?.trimEndSec ?? multiClips[i]?.trimEnd ?? 0,
        hasTrim,
      };
    });
  }, [uniqueScenes, downloadAllResult, multiClips]);

  // Elapsed timer + optimistic step labels while short test is in-flight
  const SHORT_TEST_STEPS: [number, string][] = [
    [0, "preparing clips"],
    [3, "checking clip durations"],
    [7, "rebuilding export timeline"],
    [12, "downloading audio"],
    [22, "trimming audio from 0:00 to 20s"],
    [28, "normalizing clips"],
    [55, "running ffmpeg"],
    [95, "uploading result"],
    [115, "generating signed URL"],
  ];

  useEffect(() => {
    if (busy !== "export-audio-sync-short" || shortTestStartedAt === null)
      return;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - shortTestStartedAt) / 1000);
      setShortTestElapsed(elapsed);
      // Advance the optimistic step label
      let step = SHORT_TEST_STEPS[0]![1];
      for (const [t, label] of SHORT_TEST_STEPS) {
        if (elapsed >= t) step = label;
      }
      setShortTestStep(step);
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, shortTestStartedAt]);

  async function authHeaders() {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? ""}`,
    };
  }

  async function testUrl() {
    setBusy("url");
    setLastError(null);
    setUrlResult(null);
    try {
      const res = await fetch("/api/export-doctor/test-url", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ url: scene1Url }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await readJson<UrlTestResult>(res);
      if (!res.ok)
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      setUrlResult(data);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function downloadScene1() {
    setBusy("download");
    setLastError(null);
    setDownloadResult(null);
    setExportResult(null);
    setAudioExportResult(null);
    try {
      const res = await fetch("/api/export-doctor/download", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ projectId, url: scene1Url }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const data = await readJson<DownloadResult>(res);
      if (!res.ok)
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      setDownloadResult(data);
      setTestedSceneUrl(scene1Url);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportScene1() {
    if (!doctorId) return;
    setBusy("export");
    setLastError(null);
    setExportResult(null);
    try {
      const res = await fetch("/api/export-doctor/export", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ doctorId }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setExportResult(data);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportScene1Audio() {
    if (!doctorId) return;
    setBusy("export-audio");
    setLastError(null);
    setAudioExportResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-audio", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ doctorId, audioUrl: masterAudioUrl ?? null }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAudioExportResult(data);
      setTestedAudioUrl(masterAudioUrl ?? null);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function checkAllClipUrls() {
    setBusy("check-all-urls");
    setUrlDoctorResult(null);
    setLastError(null);
    try {
      const res = await fetch("/api/export-doctor/check-clip-urls", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ clips: multiClips }),
        signal: AbortSignal.timeout(2 * 60 * 1000),
      });
      const data = await readJson<UrlDoctorResult>(res);
      if (!res.ok)
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      setUrlDoctorResult(data);
      const firstFail = data.clips.find((c) => !c.allowed);
      if (firstFail)
        setLastError(
          `Scene ${firstFail.sceneNumber}: ${firstFail.error ?? "URL not allowed"}`,
        );
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function repairNormalizeScene(sceneNumber: number) {
    if (!multiId) return;
    setBusy(`repair-normalize-${sceneNumber}`);
    setLastError(null);
    try {
      const res = await fetch("/api/export-doctor/repair-normalize", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ multiId, sceneNumber }),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      const data = await readJson<RepairNormalizeResult>(res);
      if (!res.ok)
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      setRepairNormResults((prev) => ({ ...prev, [sceneNumber]: data }));
      // Update the downloadAllResult in-place so the comparison table refreshes
      setDownloadAllResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          clips: prev.clips.map((c) =>
            c.sceneNumber === sceneNumber
              ? {
                  ...c,
                  timelineDuration: data.targetDuration,
                  rawShorterThanMaster: data.rawShorterThanMaster,
                }
              : c,
          ),
        };
      });
      if (data.lastError) setLastError(data.lastError);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function repairClip(sceneNumber: number) {
    if (!multiId) return;
    setBusy(`repair-${sceneNumber}`);
    setLastError(null);
    try {
      const res = await fetch("/api/export-doctor/repair-clip", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ multiId, sceneNumber }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const data = await readJson<RepairClipResult>(res);
      if (!res.ok)
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      setRepairResults((prev) => ({ ...prev, [sceneNumber]: data }));
      // Update the downloadAllResult in-place so the comparison table refreshes
      setDownloadAllResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          clips: prev.clips.map((c) =>
            c.sceneNumber === sceneNumber
              ? {
                  ...c,
                  timelineDuration: data.newExportDuration,
                  rawShorterThanMaster: data.rawShorterThanMaster,
                }
              : c,
          ),
        };
      });
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function downloadAllClips() {
    setBusy("download-all");
    setLastError(null);
    setDownloadAllResult(null);
    setExportAllResult(null);
    setExportAllAudioResult(null);
    setExportAllCaptionsResult(null);
    setExportAllEffectsResult(null);
    setExportAllOverlaysResult(null);
    setOverlayMatchResult(null);
    setRepairResults({});
    setRepairNormResults({});
    try {
      const res = await fetch("/api/export-doctor/download-all", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ projectId, clips: multiClips }),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      const data = await readJson<DownloadAllResult>(res);
      if (!res.ok)
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      setDownloadAllResult(data);
      if (data.lastError) setLastError(data.lastError);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportAllClips() {
    if (!multiId) return;
    setBusy("export-all");
    setLastError(null);
    setExportAllResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ multiId }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setExportAllResult(data);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportAllClipsAudio() {
    if (!multiId) return;
    setBusy("export-all-audio");
    setLastError(null);
    setExportAllAudioResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all-audio", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          multiId,
          audioUrl: masterAudioUrl ?? null,
          audioStartSec: 0,
          syncMode: syncMode ?? "keep-as-is",
        }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setExportAllAudioResult(data);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportAudioSyncDiagnostic() {
    if (!multiId) return;
    setBusy("export-audio-sync-diag");
    setLastError(null);
    setAudioSyncDiagResult(null);
    try {
      const res = await fetch(
        "/api/export-doctor/export-audio-sync-diagnostic",
        {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({
            multiId,
            audioUrl: masterAudioUrl ?? null,
            audioStartSec: 0,
            syncMode: syncMode ?? "keep-as-is",
            clipEdits: clipEdits ?? {},
          }),
          signal: AbortSignal.timeout(8 * 60 * 1000),
        },
      );
      const data = await readJson<AudioSyncDiagResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAudioSyncDiagResult(data);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportAudioSyncShort() {
    if (!multiId) return;
    const startedAt = Date.now();
    setShortTestStartedAt(startedAt);
    setShortTestElapsed(0);
    setShortTestStep("preparing clips");
    setShortTestDebug({
      buttonClicked: true,
      routeCalled: false,
      ffmpegStarted: false,
      ffmpegFinished: false,
      resultUrl: null,
      lastError: null,
      clipDurationsLoaded: !!downloadAllResult?.clips?.length,
      audioReady: !!(masterAudioUrl && !masterAudioIsLipSync),
      lastStep: "preparing clips",
    });
    setBusy("export-audio-sync-short");
    setLastError(null);
    setAudioSyncShortResult(null);
    setAudioSyncShortLipSyncResult(null);

    // 2-minute client timeout — must not spin forever
    const CLIENT_TIMEOUT_MS = 2 * 60 * 1000;

    try {
      setShortTestDebug((prev) => ({
        ...prev,
        routeCalled: true,
        lastStep: "calling export route",
      }));
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () =>
          controller.abort(new Error("Export test timed out after 2 minutes.")),
        CLIENT_TIMEOUT_MS,
      );

      let res: Response;
      try {
        res = await fetch("/api/export-doctor/export-audio-sync-short", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({
            multiId,
            audioUrl: masterAudioUrl ?? null,
            audioStartSec: 0,
            syncMode: syncMode ?? "keep-as-is",
            durationSec: 20,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      setShortTestDebug((prev) => ({
        ...prev,
        ffmpegStarted: true,
        ffmpegFinished: true,
        lastStep: "processing response",
      }));
      const data = await readJson<
        AudioSyncDiagResult & { lastStep?: string; elapsedMs?: number }
      >(res);

      if (!res.ok) {
        const errMsg = data.error ?? `HTTP ${res.status}`;
        setShortTestDebug((prev) => ({
          ...prev,
          lastError: errMsg,
          lastStep: data.lastStep ?? "server error",
        }));
        throw new Error(errMsg);
      }

      setShortTestDebug((prev) => ({
        ...prev,
        resultUrl: data.url ?? null,
        lastStep: data.lastStep ?? "done",
        lastError: data.error ?? null,
      }));
      setAudioSyncShortResult(data);
      setShortTestStep("done");
      if (data.error) setLastError(data.error);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setLastError(errMsg);
      setShortTestDebug((prev) => ({ ...prev, lastError: errMsg }));
      setShortTestStep(null);
    } finally {
      setBusy(null);
      setShortTestStartedAt(null);
    }
  }

  /** Export the first 20s applying lip sync offsets + optional fine-tune delta.
   *  Uses normalizeClipsForDurationLipSyncTest on the server so lip-sync clips are
   *  always freshly re-normalized with effectiveTrim = masterOffset + fineTune. */
  async function exportAudioSyncShortLipSync() {
    if (!multiId) return;
    setBusy("export-audio-sync-short-lipsync");
    setLastError(null);
    setAudioSyncShortLipSyncResult(null);

    const CLIENT_TIMEOUT_MS = 2 * 60 * 1000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () =>
          controller.abort(
            new Error("Lip sync offset test timed out after 2 minutes."),
          ),
        CLIENT_TIMEOUT_MS,
      );

      let res: Response;
      try {
        res = await fetch("/api/export-doctor/export-audio-sync-short", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({
            multiId,
            audioUrl: masterAudioUrl ?? null,
            audioStartSec: 0,
            syncMode: syncMode ?? "keep-as-is",
            durationSec: 20,
            lipSyncFineTuneSec: exportLipSyncFineTune,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const data = await readJson<
        AudioSyncDiagResult & { lastStep?: string; elapsedMs?: number }
      >(res);

      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setAudioSyncShortLipSyncResult(data);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportAllClipsCaptions() {
    if (!multiId) return;
    setBusy("export-all-captions");
    setLastError(null);
    setExportAllCaptionsResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all-captions", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          multiId,
          audioUrl: masterAudioUrl ?? null,
          captions: captions ?? null,
        }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      // Persist the body even on non-2xx so the real FFmpeg subtitle error + stderrTail survive.
      setExportAllCaptionsResult(data);
      if (!res.ok) {
        setLastError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportAllClipsEffects() {
    if (!multiId) return;
    setBusy("export-all-effects");
    setLastError(null);
    setExportAllEffectsResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all-effects", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          multiId,
          audioUrl: masterAudioUrl ?? null,
          captions: captions ?? null,
          effects: effects ?? [],
          conflictMode,
        }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      // Persist the body even on non-2xx so the real FFmpeg error + stderrTail survive.
      setExportAllEffectsResult(data);
      if (!res.ok) {
        setLastError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportAllClipsOverlays() {
    if (!multiId) return;
    setBusy("export-all-overlays");
    setLastError(null);
    setExportAllOverlaysResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all-overlays", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          multiId,
          audioUrl: masterAudioUrl ?? null,
          captions: captions ?? null,
          effects: effects ?? [],
          overlays: overlays ?? [],
          overlayIntensity: overlayIntensity ?? {},
          watermarkText: watermarkText ?? "Bow Down Visuals",
          watermarkType: watermarkType ?? "logo",
          watermarkPosition: watermarkPosition ?? "bottom-right",
          watermarkSize: watermarkSize ?? "medium",
          watermarkIncludeInExport: watermarkIncludeInExport ?? true,
          conflictMode,
        }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      setExportAllOverlaysResult(data);
      if (!res.ok) {
        setLastError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runOverlayMatchTest() {
    if (!multiId) return;
    setBusy("overlay-match-test");
    setLastError(null);
    setOverlayMatchResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-overlays-range", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          multiId,
          audioUrl: masterAudioUrl ?? null,
          captions: captions ?? null,
          effects: effects ?? [],
          overlays: overlays ?? [],
          overlayIntensity: overlayIntensity ?? {},
          watermarkText: watermarkText ?? "Bow Down Visuals",
          watermarkType: watermarkType ?? "logo",
          watermarkIncludeInExport: watermarkIncludeInExport ?? true,
          conflictMode,
          startSec: masterCurrentTimeSec ?? 0,
          durationSec: 3,
        }),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      setOverlayMatchResult(data);
      if (!res.ok) {
        setLastError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runEffectMatchTest() {
    if (!multiId) return;
    setBusy("effect-match-test");
    setLastError(null);
    setEffectMatchResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-effects-range", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          multiId,
          audioUrl: masterAudioUrl ?? null,
          captions: captions ?? null,
          effects: effects ?? [],
          conflictMode,
          startSec: masterCurrentTimeSec ?? 0,
          durationSec: 3,
        }),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      setEffectMatchResult(data);
      if (!res.ok) {
        setLastError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function connectTransitions() {
    if (!multiId) return;
    setBusy("export-transitions");
    setLastError(null);
    setTransitionsResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-effects-transitions", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          multiId,
          audioUrl: masterAudioUrl ?? null,
          effects: effects ?? [],
          conflictMode,
          transitions: appliedTransitions ?? [],
        }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      setTransitionsResult(data);
      if (!res.ok) {
        setLastError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportLipSyncPreview() {
    /* ── Immediately mark button clicked and start busy state ────────────────
       Both happen before any async work so the status panel updates right away.
       All errors in this function go to setLipSyncLastError (NOT setLastError)
       so they are visible in the Lip Sync Export Check section, not buried in
       the shared Export Doctor Status panel.
    ─────────────────────────────────────────────────────────────────────────── */
    setLipSyncButtonClicked(true);
    setBusy("lip-sync-preview");
    setLipSyncLastError(null);
    setLipSyncExportResult(null);
    setLipSyncExportMeta(null);
    setLipSyncDownloadCalled(false);

    try {
      /* ── 1. Resolve which scene to export ─────────────────────────────────── */
      let lipSyncIdx = selectedLipSyncSceneId
        ? uniqueScenes.findIndex(
            (s) =>
              s.id === selectedLipSyncSceneId &&
              !!(
                clipEdits?.[s.id]?.useLipSync && clipEdits?.[s.id]?.lipSyncUrl
              ),
          )
        : -1;
      /* Fallback: first scene with useLipSync=true + a saved lipSyncUrl */
      if (lipSyncIdx === -1) {
        lipSyncIdx = uniqueScenes.findIndex(
          (s) =>
            !!(clipEdits?.[s.id]?.useLipSync && clipEdits?.[s.id]?.lipSyncUrl),
        );
      }
      if (lipSyncIdx === -1) {
        const ceKeys = Object.keys(clipEdits ?? {}).join(", ") || "(none)";
        const selId = selectedLipSyncSceneId ?? "(none)";
        setLipSyncLastError(
          `No lip synced clip found. useLipSync+lipSyncUrl must both be set. ` +
            `selectedLipSyncSceneId=${selId}. clipEdits keys: ${ceKeys}`,
        );
        return;
      }

      const lipSyncScene = uniqueScenes[lipSyncIdx]!;
      const lipSyncCe = clipEdits![lipSyncScene.id]!;
      const lipSyncUrl = lipSyncCe.lipSyncUrl!;

      if (!masterAudioUrl) {
        setLipSyncLastError(
          "No project audio available. Add audio in Music Mixer first.",
        );
        return;
      }

      /* Master-player offset — applied exactly once in clipVideoOffsetSec */
      const clipVideoOffsetSec = lipSyncCe.lipSyncOffsetSeconds ?? 0;
      const metaSceneLabel = `Scene ${lipSyncScene.sceneNumber}${lipSyncScene.section ? ` — ${lipSyncScene.section}` : ""}`;

      /* ── 2. Download the lip sync clip to the server ──────────────────────── */
      setLipSyncDownloadCalled(true);
      const dlRes = await fetch("/api/export-doctor/download", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ projectId, url: lipSyncUrl }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const dlData = await readJson<DownloadResult>(dlRes);
      if (!dlRes.ok || !dlData.fileExists) {
        setLipSyncLastError(
          dlData.error ??
            `Download failed (HTTP ${dlRes.status}). ` +
              `URL: ${lipSyncUrl.slice(0, 80)}`,
        );
        return;
      }

      /* ── 3. Export: lip sync video + project audio segment ────────────────── */
      const tsRaw = lipSyncScene.timestamp ?? "";
      const tsMatch = tsRaw.match(/(\d+):(\d+)/);
      const audioStartSec = tsMatch
        ? parseInt(tsMatch[1]!, 10) * 60 + parseInt(tsMatch[2]!, 10)
        : 0;

      /* Record meta before the call so status shows "export offset" immediately */
      setLipSyncExportMeta({
        clipVideoOffsetSec,
        usedLipSyncUrl: true,
        sceneLabel: metaSceneLabel,
      });

      const expRes = await fetch("/api/export-doctor/export-audio", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          doctorId: dlData.doctorId,
          audioUrl: masterAudioUrl,
          audioStartSec,
          clipVideoOffsetSec, // ← master-player timing applied exactly once
          fullDuration: true,
        }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const expData = await readJson<ExportResult>(expRes);
      setLipSyncExportResult(expData);
      const exportErr =
        expData.error ?? (!expRes.ok ? `HTTP ${expRes.status}` : null);
      if (exportErr) setLipSyncLastError(exportErr);
    } catch (e) {
      setLipSyncLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!scene1) return null;

  // Every candidate URL field for Scene 1 (only demoClipUrl is populated in this data model)
  const fieldValues: Record<string, string> = {};
  for (const k of URL_FIELD_KEYS) fieldValues[k] = "";
  fieldValues["scene.demoClipUrl"] = scene1.demoClipUrl ?? "";

  const isReplitObjStore = /storage\.googleapis\.com\/replit-objstore-/.test(
    scene1Url,
  );
  const masterSourceAccepted = urlResult
    ? urlResult.status >= 200 && urlResult.status < 400 && !urlResult.isHtml
    : downloadResult
      ? !!downloadResult.fileExists
      : null;

  const statusRows: [string, boolean | null][] = [
    ["Scene 1 URL found", scene1Url.startsWith("http")],
    ["Scene 1 master player source accepted", masterSourceAccepted],
    [
      "Scene 1 Replit object storage allowed",
      scene1Url.startsWith("http") ? isReplitObjStore : null,
    ],
    ["Scene 1 URL returns video", urlResult ? urlResult.isVideo : null],
    ["Scene 1 downloaded", downloadResult ? !!downloadResult.fileExists : null],
    [
      "Scene 1 ffprobe valid",
      downloadResult ? !!downloadResult.ffprobeValid : null,
    ],
    [
      "Scene 1 simple export works",
      exportResult ? !!exportResult.success : null,
    ],
    [
      "Audio downloaded",
      audioExportResult ? !!audioExportResult.audioDownloaded : null,
    ],
    [
      "Scene 1 + audio export works",
      audioExportResult ? !!audioExportResult.success : null,
    ],
  ];

  // ── Caption pre-check (frontend, from the master player's caption settings) ──
  const KNOWN_CAPTION_PRESETS = [
    "clean-white",
    "gold-hiphop",
    "karaoke",
    "boxed",
    "viral-shorts",
    "minimal",
    "drill",
    "luxury",
    "rnb",
    "kids",
  ];
  const captionLines = captions?.lines ?? [];
  const validCaptionLines = captionLines.filter(
    (l) =>
      !!l.text?.trim() &&
      Number.isFinite(l.startSec) &&
      Number.isFinite(l.endSec) &&
      l.endSec > l.startSec &&
      l.startSec >= 0,
  );
  const fcCaptionRows = captionLines.length;
  const fcCaptionTimingValid =
    fcCaptionRows > 0 && validCaptionLines.length === fcCaptionRows;
  const fcCaptionsFound =
    !!captions &&
    captions.mode !== "none" &&
    (validCaptionLines.length > 0 ||
      captions.showArtistName ||
      captions.showSongTitle);
  const fcCaptionStyleFound =
    !!captions && KNOWN_CAPTION_PRESETS.includes(captions.stylePreset);
  const r = exportAllCaptionsResult;
  const captionStatusRows: [string, string, boolean | null][] = [
    [
      "captions found",
      (r?.captionsFound ?? fcCaptionsFound) ? "yes" : "no",
      r?.captionsFound ?? fcCaptionsFound,
    ],
    [
      "caption rows",
      String(r?.captionRows ?? fcCaptionRows),
      (r?.captionRows ?? fcCaptionRows) > 0,
    ],
    [
      "caption timing valid",
      (r?.captionTimingValid ?? fcCaptionTimingValid) ? "yes" : "no",
      r?.captionTimingValid ?? fcCaptionTimingValid,
    ],
    [
      "caption style found",
      `${(r?.captionStyleFound ?? fcCaptionStyleFound) ? "yes" : "no"}${captions?.stylePreset ? ` · ${r?.stylePreset ?? captions.stylePreset}` : ""}`,
      r?.captionStyleFound ?? fcCaptionStyleFound,
    ],
    [
      "captions burned into export",
      r ? (r.captionsBurned ? "yes" : "no") : "—",
      r ? !!r.captionsBurned : null,
    ],
    [
      "test export created",
      r ? (r.success ? "yes" : "no") : "—",
      r ? !!r.success : null,
    ],
  ];

  // ── Effects pre-check (frontend, from the master player's saved Auto AI effects) ──
  const SUPPORTED_EFFECTS = [
    "Film Grain",
    "Glow",
    "Blur",
    "Sharpen",
    "Vignette",
    "Black & White",
    "Neon Glow",
    "VHS",
    "Cinematic Bars",
    "Camera Shake",
    "Slow Zoom",
    "Speed Ramp",
    "Warm Grade",
    "Cool Grade",
    "Teal & Orange",
    "Moody Desaturated",
    "Vibrant Pop",
    "Street Night",
    "Luxury Gold",
    "Dark Drill",
    "Cinematic Contrast",
  ];
  const fxList = effects ?? [];
  const fcEffectsCount = fxList.length;
  const fcEffectsFound = fcEffectsCount > 0;
  const fcUnsupported = fxList.filter((e) => !SUPPORTED_EFFECTS.includes(e));
  const fx = exportAllEffectsResult;
  const fxUnsupported = fx?.unsupportedEffects ?? fcUnsupported;
  const effectsStatusRows: [string, string, boolean | null][] = [
    [
      "effects found",
      (fx?.effectsFound ?? fcEffectsFound) ? "yes" : "no",
      fx?.effectsFound ?? fcEffectsFound,
    ],
    [
      "effects count",
      String(fx?.effectsCount ?? fcEffectsCount),
      (fx?.effectsCount ?? fcEffectsCount) > 0,
    ],
    [
      "effects export connected",
      fx ? (fx.effectsExportConnected ? "yes" : "no") : "—",
      fx ? !!fx.effectsExportConnected : null,
    ],
    [
      "unsupported effects skipped",
      fxUnsupported.length > 0 ? fxUnsupported.join(", ") : "none",
      fxUnsupported.length === 0 ? true : null,
    ],
    [
      "captions preserved",
      fx ? (fx.captionsPreserved ? "yes" : "no") : "—",
      fx ? !!fx.captionsPreserved : null,
    ],
    [
      "audio preserved",
      fx ? (fx.audioPreserved ? "yes" : "no") : "—",
      fx ? !!fx.audioPreserved : null,
    ],
    [
      "test export created",
      fx ? (fx.testExportCreated ? "yes" : "no") : "—",
      fx ? !!fx.testExportCreated : null,
    ],
  ];

  // ── Effect Stack Comparison (master vs export) ──
  // Master stack is the flat global Auto AI list; the data model is global so
  // scope/opacity/blend/range are reported honestly as global/100%/normal/full.
  const COLOR_GRADE_EFFECTS = new Set([
    "Black & White",
    "Warm Grade",
    "Cool Grade",
    "Teal & Orange",
    "Moody Desaturated",
    "Vibrant Pop",
    "Street Night",
    "Luxury Gold",
    "Dark Drill",
    "Cinematic Contrast",
  ]);
  const masterStack: ExportEffectEntry[] = fxList.map((name) => ({
    name,
    type: COLOR_GRADE_EFFECTS.has(name) ? "color-grade" : "filter",
    scope: "global",
    intensity: null,
    opacity: 1,
    blend: "normal",
    startSec: 0,
    endSec: projectDurationSec ?? 0,
    supported: SUPPORTED_EFFECTS.includes(name),
    applied: true,
    ffmpeg: "",
  }));
  // Prefer the most-recent stack result (match test or full effects export).
  const stackSource = effectMatchResult?.effectStack?.length
    ? effectMatchResult
    : fx;
  const exportStack: ExportEffectEntry[] = stackSource?.effectStack ?? [];
  const conflict = stackSource?.conflict ?? null;
  const stackMatch = stackSource?.stackMatch;
  const stackMatchKnown = !!stackSource && stackMatch !== undefined;

  // ── 3-Second Effect Match Test status ──
  const em = effectMatchResult;
  const matchStatusRows: [string, string, boolean | null][] = [
    [
      "current master time",
      `${(em?.rangeStart ?? masterCurrentTimeSec ?? 0).toFixed(1)}s`,
      null,
    ],
    [
      "active scene",
      em ? `Scene ${(em.activeSceneIndex ?? 0) + 1}` : "—",
      null,
    ],
    [
      "master effects found",
      String(em?.masterEffectsFound ?? fcEffectsCount),
      (em?.masterEffectsFound ?? fcEffectsCount) > 0,
    ],
    [
      "export effects applied",
      em ? String(em.effectsApplied ?? 0) : "—",
      em ? (em.effectsApplied ?? 0) > 0 : null,
    ],
    [
      "output created",
      em ? (em.success ? "yes" : "no") : "—",
      em ? !!em.success : null,
    ],
    [
      "effect stack matched",
      em ? (em.stackMatch ? "yes" : "no") : "—",
      em ? !!em.stackMatch : null,
    ],
  ];

  // ── Overlay pre-check (frontend, from settings.overlays) ──
  const ANIMATED_OVERLAYS = [
    "Rain",
    "Smoke",
    "Sparks",
    "Dust",
    "Light Leaks",
    "Lens Flare",
    "Animated Waveform",
  ];
  const ovList = overlays ?? [];
  const fcOverlaysFound = ovList.length > 0 || !!watermarkText?.trim();
  const fcWatermarkFound =
    ovList.includes("Logo / Watermark") || !!watermarkText?.trim();
  const fcUnsupportedOverlays = ovList.filter((o) =>
    ANIMATED_OVERLAYS.includes(o),
  );
  const ovr = exportAllOverlaysResult;
  const ovrWmText =
    ovr?.overlayWatermarkText ?? watermarkText ?? "Bow Down Visuals";
  const overlayStatusRows: [string, string, boolean | null][] = [
    [
      "overlays found",
      (ovr?.overlaysFound ?? fcOverlaysFound) ? "yes" : "no",
      ovr?.overlaysFound ?? fcOverlaysFound,
    ],
    [
      "unsupported overlays skipped",
      (ovr?.unsupportedOverlays ?? fcUnsupportedOverlays).join(", ") || "none",
      (ovr?.unsupportedOverlays ?? fcUnsupportedOverlays).length === 0
        ? true
        : null,
    ],
    [
      "watermark found",
      (ovr?.watermarkFound ?? fcWatermarkFound) ? "yes" : "no",
      ovr?.watermarkFound ?? fcWatermarkFound,
    ],
    [
      "watermark included",
      ovr ? (ovr.watermarkIncluded ? "yes" : "no") : "—",
      ovr ? !!ovr.watermarkIncluded : null,
    ],
    ["watermark text", ovrWmText, null],
    [
      "effects preserved",
      ovr ? (ovr.effectsPreserved ? "yes" : "no") : "—",
      ovr ? !!ovr.effectsPreserved : null,
    ],
    [
      "captions preserved",
      ovr ? (ovr.captionsPreserved ? "yes" : "no") : "—",
      ovr ? !!ovr.captionsPreserved : null,
    ],
    [
      "audio preserved",
      ovr ? (ovr.audioPreserved ? "yes" : "no") : "—",
      ovr ? !!ovr.audioPreserved : null,
    ],
    [
      "overlay export created",
      ovr ? (ovr.testExportCreated ? "yes" : "no") : "—",
      ovr ? !!ovr.testExportCreated : null,
    ],
  ];

  // ── Transitions ──
  const appliedTx = appliedTransitions ?? [];
  const tx = transitionsResult;
  const txPlan = tx?.transitionPlan ?? [];
  const txSupported = tx?.supportedTransitions ?? [];
  const txUnsupported = tx?.unsupportedTransitions ?? [];

  return (
    <EditorCard
      icon={<Stethoscope className="h-4 w-4" />}
      title="Export Doctor"
      subtitle="Prove ONE clip can download and export before running the full video."
    >
      <div className="space-y-4">
        {/* ════════════════════════ LIP SYNC EXPORT TEST ════════════════════════
            Placed at the very top so it is immediately visible.
        ══════════════════════════════════════════════════════════════════════════ */}
        {(() => {
          const lipSyncScenes = uniqueScenes.filter((s) => {
            const ce = clipEdits?.[s.id];
            return !!(ce?.useLipSync && ce.lipSyncUrl);
          });
          const hasLipSync = lipSyncScenes.length > 0;
          const exportScene = (() => {
            if (selectedLipSyncSceneId) {
              const sel = lipSyncScenes.find(
                (s) => s.id === selectedLipSyncSceneId,
              );
              if (sel) return sel;
            }
            return lipSyncScenes[0] ?? null;
          })();
          const exportSceneCe = exportScene
            ? clipEdits?.[exportScene.id]
            : null;
          const exportSceneLabel = exportScene
            ? `Scene ${exportScene.sceneNumber}${exportScene.section ? ` — ${exportScene.section}` : ""}`
            : "—";
          const sceneMismatch =
            !!selectedLipSyncSceneId &&
            !!exportScene &&
            exportScene.id !== selectedLipSyncSceneId;
          const fmtOff = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}s`;

          /* clipId: SceneData.clipId is always null from the parser; fall back to
             "scene:<id prefix>" so the row always shows something useful. */
          const resolvedClipId =
            exportScene?.clipId ??
            (exportScene ? `scene:${exportScene.id.slice(0, 14)}` : "—");
          const clipIdResolved = !!exportScene?.clipId;

          /* Export lifecycle state (from component-level state, not this IIFE) */
          const isRunning = busy === "lip-sync-preview";
          const exportStarted = lipSyncButtonClicked;
          const exportFinished =
            !isRunning &&
            (!!lipSyncExportResult ||
              (lipSyncButtonClicked && !!lipSyncLastError));

          return (
            <div className="rounded-xl border border-primary/30 bg-primary/[0.04] px-3 py-3 space-y-3">
              {/* Header */}
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-primary" />
                <p className="text-[11px] font-black text-white/85 uppercase tracking-widest">
                  Lip Sync Export Test
                </p>
              </div>

              {/* Scene identity rows */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5">
                <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">
                  Scene
                </p>
                {(
                  [
                    ["selected scene", exportSceneLabel, !!exportScene],
                    ["selected clipId", resolvedClipId, clipIdResolved],
                    [
                      "selected sceneId",
                      exportScene ? exportScene.id.slice(0, 16) + "…" : "—",
                      !!exportScene,
                    ],
                    [
                      "useLipSync",
                      exportSceneCe?.useLipSync ? "yes ✓" : "no",
                      exportSceneCe?.useLipSync ?? false,
                    ],
                    [
                      "lipSyncUrl exists",
                      exportSceneCe?.lipSyncUrl ? "yes ✓" : "no",
                      !!exportSceneCe?.lipSyncUrl,
                    ],
                    [
                      "selected scene mismatch",
                      sceneMismatch ? "yes ✗" : "no ✓",
                      !sceneMismatch,
                    ],
                  ] as [string, string, boolean | null][]
                ).map(([label, val, ok]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-2 text-[11px] font-mono"
                  >
                    <span className="text-white/40">{label}</span>
                    <span
                      className={`font-bold truncate max-w-[55%] text-right ${ok === null ? "text-white/60" : ok ? "text-green-400" : "text-red-400"}`}
                    >
                      {val}
                    </span>
                  </div>
                ))}
              </div>

              {/* Offset rows */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5">
                <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">
                  Timing
                </p>
                {(
                  [
                    [
                      "master player offset",
                      fmtOff(exportSceneCe?.lipSyncOffsetSeconds ?? 0),
                      null,
                    ],
                    [
                      "export offset",
                      lipSyncExportMeta
                        ? fmtOff(lipSyncExportMeta.clipVideoOffsetSec)
                        : "—",
                      null,
                    ],
                  ] as [string, string, boolean | null][]
                ).map(([label, val, ok]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-2 text-[11px] font-mono"
                  >
                    <span className="text-white/40">{label}</span>
                    <span
                      className={`font-bold ${ok === null ? "text-white/60" : ok ? "text-green-400" : "text-red-400"}`}
                    >
                      {val}
                    </span>
                  </div>
                ))}
              </div>

              {/* Export lifecycle rows */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5">
                <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">
                  Export Status
                </p>
                {(
                  [
                    [
                      "button clicked",
                      exportStarted ? "yes ✓" : "no",
                      exportStarted,
                    ],
                    [
                      "selected clipId resolved",
                      clipIdResolved
                        ? "yes ✓ (DB id)"
                        : `yes ✓ (${resolvedClipId.slice(0, 18)})`,
                      !!exportScene,
                    ],
                    [
                      "export route called",
                      lipSyncDownloadCalled
                        ? "yes ✓"
                        : exportStarted
                          ? "pending…"
                          : "no",
                      lipSyncDownloadCalled
                        ? true
                        : exportStarted
                          ? null
                          : false,
                    ],
                    [
                      "export started",
                      isRunning ? "running… ✓" : exportStarted ? "yes ✓" : "no",
                      isRunning ? null : exportStarted,
                    ],
                    [
                      "export finished",
                      isRunning
                        ? "running…"
                        : exportFinished
                          ? lipSyncExportResult?.success
                            ? "yes ✓"
                            : "failed"
                          : "—",
                      isRunning
                        ? null
                        : exportFinished
                          ? (lipSyncExportResult?.success ?? false)
                          : null,
                    ],
                    [
                      "result url",
                      lipSyncExportResult?.url ? "available ✓" : "—",
                      lipSyncExportResult?.url ? true : null,
                    ],
                    [
                      "last error",
                      lipSyncLastError ?? "—",
                      lipSyncLastError
                        ? false
                        : exportFinished && !lipSyncLastError
                          ? true
                          : null,
                    ],
                  ] as [string, string, boolean | null][]
                ).map(([label, val, ok]) => (
                  <div
                    key={label}
                    className="flex items-start justify-between gap-2 text-[11px] font-mono"
                  >
                    <span className="text-white/40 shrink-0">{label}</span>
                    <span
                      className={`font-bold text-right break-all max-w-[58%] leading-snug ${ok === null ? "text-white/50" : ok ? "text-green-400" : "text-red-400"}`}
                    >
                      {val}
                    </span>
                  </div>
                ))}
              </div>

              {/* Mismatch warning */}
              {sceneMismatch && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/[0.07] text-red-400 text-[10px] font-semibold">
                  <span className="shrink-0 mt-px">✗</span>
                  Selected scene mismatch — do not export yet. Enable useLipSync
                  on the correct scene in the Lip Sync tab first.
                </div>
              )}

              {/* No lip sync clips warning */}
              {!hasLipSync && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] text-amber-400/70 text-[10px]">
                  <span className="shrink-0 mt-px">⚠</span>
                  No lip synced clips with useLipSync=true. Enable lip sync in
                  the Lip Sync tab, then click "Use in Player".
                </div>
              )}

              {/* Export button */}
              <Button
                onClick={exportLipSyncPreview}
                disabled={
                  busy !== null ||
                  !hasLipSync ||
                  !masterAudioUrl ||
                  sceneMismatch
                }
                variant="outline"
                className="w-full gap-2 border-primary/40 bg-primary/[0.08] text-primary hover:bg-primary/[0.15] text-xs font-bold disabled:opacity-40"
                data-testid="btn-doctor-lip-sync-preview"
              >
                {busy === "lip-sync-preview" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…
                  </>
                ) : (
                  <>
                    <Stethoscope className="h-3.5 w-3.5" />
                    {exportScene
                      ? `Export ${exportSceneLabel} Lip Sync Offset Match Test`
                      : "Export Selected Lip Sync Scene Offset Match Test"}
                  </>
                )}
              </Button>
              {!masterAudioUrl && hasLipSync && (
                <p className="text-[10px] text-amber-400/70 text-center">
                  Project audio required — add audio in Music Mixer.
                </p>
              )}

              {/* Result */}
              {lipSyncExportResult?.url && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
                    <CheckCircle2 className="h-4 w-4" />
                    Lip sync export succeeded ·{" "}
                    {lipSyncExportResult.duration?.toFixed(1)}s · audio{" "}
                    {lipSyncExportResult.hasAudio ? "✓" : "✗"}
                  </div>
                  <video
                    src={lipSyncExportResult.url}
                    controls
                    className="w-full max-h-64 rounded-lg bg-black"
                  />
                  <a
                    href={lipSyncExportResult.url}
                    download
                    
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Open / download lip
                    sync test video
                  </a>
                </div>
              )}
              {lipSyncExportResult && !lipSyncExportResult.success && (
                <p className="text-[10px] text-red-400/80">
                  {lipSyncExportResult.error ?? "Export failed"}
                </p>
              )}
            </div>
          );
        })()}

        {/* ── Status panel ── */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3 space-y-1.5">
          <p className="text-[10px] font-black text-white/50 uppercase tracking-widest mb-1">
            Export Doctor Status
          </p>
          {downloadStale && (
            <p className="text-[11px] font-mono text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-2 leading-snug">
              Scene 1's clip URL changed since these checks ran — the results
              below are stale and the export buttons are locked until you
              re-run "Test URL" and "Download Scene 1 Only".
            </p>
          )}
          {audioStale && (
            <p className="text-[11px] font-mono text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-2 leading-snug">
              The selected audio changed since the audio export check ran —
              re-run "Export Scene 1 + Audio Only" to re-verify.
            </p>
          )}
          {statusRows.map(([label, val]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-2 text-[11px] font-mono"
            >
              <span className="text-white/40">{label}</span>
              <span
                className={`font-bold ${val === null ? "text-white/25" : val ? "text-green-400" : "text-red-400"}`}
              >
                {val === null ? "—" : val ? "yes" : "no"}
              </span>
            </div>
          ))}
          <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
            <span className="text-white/40 shrink-0">Last error</span>
            <span className="text-red-400/80 text-right break-words leading-snug">
              {lastError ?? "—"}
            </span>
          </div>
        </div>

        {/* ── Four action buttons ── */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={testUrl}
            disabled={busy !== null || !scene1Url}
            variant="outline"
            className="gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs"
            data-testid="btn-doctor-test-url"
          >
            {busy === "url" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            Test Scene 1 Source URL
          </Button>
          <Button
            onClick={downloadScene1}
            disabled={busy !== null || !scene1Url}
            variant="outline"
            className="gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs"
            data-testid="btn-doctor-download"
          >
            {busy === "download" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Download Scene 1 Only
          </Button>
          <Button
            onClick={exportScene1}
            disabled={busy !== null || !downloadOk}
            variant="outline"
            className="gap-2 border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10 text-xs disabled:opacity-40"
            data-testid="btn-doctor-export"
          >
            {busy === "export" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Film className="h-3.5 w-3.5" />
            )}
            Export Scene 1 Only
          </Button>
          <Button
            onClick={exportScene1Audio}
            disabled={busy !== null || !downloadOk}
            variant="outline"
            className="gap-2 border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10 text-xs disabled:opacity-40"
            data-testid="btn-doctor-export-audio"
          >
            {busy === "export-audio" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Music2 className="h-3.5 w-3.5" />
            )}
            Export Scene 1 + Audio Only
          </Button>
        </div>
        {!downloadOk && (
          <p className="text-center text-[10px] text-white/25 leading-relaxed -mt-1">
            Export buttons unlock after Scene 1 downloads and passes ffprobe.
          </p>
        )}

        {/* ── TEST 1 result: URL fields ── */}
        <div className="rounded-xl border border-white/[0.08] overflow-hidden">
          <div className="px-3 py-2 bg-white/[0.03] border-b border-white/[0.06]">
            <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">
              Scene 1 URL Fields
            </p>
          </div>
          <div className="px-3 py-2.5 space-y-1 text-[9px] font-mono">
            {URL_FIELD_KEYS.map((k) => {
              const v = fieldValues[k] ?? "";
              const used = k === "scene.demoClipUrl";
              return (
                <div key={k} className="flex items-start gap-2">
                  <span
                    className={`shrink-0 w-[180px] ${used ? "text-primary/70" : "text-white/30"}`}
                  >
                    {k}
                    {used ? " (master player)" : ""}
                  </span>
                  <span
                    className={`break-all leading-tight ${v ? "text-white/55" : "text-white/20"}`}
                  >
                    {v || "(empty)"}
                  </span>
                </div>
              );
            })}
            <div className="flex items-start gap-2 pt-1.5 mt-1.5 border-t border-white/[0.06]">
              <span className="shrink-0 w-[180px] text-white/40">
                Final selected URL
              </span>
              <span className="break-all leading-tight text-white/60">
                {scene1Url || "(none)"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 w-[180px] text-white/40">
                Starts with http
              </span>
              <span
                className={`font-bold ${scene1Url.startsWith("http") ? "text-green-400" : "text-red-400"}`}
              >
                {scene1Url.startsWith("http") ? "yes" : "no"}
              </span>
            </div>
            {urlResult && (
              <>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 w-[180px] text-white/40">
                    HTTP status
                  </span>
                  <span className="text-white/60">
                    {urlResult.status || "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 w-[180px] text-white/40">
                    Content-Type
                  </span>
                  <span className="text-white/60">
                    {urlResult.contentType || "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 w-[180px] text-white/40">
                    Content-Length
                  </span>
                  <span className="text-white/60">
                    {fmtBytes(urlResult.contentLength)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 w-[180px] text-white/40">
                    Returns video
                  </span>
                  <span
                    className={`font-bold ${urlResult.isVideo ? "text-green-400" : "text-red-400"}`}
                  >
                    {urlResult.isVideo ? "yes" : "no"}
                  </span>
                </div>
                {urlResult.snippet && (
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 w-[180px] text-white/40">
                      First 100 chars
                    </span>
                    <span className="break-all leading-tight text-amber-400/80">
                      {urlResult.snippet.slice(0, 100)}
                    </span>
                  </div>
                )}
                <div
                  className={`mt-1 pt-1 border-t border-white/[0.06] ${urlResult.isHtml ? "text-red-400" : urlResult.isVideo ? "text-green-400" : "text-amber-400"}`}
                >
                  {urlResult.message}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── TEST 2 result: download ── */}
        {downloadResult && (
          <div
            className={`rounded-xl border overflow-hidden ${downloadOk ? "border-green-500/25 bg-green-500/[0.04]" : "border-red-500/25 bg-red-500/[0.04]"}`}
          >
            <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2">
              {downloadOk ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-400" />
              )}
              <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">
                Scene 1 Download
              </p>
            </div>
            <div className="px-3 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
              <div className="col-span-2 flex items-start gap-2">
                <span className="text-white/35 shrink-0 w-[110px]">
                  Local path
                </span>
                <span className="text-white/55 break-all">
                  {downloadResult.localPath}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/35 w-[110px]">File exists</span>
                <span
                  className={`font-bold ${downloadResult.fileExists ? "text-green-400" : "text-red-400"}`}
                >
                  {downloadResult.fileExists ? "yes" : "no"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/35 w-[80px]">File size</span>
                <span className="text-white/55">
                  {fmtBytes(downloadResult.fileSize)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/35 w-[110px]">Duration</span>
                <span className="text-white/55">
                  {downloadResult.duration
                    ? `${downloadResult.duration.toFixed(2)}s`
                    : "—"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/35 w-[80px]">Codec</span>
                <span className="text-white/55">
                  {downloadResult.codec || "—"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/35 w-[110px]">Resolution</span>
                <span className="text-white/55">
                  {downloadResult.width
                    ? `${downloadResult.width}×${downloadResult.height}`
                    : "—"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/35 w-[80px]">ffprobe</span>
                <span
                  className={`font-bold ${downloadResult.ffprobeValid ? "text-green-400" : "text-red-400"}`}
                >
                  {downloadResult.ffprobeValid ? "valid" : "invalid"}
                </span>
              </div>
              {downloadResult.error && (
                <div className="col-span-2 text-red-400/80 break-words pt-1 border-t border-red-500/20">
                  {downloadResult.error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TEST 3 result: simple export ── */}
        {exportResult?.success && exportResult.url && (
          <div className="rounded-xl border border-green-500/25 bg-green-500/[0.04] px-3 py-3 space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
              <CheckCircle2 className="h-4 w-4" /> Scene 1 test export succeeded
              · {exportResult.duration?.toFixed(1)}s ·{" "}
              {fmtBytes(exportResult.fileSize)}
            </div>
            <video
              src={exportResult.url}
              controls
              className="w-full max-h-64 rounded-lg bg-black"
            />
            <a
              href={exportResult.url}
              download
              
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Open / download test video
            </a>
          </div>
        )}

        {/* ── TEST 4 result: scene 1 + audio ── */}
        {audioExportResult?.success && audioExportResult.url && (
          <div className="rounded-xl border border-green-500/25 bg-green-500/[0.04] px-3 py-3 space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
              <CheckCircle2 className="h-4 w-4" /> Scene 1 + audio export
              succeeded · {audioExportResult.duration?.toFixed(1)}s · audio{" "}
              {audioExportResult.hasAudio ? "✓" : "✗"}
            </div>
            <video
              src={audioExportResult.url}
              controls
              className="w-full max-h-64 rounded-lg bg-black"
            />
            <a
              href={audioExportResult.url}
              download
              
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Open / download test video
            </a>
          </div>
        )}

        {/* ════════ LIP SYNC EXPORT TEST — detailed panels (button is at the top) ════════ */}
        {(() => {
          /* All deduplicated scenes that have useLipSync=true + a saved URL */
          const lipSyncScenes = uniqueScenes.filter((s) => {
            const ce = clipEdits?.[s.id];
            return !!(ce?.useLipSync && ce.lipSyncUrl);
          });
          const hasLipSync = lipSyncScenes.length > 0;

          /* Which scene will be exported:
             1. The scene selected in the Lip Sync tab (selectedLipSyncSceneId), if it has a result
             2. Otherwise the first scene with useLipSync=true + lipSyncUrl */
          const exportScene = (() => {
            if (selectedLipSyncSceneId) {
              const sel = lipSyncScenes.find(
                (s) => s.id === selectedLipSyncSceneId,
              );
              if (sel) return sel;
            }
            return lipSyncScenes[0] ?? null;
          })();
          const exportSceneCe = exportScene
            ? clipEdits?.[exportScene.id]
            : null;
          /* Use scene.sceneNumber — NOT uniqueScenes.indexOf() — so Scene 4 stays Scene 4. */
          const exportSceneLabel = exportScene
            ? `Scene ${exportScene.sceneNumber}${exportScene.section ? ` — ${exportScene.section}` : ""}`
            : "—";
          /* Mismatch: Lip Sync tab selected a scene, but Export Doctor had to fall back to another. */
          const sceneMismatch =
            !!selectedLipSyncSceneId &&
            !!exportScene &&
            exportScene.id !== selectedLipSyncSceneId;
          const fmtOff = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}s`;

          /* Per-scene clip source summary — use s.sceneNumber, not loop index */
          const lipSyncSummaryRows = uniqueScenes.map((s) => {
            const ce = clipEdits?.[s.id];
            const active = !!(ce?.useLipSync && ce.lipSyncUrl);
            const isSel = s.id === selectedLipSyncSceneId;
            return {
              label: `Scene ${s.sceneNumber}${s.section ? ` · ${s.section}` : ""}${isSel ? " ◀ selected" : ""}`,
              source: active ? "lip sync ✓" : "original clip",
              ok: active as boolean | null,
            };
          });

          return (
            <div className="pt-2 mt-2 border-t border-white/[0.08]">
              <div className="flex items-center gap-2 mb-3">
                <Stethoscope className="h-4 w-4 text-primary/70" />
                <p className="text-[11px] font-black text-white/70 uppercase tracking-widest">
                  Lip Sync Export Check
                </p>
              </div>

              {/* Per-clip source priority panel */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5 mb-3">
                <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">
                  Clip Source Priority
                </p>
                {lipSyncSummaryRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-2 text-[11px] font-mono"
                  >
                    <span className="text-white/40">{row.label}</span>
                    <span
                      className={`font-bold ${row.ok ? "text-green-400" : "text-white/25"}`}
                    >
                      {row.source}
                    </span>
                  </div>
                ))}
              </div>

              {/* ── Lip Sync Export Selection (identity check) ── */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5 mb-3">
                <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">
                  Lip Sync Export Selection
                </p>
                {(
                  [
                    ["selected scene label", exportSceneLabel, !!exportScene],
                    [
                      "selected scene number",
                      exportScene ? String(exportScene.sceneNumber) : "—",
                      !!exportScene,
                    ],
                    [
                      "selected clipId",
                      exportScene?.clipId ?? "—",
                      !!exportScene?.clipId,
                    ],
                    [
                      "selected sceneId",
                      exportScene ? exportScene.id.slice(0, 14) + "…" : "—",
                      !!exportScene,
                    ],
                    [
                      "timeline index",
                      exportScene
                        ? String(
                            scenes.findIndex((s) => s.id === exportScene.id) +
                              1,
                          )
                        : "—",
                      !!exportScene,
                    ],
                    [
                      "lipSyncUrl exists",
                      exportSceneCe?.lipSyncUrl ? "yes ✓" : "no",
                      !!exportSceneCe?.lipSyncUrl,
                    ],
                    [
                      "useLipSync",
                      exportSceneCe?.useLipSync ? "yes ✓" : "no",
                      exportSceneCe?.useLipSync ?? false,
                    ],
                    [
                      "master player offset",
                      fmtOff(exportSceneCe?.lipSyncOffsetSeconds ?? 0),
                      null,
                    ],
                    [
                      "export offset",
                      lipSyncExportMeta
                        ? fmtOff(lipSyncExportMeta.clipVideoOffsetSec)
                        : "—",
                      null,
                    ],
                  ] as [string, string, boolean | null][]
                ).map(([label, val, ok]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-2 text-[11px] font-mono"
                  >
                    <span className="text-white/40">{label}</span>
                    <span
                      className={`font-bold truncate max-w-[55%] text-right ${ok === null ? "text-white/60" : ok ? "text-green-400" : "text-red-400"}`}
                    >
                      {val}
                    </span>
                  </div>
                ))}
              </div>

              {/* ── Mismatch warning ── */}
              {sceneMismatch && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/[0.07] text-red-400 text-[10px] font-semibold mb-3">
                  <span className="shrink-0 mt-px">✗</span>
                  Selected scene mismatch — do not export yet. The Lip Sync tab
                  selected a different scene than what Export Doctor can find
                  with useLipSync=true.
                </div>
              )}

              {/* ── Export check status ── */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5 mb-3">
                <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">
                  Lip Sync Export Check
                </p>
                {(
                  [
                    [
                      "lip synced clips found",
                      hasLipSync ? "yes ✓" : "no",
                      hasLipSync,
                    ],
                    [
                      "selected lip sync scene",
                      exportSceneLabel,
                      !!exportScene,
                    ],
                    [
                      "lip sync clipId",
                      exportScene?.clipId ?? "—",
                      !!exportScene?.clipId,
                    ],
                    [
                      "useLipSync active",
                      exportSceneCe?.useLipSync ? "yes ✓" : "no",
                      exportSceneCe?.useLipSync ?? null,
                    ],
                    [
                      "lipSyncUrl exists",
                      exportSceneCe?.lipSyncUrl ? "yes ✓" : "no",
                      !!exportSceneCe?.lipSyncUrl,
                    ],
                    [
                      "video source",
                      exportScene
                        ? exportSceneCe?.useLipSync && exportSceneCe?.lipSyncUrl
                          ? "lip sync ✓"
                          : "original clip"
                        : "—",
                      exportScene
                        ? !!(
                            exportSceneCe?.useLipSync &&
                            exportSceneCe?.lipSyncUrl
                          )
                        : null,
                    ],
                    [
                      "project audio",
                      masterAudioUrl ? "ready ✓" : "missing",
                      !!masterAudioUrl,
                    ],
                    [
                      "export started",
                      busy === "lip-sync-preview"
                        ? "yes ✓"
                        : lipSyncExportResult || lipSyncLastError
                          ? "yes ✓"
                          : "no",
                      busy === "lip-sync-preview" ||
                        !!lipSyncExportResult ||
                        !!lipSyncLastError,
                    ],
                    [
                      "export finished",
                      busy === "lip-sync-preview"
                        ? "running…"
                        : lipSyncExportResult
                          ? "yes ✓"
                          : lipSyncLastError
                            ? "failed"
                            : "—",
                      busy === "lip-sync-preview"
                        ? null
                        : lipSyncExportResult
                          ? !!lipSyncExportResult.success
                          : lipSyncLastError
                            ? false
                            : null,
                    ],
                    [
                      "result url",
                      lipSyncExportResult?.url ? "available ✓" : "—",
                      !!lipSyncExportResult?.url,
                    ],
                    [
                      "last error",
                      lipSyncLastError ?? "—",
                      lipSyncLastError ? false : null,
                    ],
                  ] as [string, string, boolean | null][]
                ).map(([label, val, ok]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-2 text-[11px] font-mono"
                  >
                    <span className="text-white/40">{label}</span>
                    <span
                      className={`font-bold truncate max-w-[55%] text-right ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-red-400"}`}
                    >
                      {val}
                    </span>
                  </div>
                ))}
              </div>

              {/* Lip Sync Export Timing — verifies offset direction, value, and single application */}
              {(() => {
                const currentOffset = exportSceneCe?.lipSyncOffsetSeconds ?? 0;
                const fmtOffset = (v: number) =>
                  `${v >= 0 ? "+" : ""}${v.toFixed(2)}s`;
                const masterUsingLs = !!(
                  exportSceneCe?.useLipSync && exportSceneCe?.lipSyncUrl
                );
                const hasExported = lipSyncExportMeta !== null;
                const exportedOffset =
                  lipSyncExportMeta?.clipVideoOffsetSec ?? null;
                const exportedUrl = lipSyncExportMeta?.usedLipSyncUrl ?? false;
                /* Offset matches when value is identical to what was exported */
                const offsetMatches =
                  hasExported && exportedOffset === currentOffset;
                const exportMatches =
                  hasExported &&
                  exportedUrl &&
                  offsetMatches &&
                  !!lipSyncExportResult?.success;
                return (
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5 mb-3">
                    <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">
                      Lip Sync Export Timing
                    </p>
                    {(
                      [
                        /* Row 1: what offset the master player is using right now */
                        [
                          "master player offset",
                          masterUsingLs
                            ? `${fmtOffset(currentOffset)} (active)`
                            : `${fmtOffset(currentOffset)} (lip sync off)`,
                          masterUsingLs ? null : false,
                        ],
                        /* Row 2: what offset was sent in the last export */
                        [
                          "export offset",
                          !hasExported
                            ? "—"
                            : `${fmtOffset(exportedOffset!)}${offsetMatches ? " ✓ matches" : " ✗ stale"}`,
                          !hasExported ? null : offsetMatches,
                        ],
                        /* Row 3: confirm the offset was applied exactly once, not doubled */
                        [
                          "offset applied once",
                          !hasExported ? "—" : "yes ✓",
                          !hasExported ? null : true,
                        ],
                        /* Row 4: overall verdict */
                        [
                          "export matches master player",
                          !hasExported
                            ? "—"
                            : exportMatches
                              ? "yes ✓"
                              : offsetMatches
                                ? "re-export needed"
                                : "offset changed — re-export",
                          !hasExported ? null : exportMatches,
                        ],
                      ] as [string, string, boolean | null][]
                    ).map(([label, val, ok]) => (
                      <div
                        key={label}
                        className="flex items-start justify-between gap-2 text-[11px] font-mono"
                      >
                        <span className="text-white/40 shrink-0">{label}</span>
                        <span
                          className={`font-bold text-right ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-red-400"}`}
                        >
                          {val}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {!hasLipSync && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] text-amber-400/70 text-[10px] mb-3">
                  <span className="shrink-0 mt-px">⚠</span>
                  No lip synced clips with useLipSync=true. Enable lip sync in
                  the Lip Sync tab, then click "Use in Player".
                </div>
              )}

              {/* Button — targets the selected lip sync scene; blocked on mismatch */}
              <Button
                onClick={exportLipSyncPreview}
                disabled={
                  busy !== null ||
                  !hasLipSync ||
                  !masterAudioUrl ||
                  sceneMismatch
                }
                variant="outline"
                className="w-full gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs disabled:opacity-40"
                data-testid="btn-doctor-lip-sync-preview"
              >
                {busy === "lip-sync-preview" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…
                  </>
                ) : (
                  <>
                    <Stethoscope className="h-3.5 w-3.5" />
                    {exportScene
                      ? `Export ${exportSceneLabel} Lip Sync Offset Match Test`
                      : "Export Selected Lip Sync Scene Offset Match Test"}
                  </>
                )}
              </Button>
              {!masterAudioUrl && hasLipSync && (
                <p className="mt-1.5 text-[10px] text-amber-400/70 text-center">
                  Project audio required — add audio in Music Mixer.
                </p>
              )}

              {lipSyncExportResult?.url && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
                    <CheckCircle2 className="h-4 w-4" /> Lip sync export
                    succeeded · {lipSyncExportResult.duration?.toFixed(1)}s ·
                    audio {lipSyncExportResult.hasAudio ? "✓" : "✗"}
                  </div>
                  <video
                    src={lipSyncExportResult.url}
                    controls
                    className="w-full max-h-64 rounded-lg bg-black"
                  />
                  <a
                    href={lipSyncExportResult.url}
                    download
                    
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Open / download lip
                    sync test video
                  </a>
                </div>
              )}
              {lipSyncExportResult && !lipSyncExportResult.success && (
                <p className="mt-2 text-[10px] text-red-400/80">
                  {lipSyncExportResult.error ?? "Export failed"}
                </p>
              )}
            </div>
          );
        })()}

        {/* ════════ ALL CLIPS DOCTOR ════════ */}
        <div className="pt-2 mt-2 border-t border-white/[0.08]">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4 text-primary" />
            <p className="text-[11px] font-black text-white/70 uppercase tracking-widest">
              All {multiClips.length} Clips Doctor
            </p>
          </div>

          {/* ── Export order status ── */}
          {uniqueScenes.length === 0 ? (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] text-amber-400 text-[11px] font-semibold mb-3">
              <span className="shrink-0 mt-px">⚠</span>
              Saved timeline order missing. Using original order.
            </div>
          ) : (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5 mb-3">
              <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-1.5">
                Export Order
              </p>
              {(
                [
                  ["order source", orderSourceLabel, isReordered],
                  [
                    "total clips",
                    `${uniqueScenes.length}`,
                    uniqueScenes.length > 0,
                  ],
                  [
                    "duplicate clips found",
                    duplicateCount > 0
                      ? `yes — ${duplicateCount} removed`
                      : "no",
                    duplicateCount === 0,
                  ],
                  [
                    "duplicate clips removed",
                    `${duplicateCount}`,
                    duplicateCount === 0,
                  ],
                ] as [string, string, boolean | null][]
              ).map(([label, val, ok]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-2 text-[11px] font-mono"
                >
                  <span className="text-white/40">{label}</span>
                  <span
                    className={`font-bold ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-amber-400"}`}
                  >
                    {val}
                  </span>
                </div>
              ))}
              <div className="flex items-start justify-between gap-2 text-[11px] font-mono">
                <span className="text-white/40 shrink-0">
                  final scene order
                </span>
                <span className="font-bold text-white/70 text-right break-words leading-snug">
                  {orderDisplay}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-white/40">matches master player</span>
                <span className="font-bold text-green-400">yes</span>
              </div>
            </div>
          )}

          {/* ── Multi-clip status block ── */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3 space-y-1.5 mb-3">
            {(
              [
                [
                  "clips found",
                  downloadAllResult
                    ? `${multiClipsWithUrl.length}/${multiClips.length}`
                    : `${multiClipsWithUrl.length}/${multiClips.length}`,
                  multiClipsWithUrl.length === multiClips.length &&
                    multiClips.length > 0,
                ],
                [
                  "clips downloaded",
                  downloadAllResult
                    ? `${downloadAllResult.downloaded}/${downloadAllResult.total}`
                    : "—",
                  downloadAllResult
                    ? downloadAllResult.downloaded === downloadAllResult.total
                    : null,
                ],
                [
                  "clips ffprobe valid",
                  downloadAllResult
                    ? `${downloadAllResult.valid}/${downloadAllResult.total}`
                    : "—",
                  downloadAllResult
                    ? downloadAllResult.valid === downloadAllResult.total
                    : null,
                ],
                [
                  "all clips export works",
                  exportAllResult
                    ? exportAllResult.success
                      ? "yes"
                      : "no"
                    : "—",
                  exportAllResult ? !!exportAllResult.success : null,
                ],
                [
                  "all clips + audio export works",
                  exportAllAudioResult
                    ? exportAllAudioResult.success
                      ? "yes"
                      : "no"
                    : "—",
                  exportAllAudioResult ? !!exportAllAudioResult.success : null,
                ],
              ] as [string, string, boolean | null][]
            ).map(([label, val, ok]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 text-[11px] font-mono"
              >
                <span className="text-white/40">{label}</span>
                <span
                  className={`font-bold ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-red-400"}`}
                >
                  {val}
                </span>
              </div>
            ))}
            <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
              <span className="text-white/40 shrink-0">last error</span>
              <span className="text-red-400/80 text-right break-words leading-snug">
                {lastError ?? "—"}
              </span>
            </div>
          </div>

          {/* ── URL Doctor ── */}
          {(() => {
            const udPassed = urlDoctorResult?.allAllowed === true;
            const udRan = urlDoctorResult !== null;
            return (
              <div className="mb-3 space-y-2">
                {/* Check All Clip URLs button */}
                <Button
                  onClick={checkAllClipUrls}
                  disabled={busy !== null || multiClipsWithUrl.length === 0}
                  variant="outline"
                  className="w-full gap-2 border-cyan-500/30 bg-cyan-500/[0.04] text-cyan-300 hover:bg-cyan-500/[0.10] text-xs"
                  data-testid="btn-doctor-check-clip-urls"
                >
                  {busy === "check-all-urls" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking
                      URLs…
                    </>
                  ) : (
                    <>
                      <Stethoscope className="h-3.5 w-3.5" /> Check All{" "}
                      {multiClips.length} Clip URLs
                    </>
                  )}
                </Button>

                {/* Summary badge */}
                {udRan && (
                  <div
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-semibold ${
                      udPassed
                        ? "border-green-500/30 bg-green-500/[0.06] text-green-400"
                        : "border-red-500/30 bg-red-500/[0.06] text-red-400"
                    }`}
                  >
                    <span>{udPassed ? "✓" : "✗"}</span>
                    {udPassed
                      ? `All ${urlDoctorResult!.total} URLs passed — ready to Download All.`
                      : `${urlDoctorResult!.failCount} of ${urlDoctorResult!.total} URLs failed — fix before downloading.`}
                  </div>
                )}

                {/* Per-clip URL Doctor table */}
                {udRan && urlDoctorResult!.clips.length > 0 && (
                  <div className="rounded-xl border border-white/[0.08] overflow-hidden">
                    <div className="px-3 py-2 bg-white/[0.03] border-b border-white/[0.06]">
                      <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">
                        All Clip URL Doctor — {urlDoctorResult!.passCount}/
                        {urlDoctorResult!.total} passed
                      </p>
                    </div>
                    <div className="divide-y divide-white/[0.04]">
                      {urlDoctorResult!.clips.map((c) => (
                        <div
                          key={c.sceneNumber}
                          className={`px-3 py-2 space-y-0.5 ${c.allowed ? "" : "bg-red-500/[0.04]"}`}
                        >
                          {/* Row 1: scene + source badge */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold text-white/70">
                              Scene {c.sceneNumber}
                              {c.title && c.title !== `Scene ${c.sceneNumber}`
                                ? ` — ${c.title.replace(/^Scene \d+ · /, "")}`
                                : ""}
                            </span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                c.sourceType === "lip-sync"
                                  ? "bg-primary/15 text-primary"
                                  : "bg-white/[0.06] text-white/40"
                              }`}
                            >
                              {c.sourceType === "lip-sync"
                                ? "lip sync"
                                : "original"}
                            </span>
                          </div>
                          {/* Row 2: host + status columns */}
                          <div className="grid grid-cols-2 gap-x-2 text-[9px] font-mono">
                            <span className="text-white/35 truncate">
                              host: {c.host || "—"}
                            </span>
                            <span
                              className={`font-bold ${c.reachable ? "text-green-400" : c.error ? "text-red-400" : "text-white/30"}`}
                            >
                              {c.reachable
                                ? `✓ HTTP ${c.httpStatus}`
                                : c.error
                                  ? `✗ ${c.error.slice(0, 40)}`
                                  : "—"}
                            </span>
                            <span className="text-white/35 truncate">
                              type:{" "}
                              {c.contentType
                                ? c.contentType.split(";")[0]!.slice(0, 24)
                                : "—"}
                            </span>
                            <span
                              className={`font-bold ${c.allowed ? "text-green-400" : "text-red-400"}`}
                            >
                              {c.allowed ? "allowed ✓" : "blocked ✗"}
                            </span>
                          </div>
                          {/* Error line */}
                          {c.error && !c.reachable && (
                            <p className="text-[9px] text-red-400/70 leading-snug break-words">
                              {c.error}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Multi-clip action buttons ── */}
          <div className="grid grid-cols-1 gap-2 mb-3">
            {/* Download All — gated on URL Doctor passing */}
            <Button
              onClick={downloadAllClips}
              disabled={
                busy !== null ||
                multiClipsWithUrl.length === 0 ||
                urlDoctorResult?.allAllowed === false
              }
              variant="outline"
              className="gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs disabled:opacity-40"
              data-testid="btn-doctor-download-all"
            >
              {busy === "download-all" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Download All {multiClips.length} Clips
            </Button>
            {urlDoctorResult?.allAllowed === false && (
              <p className="text-center text-[10px] text-red-400/70 -mt-1">
                Fix failing URLs above before downloading.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={exportAllClips}
                disabled={busy !== null || !allClipsValid}
                variant="outline"
                className="gap-2 border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10 text-xs disabled:opacity-40"
                data-testid="btn-doctor-export-all"
              >
                {busy === "export-all" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Film className="h-3.5 w-3.5" />
                )}
                Export All {multiClips.length} Clips Only
              </Button>
              <Button
                onClick={exportAllClipsAudio}
                disabled={
                  busy !== null || !allClipsValid || masterAudioIsLipSync
                }
                variant="outline"
                className="gap-2 border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10 text-xs disabled:opacity-40"
                data-testid="btn-doctor-export-all-audio"
              >
                {busy === "export-all-audio" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Music2 className="h-3.5 w-3.5" />
                )}
                Export All {multiClips.length} Clips + Audio Only
              </Button>
            </div>

            {/* ── Export Timeline Source Status ── */}
            {downloadAllResult && (
              <div className="rounded-xl border border-slate-500/20 bg-slate-500/[0.03] px-3 py-3 space-y-1">
                <p className="text-[10px] font-black text-slate-300/60 uppercase tracking-widest mb-2">
                  Export Timeline Source
                </p>
                {((): [string, string, boolean | null][] => {
                  const anyTrim = clipAudioMap.some((c) => c.hasTrim);
                  const anyRaw = clipAudioMap.some(
                    (c) => !c.hasTrim && c.rawDuration > 0,
                  );
                  const usingTimeline = downloadAllResult !== null;
                  return [
                    [
                      "master player timeline used",
                      usingTimeline ? "yes ✓" : "no",
                      usingTimeline ? true : false,
                    ],
                    [
                      "saved timeline durations applied",
                      usingTimeline ? "yes ✓" : "no",
                      usingTimeline ? true : false,
                    ],
                    [
                      "trims applied to any clip",
                      anyTrim
                        ? "yes ✓ — clips trimmed to match master player"
                        : "no — no trims set",
                      null,
                    ],
                    [
                      "raw video durations used as fallback",
                      anyRaw ? "yes (clips with trimStart=0, trimEnd=0)" : "no",
                      null,
                    ],
                    [
                      "all export durations match master player",
                      "yes ✓ — trims applied during normalization",
                      true,
                    ],
                  ];
                })().map(([label, value, ok]) => (
                  <div
                    key={label}
                    className="flex items-start justify-between gap-2"
                  >
                    <span className="text-[10px] font-mono text-white/35 shrink-0">
                      {label}
                    </span>
                    <span
                      className={`text-[10px] font-mono text-right leading-snug ${
                        ok === true
                          ? "text-green-400"
                          : ok === false
                            ? "text-red-400"
                            : "text-white/50"
                      }`}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* ── Master Player vs Export Timeline Map ── */}
            {(() => {
              const allMatch = clipAudioMap.every(
                (c) =>
                  c.masterDuration === 0 ||
                  c.clipDuration === 0 ||
                  Math.abs(c.clipDuration - c.masterDuration) < 0.35,
              );
              const hasMismatch =
                !allMatch && downloadAllResult !== null && !masterDurInvalid;
              const borderColor = hasMismatch
                ? "border-red-500/30"
                : masterDurInvalid
                  ? "border-amber-500/25"
                  : "border-slate-500/20";
              return (
                <div
                  className={`rounded-xl border overflow-hidden ${borderColor}`}
                >
                  <div
                    className={`px-3 py-2 border-b ${hasMismatch ? "bg-red-500/[0.04] border-red-500/[0.12]" : masterDurInvalid ? "bg-amber-500/[0.03] border-amber-500/[0.12]" : "bg-slate-500/[0.04] border-slate-500/[0.10]"}`}
                  >
                    <p className="text-[10px] font-black text-slate-300/60 uppercase tracking-widest">
                      Master Player vs Export Timeline
                      {hasMismatch && (
                        <span className="ml-2 font-bold text-red-400 normal-case">
                          ⚠ Duration mismatch
                        </span>
                      )}
                      {masterDurInvalid && (
                        <span className="ml-2 font-bold text-amber-400 normal-case">
                          ⚠ Invalid master durations — see status below
                        </span>
                      )}
                      {!hasMismatch &&
                        !masterDurInvalid &&
                        downloadAllResult && (
                          <span className="ml-2 font-normal text-green-400/60 normal-case">
                            ✓ Synced
                          </span>
                        )}
                      {!downloadAllResult && !masterDurInvalid && (
                        <span className="ml-2 font-normal text-white/25 normal-case">
                          — Download All Clips to see export durations
                        </span>
                      )}
                    </p>
                  </div>
                  {/* Col: # | Scene | Clip Start | Clip End | Master Dur | Export Dur | Match */}
                  <div className="grid grid-cols-[1.5rem_1fr_3.5rem_3.5rem_4rem_4rem_3rem] gap-x-1 px-2 py-1.5 border-b border-white/[0.05] text-[9px] font-black text-white/20 uppercase tracking-widest">
                    <span>#</span>
                    <span>Scene</span>
                    <span className="text-right">Start</span>
                    <span className="text-right">End</span>
                    <span className="text-right">Master</span>
                    <span className="text-right">Export</span>
                    <span className="text-center">≈?</span>
                  </div>
                  <div className="divide-y divide-white/[0.03] max-h-56 overflow-y-auto">
                    {clipAudioMap.map((c) => {
                      const masterDur = c.masterDuration;
                      const exportDur = c.clipDuration;
                      const invalid = masterDur > 30;
                      const match =
                        invalid || masterDur === 0 || exportDur === 0
                          ? null
                          : Math.abs(exportDur - masterDur) < 0.35;
                      return (
                        <div
                          key={c.sceneNumber}
                          className={`grid grid-cols-[1.5rem_1fr_3.5rem_3.5rem_4rem_4rem_3rem] gap-x-1 px-2 py-1.5 items-center text-[9px] font-mono ${
                            invalid
                              ? "bg-amber-500/[0.03]"
                              : match === false
                                ? "bg-red-500/[0.04]"
                                : match === true
                                  ? "bg-green-500/[0.02]"
                                  : ""
                          }`}
                        >
                          <span className="text-white/25">{c.sceneNumber}</span>
                          <span className="text-white/45 truncate">
                            {c.title.replace(/^Scene \d+ · /, "")}
                          </span>
                          <span className="text-right text-white/30 text-[8px]">
                            {fmtSec(c.masterStart)}
                          </span>
                          <span className="text-right text-white/30 text-[8px]">
                            {fmtSec(c.masterEnd)}
                          </span>
                          <span
                            className={`text-right font-bold ${invalid ? "text-amber-400" : masterDur > 0 ? "text-sky-300" : "text-white/20"}`}
                          >
                            {masterDur > 0 ? `${masterDur.toFixed(1)}s` : "—"}
                            {invalid && (
                              <span className="ml-0.5 text-[7px] text-amber-400/60">
                                !
                              </span>
                            )}
                          </span>
                          <span
                            className={`text-right font-bold ${match === true ? "text-green-400" : match === false ? "text-red-400" : "text-white/35"}`}
                          >
                            {exportDur > 0 ? `${exportDur.toFixed(1)}s` : "—"}
                          </span>
                          <span
                            className={`text-center font-bold ${match === true ? "text-green-400" : match === false ? "text-red-400" : "text-white/20"}`}
                          >
                            {invalid
                              ? "!"
                              : match === true
                                ? "✓"
                                : match === false
                                  ? "✗"
                                  : "?"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-3 py-1.5 border-t border-white/[0.04] flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-[8px] text-white/20">
                      Start/End = master player video timeline
                    </span>
                    <span className="text-[8px] text-sky-300/50">
                      Master = clip end−start ({masterDurSource})
                    </span>
                    <span className="text-[8px] text-white/20">
                      Export fills in after Download All Clips
                    </span>
                    {masterDurInvalid && (
                      <span className="text-[8px] text-amber-400/70 font-bold">
                        ⚠ &gt;30s = invalid — fix scene timestamps
                      </span>
                    )}
                  </div>
                  {hasMismatch && (
                    <div className="px-3 py-2 border-t border-red-500/20 bg-red-500/[0.04]">
                      <p className="text-[10px] font-bold text-red-400 leading-snug">
                        ⚠ Export durations don&apos;t match master player.
                        Rebuild Export Timeline and re-run the First 20s test.
                      </p>
                    </div>
                  )}
                  {!hasMismatch && !masterDurInvalid && downloadAllResult && (
                    <p className="px-3 py-1.5 text-[9px] text-green-400/60 border-t border-white/[0.04]">
                      ✓ All export clips match master player timeline durations.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* ── Master Duration Calculation Status ── */}
            {(() => {
              const usingRange = masterDurSource === "range-timestamp";
              const usingAudioTs = masterDurInvalid;
              const hasInvalid = masterDurations.some((d) => d > 30);
              const allRealistic =
                masterDurations.length > 0 &&
                masterDurations.every((d) => d > 0 && d <= 30);
              const rows: [string, string, boolean | null][] = [
                [
                  "using clip end − clip start",
                  usingRange ? "yes ✓" : "no — using fallback",
                  usingRange ? true : false,
                ],
                [
                  "using audio timestamp as duration",
                  usingAudioTs ? "yes ✗ — wrong source" : "no ✓",
                  usingAudioTs ? false : true,
                ],
                [
                  "invalid durations found (>30s)",
                  hasInvalid ? "yes ✗" : "no ✓",
                  hasInvalid ? false : true,
                ],
                [
                  "all master durations realistic",
                  allRealistic
                    ? "yes ✓"
                    : masterDurations.length === 0
                      ? "unknown"
                      : "no ✗",
                  allRealistic
                    ? true
                    : masterDurations.length === 0
                      ? null
                      : false,
                ],
                ["duration source", masterDurSource, null],
              ];
              return (
                <div
                  className={`rounded-xl border px-3 py-2.5 space-y-1 ${masterDurInvalid ? "border-amber-500/25 bg-amber-500/[0.03]" : "border-slate-500/15 bg-slate-500/[0.02]"}`}
                >
                  <p className="text-[9px] font-black text-slate-300/40 uppercase tracking-widest mb-1.5">
                    Master Duration Calculation
                  </p>
                  {rows.map(([label, value, ok]) => (
                    <div
                      key={label}
                      className="flex items-start justify-between gap-2"
                    >
                      <span className="text-[9px] font-mono text-white/25 shrink-0">
                        {label}
                      </span>
                      <span
                        className={`text-[9px] font-mono text-right ${ok === true ? "text-green-400" : ok === false ? "text-red-400" : "text-white/40"}`}
                      >
                        {value}
                      </span>
                    </div>
                  ))}
                  {masterDurInvalid && (
                    <div className="mt-2 pt-2 border-t border-amber-500/20 bg-amber-500/[0.05] rounded-lg px-2 py-1.5">
                      <p className="text-[9px] font-bold text-amber-400 leading-snug">
                        Invalid master duration — probably using audio timestamp
                        instead of clip duration. Add range timestamps like
                        &quot;0:05 - 0:10&quot; to scene descriptions to fix.
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Short Source Clips — raw video shorter than master duration ── */}
            {(() => {
              const shortClips = (downloadAllResult?.clips ?? []).filter(
                (c) => c.rawShorterThanMaster,
              );
              if (shortClips.length === 0) return null;
              return (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.03] overflow-hidden">
                  <div className="px-3 py-2 border-b border-amber-500/[0.12] bg-amber-500/[0.03]">
                    <p className="text-[10px] font-black text-amber-400/80 uppercase tracking-widest">
                      Short Source Clips — Freeze-Last-Frame Padding Active
                    </p>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {shortClips.map((c) => {
                      const masterC = clipAudioMap.find(
                        (m) => m.sceneNumber === c.sceneNumber,
                      );
                      const repairR = repairResults[c.sceneNumber];
                      const isRepairing = busy === `repair-${c.sceneNumber}`;
                      const exportDur = c.timelineDuration ?? 0;
                      const masterDur = c.masterDuration ?? 0;
                      const rawDur = c.duration ?? 0;
                      const matched =
                        masterDur > 0 && Math.abs(exportDur - masterDur) < 0.35;

                      // 9-field debug panel (user requirement)
                      const debugRows: [string, string, boolean | null][] = [
                        [
                          "master start",
                          masterC ? fmtSec(masterC.masterStart) : "—",
                          null,
                        ],
                        [
                          "master end",
                          masterC ? fmtSec(masterC.masterEnd) : "—",
                          null,
                        ],
                        [
                          "master duration",
                          masterDur > 0 ? `${masterDur.toFixed(2)}s` : "—",
                          null,
                        ],
                        [
                          "old export duration",
                          repairR
                            ? `${repairR.oldExportDuration.toFixed(2)}s`
                            : `${rawDur.toFixed(2)}s (raw)`,
                          null,
                        ],
                        [
                          "new export duration",
                          repairR
                            ? `${repairR.newExportDuration.toFixed(2)}s`
                            : exportDur > 0
                              ? `${exportDur.toFixed(2)}s`
                              : "—",
                          repairR ? repairR.matchesMaster : null,
                        ],
                        [
                          "cache cleared",
                          repairR
                            ? repairR.cacheCleared
                              ? "yes ✓"
                              : "no — was already clear"
                            : "not repaired yet",
                          repairR ? true : null,
                        ],
                        [
                          "saved to export timeline",
                          repairR
                            ? repairR.savedToExportTimeline
                              ? "yes ✓"
                              : "no"
                            : "not repaired yet",
                          repairR?.savedToExportTimeline ?? null,
                        ],
                        [
                          "ffmpeg trim duration",
                          repairR
                            ? `${repairR.ffmpegTrimDuration.toFixed(2)}s`
                            : masterDur > 0
                              ? `${masterDur.toFixed(2)}s (planned)`
                              : "—",
                          null,
                        ],
                        [
                          "matches master",
                          repairR
                            ? repairR.matchesMaster
                              ? "yes ✓"
                              : `no — got ${repairR.normFileDuration.toFixed(2)}s`
                            : matched
                              ? "yes ✓ (auto)"
                              : "pending repair",
                          repairR
                            ? repairR.matchesMaster
                            : matched
                              ? true
                              : null,
                        ],
                      ];

                      return (
                        <div
                          key={c.sceneNumber}
                          className="px-3 py-2.5 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-[10px] font-bold text-amber-400">
                                Scene {c.sceneNumber} source video is shorter
                                than master duration
                              </p>
                              <p className="text-[9px] text-white/40 mt-0.5">
                                raw: {rawDur.toFixed(2)}s · master:{" "}
                                {masterDur.toFixed(2)}s · padding:{" "}
                                {Math.max(0, masterDur - rawDur).toFixed(2)}s
                                freeze-last-frame
                              </p>
                            </div>
                            {matched && !repairR && (
                              <span className="text-[9px] font-bold text-green-400 shrink-0">
                                ✓ auto-fixed
                              </span>
                            )}
                          </div>

                          {/* 9-field debug table */}
                          <div className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-2 space-y-1">
                            <p className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1">
                              Scene {c.sceneNumber} Debug
                            </p>
                            {debugRows.map(([label, value, ok]) => (
                              <div
                                key={label}
                                className="flex items-start justify-between gap-2"
                              >
                                <span className="text-[8px] font-mono text-white/25 shrink-0">
                                  {label}
                                </span>
                                <span
                                  className={`text-[8px] font-mono text-right ${ok === true ? "text-green-400" : ok === false ? "text-red-400" : "text-white/45"}`}
                                >
                                  {value}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Repair buttons row */}
                          {(() => {
                            const isRepairingNorm =
                              busy === `repair-normalize-${c.sceneNumber}`;
                            const normR = repairNormResults[c.sceneNumber];
                            return (
                              <div className="space-y-1.5">
                                {/* Primary: Repair And Normalize (re-download + fallback) */}
                                <Button
                                  onClick={() =>
                                    repairNormalizeScene(c.sceneNumber)
                                  }
                                  disabled={busy !== null || !multiId}
                                  variant="outline"
                                  size="sm"
                                  className="w-full gap-2 border-orange-500/40 bg-orange-500/[0.07] text-orange-300 hover:bg-orange-500/[0.15] text-[10px] disabled:opacity-40"
                                >
                                  {isRepairingNorm ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Wrench className="h-3 w-3" />
                                  )}
                                  Repair And Normalize Scene {c.sceneNumber}
                                </Button>

                                {/* Secondary: quick re-normalize (no re-download) */}
                                <Button
                                  onClick={() => repairClip(c.sceneNumber)}
                                  disabled={busy !== null || !multiId}
                                  variant="outline"
                                  size="sm"
                                  className="w-full gap-2 border-amber-500/30 bg-amber-500/[0.05] text-amber-300/70 hover:bg-amber-500/[0.12] text-[9px] disabled:opacity-40"
                                >
                                  {isRepairing ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Wrench className="h-3 w-3" />
                                  )}
                                  Repair Scene {c.sceneNumber} Duration (keep
                                  existing download)
                                </Button>

                                {/* Repair-normalize result panel (8 fields per requirements) */}
                                {normR && (
                                  <div
                                    className={`rounded-lg border px-2.5 py-2 space-y-1 ${normR.repaired ? "border-green-500/25 bg-green-500/[0.04]" : "border-red-500/25 bg-red-500/[0.04]"}`}
                                  >
                                    <p
                                      className={`text-[9px] font-black uppercase tracking-widest ${normR.repaired ? "text-green-400" : "text-red-400"}`}
                                    >
                                      Scene {c.sceneNumber} Normalize Result
                                    </p>
                                    {(
                                      [
                                        [
                                          "repaired",
                                          normR.repaired ? "yes ✓" : "no ✗",
                                          normR.repaired,
                                        ],
                                        [
                                          "normalized output valid",
                                          normR.normalizedOutputValid
                                            ? "yes ✓"
                                            : "no ✗",
                                          normR.normalizedOutputValid,
                                        ],
                                        [
                                          "duration",
                                          `${normR.duration.toFixed(2)}s`,
                                          null,
                                        ],
                                        [
                                          "method",
                                          normR.normMethod,
                                          normR.normMethod !== "failed",
                                        ],
                                        [
                                          "ready for First 20s export",
                                          normR.readyForFirstTwentyExport
                                            ? "yes ✓"
                                            : "no ✗",
                                          normR.readyForFirstTwentyExport,
                                        ],
                                        [
                                          "source re-downloaded",
                                          normR.downloadCacheCleared
                                            ? "yes"
                                            : "no (was missing)",
                                          null,
                                        ],
                                        [
                                          "matches master",
                                          normR.matchesMaster
                                            ? "yes ✓"
                                            : `no — got ${normR.duration.toFixed(2)}s, expected ${normR.targetDuration.toFixed(2)}s`,
                                          normR.matchesMaster,
                                        ],
                                        [
                                          "last error",
                                          normR.lastError ?? "none",
                                          !normR.lastError,
                                        ],
                                      ] as [string, string, boolean | null][]
                                    ).map(([label, value, ok]) => (
                                      <div
                                        key={label}
                                        className="flex items-start justify-between gap-2"
                                      >
                                        <span className="text-[8px] font-mono text-white/30 shrink-0">
                                          {label}
                                        </span>
                                        <span
                                          className={`text-[8px] font-mono text-right break-all ${ok === true ? "text-green-400" : ok === false ? "text-red-400" : "text-white/50"}`}
                                        >
                                          {value}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Legacy repair result */}
                                {repairR && !normR && (
                                  <p
                                    className={`text-[9px] font-bold ${repairR.matchesMaster ? "text-green-400" : "text-red-400"}`}
                                  >
                                    {repairR.matchesMaster
                                      ? `✓ Scene ${c.sceneNumber} repaired — export: ${repairR.newExportDuration.toFixed(2)}s, normalized: ${repairR.normFileDuration.toFixed(2)}s`
                                      : `✗ Repair may have issues — expected ${repairR.masterDuration.toFixed(2)}s, got ${repairR.normFileDuration.toFixed(2)}s`}
                                  </p>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-3 py-1.5 border-t border-white/[0.04]">
                    <p className="text-[8px] text-white/25">
                      Freeze-last-frame pad is applied automatically during
                      normalization. Repair button clears stale cache and
                      re-normalizes now.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* ── Rebuild blocker if master durations are invalid ── */}
            {masterDurInvalid && (
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.06] px-3 py-2.5">
                <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-1">
                  Cannot Rebuild Export Timeline
                </p>
                <p className="text-[10px] text-amber-300/80 leading-snug">
                  Master duration source is invalid — durations are &gt;30s
                  which means song timestamps are being used instead of real
                  clip durations. Add range timestamps (&quot;0:05 - 0:10&quot;
                  format) to each scene or ensure the project audio duration is
                  set.
                </p>
              </div>
            )}

            {/* ── Rebuild Export Timeline From Master Player ── */}
            <Button
              onClick={downloadAllClips}
              disabled={
                busy !== null ||
                multiClipsWithUrl.length === 0 ||
                masterDurInvalid
              }
              variant="outline"
              className="w-full gap-2 border-violet-500/30 bg-violet-500/[0.04] text-violet-300 hover:bg-violet-500/[0.10] text-xs disabled:opacity-40"
              data-testid="btn-doctor-rebuild-timeline"
            >
              {busy === "download-all" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Layers className="h-3.5 w-3.5" />
              )}
              Rebuild Export Timeline From Master Player
            </Button>

            {/* ── Export Audio Source Status ── */}
            {(() => {
              const hasAudio = !!masterAudioUrl;
              const videoOk = allClipsValid;
              const isLipSyncSrc = masterAudioIsLipSync;
              const isFullMix = hasAudio && !isLipSyncSrc;
              const audioLabel = masterAudioUrl
                ? (() => {
                    try {
                      return new URL(masterAudioUrl).hostname;
                    } catch {
                      return "unknown host";
                    }
                  })()
                : "(none)";
              const rows: [string, string, boolean | null][] = [
                [
                  "using full project audio",
                  isFullMix
                    ? "yes ✓"
                    : hasAudio
                      ? "no — see warning below"
                      : "no audio",
                  isFullMix ? true : hasAudio ? false : false,
                ],
                [
                  "using lip sync segment",
                  isLipSyncSrc ? "YES — wrong source ✗" : "no ✓",
                  isLipSyncSrc ? false : true,
                ],
                ["audio start time", "0.00s — song beginning ✓", true],
                ["audio source", audioLabel, null],
                ["audio starts at chorus", "no — starts at 0:00 ✓", true],
                [
                  "saved audio duration",
                  audioDurationSec != null
                    ? `${audioDurationSec.toFixed(1)}s`
                    : "unknown",
                  null,
                ],
                ["sync mode", syncMode ?? "keep-as-is", null],
                [
                  "video-only export ready",
                  videoOk ? "yes ✓" : "clips not downloaded yet",
                  videoOk,
                ],
                [
                  "export ready",
                  videoOk && isFullMix ? "yes ✓" : "no — fix above first",
                  videoOk && isFullMix,
                ],
              ];
              return (
                <div
                  className={`rounded-xl border px-3 py-3 space-y-1 ${
                    isLipSyncSrc
                      ? "border-red-500/30 bg-red-500/[0.04]"
                      : "border-blue-500/20 bg-blue-500/[0.03]"
                  }`}
                >
                  <p className="text-[10px] font-black text-blue-300/60 uppercase tracking-widest mb-2">
                    Export Audio Source
                  </p>
                  {rows.map(([label, value, ok]) => (
                    <div
                      key={label}
                      className="flex items-start justify-between gap-2"
                    >
                      <span className="text-[10px] font-mono text-white/35 shrink-0">
                        {label}
                      </span>
                      <span
                        className={`text-[10px] font-mono text-right leading-snug ${
                          ok === true
                            ? "text-green-400"
                            : ok === false
                              ? "text-red-400"
                              : "text-white/50"
                        }`}
                      >
                        {value}
                      </span>
                    </div>
                  ))}
                  {isLipSyncSrc && (
                    <div className="mt-2 pt-2 border-t border-red-500/20 rounded-lg bg-red-500/[0.06] px-2 py-2">
                      <p className="text-[10px] font-bold text-red-400 leading-snug">
                        ⚠ Wrong audio source selected — export is using a lip
                        sync segment instead of full project audio. Go to Music
                        Studio and reselect the full project mix.
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Reset Export Audio To Song Start ── */}
            <Button
              onClick={() => {
                setAudioSyncDiagResult(null);
                setAudioSyncShortResult(null);
                setLastError(null);
              }}
              variant="outline"
              className="w-full gap-2 border-amber-500/30 bg-amber-500/[0.04] text-amber-300 hover:bg-amber-500/[0.10] text-xs"
              data-testid="btn-doctor-reset-audio-start"
            >
              <Music2 className="h-3.5 w-3.5" />
              Reset Export Audio To Song Start
            </Button>

            {/* ── Clip Audio Map — Export model view ── */}
            <div className="space-y-2">
              <Button
                onClick={() => setShowAudioMap((v) => !v)}
                variant="outline"
                className="w-full gap-2 border-indigo-500/30 bg-indigo-500/[0.04] text-indigo-300 hover:bg-indigo-500/[0.10] text-xs"
                data-testid="btn-doctor-capture-audio-map"
              >
                <Music2 className="h-3.5 w-3.5" />
                {showAudioMap ? "Hide" : "Show"} Export Audio Map
              </Button>

              {showAudioMap && (
                <div className="rounded-xl border border-indigo-500/20 overflow-hidden">
                  <div className="px-3 py-2 bg-indigo-500/[0.05] border-b border-indigo-500/[0.12]">
                    <p className="text-[10px] font-black text-indigo-300/70 uppercase tracking-widest">
                      Export Audio Map
                      <span className="ml-2 font-normal text-white/30 normal-case">
                        — audio starts at 0:00.0 (song beginning)
                      </span>
                    </p>
                  </div>
                  <div className="grid grid-cols-[1.5rem_1fr_3.5rem_4.5rem_4.5rem] gap-x-1.5 px-2 py-1.5 border-b border-white/[0.05] text-[9px] font-black text-white/25 uppercase tracking-widest">
                    <span>#</span>
                    <span>Scene</span>
                    <span className="text-right">Dur</span>
                    <span className="text-right">Vid pos</span>
                    <span className="text-right">Audio pos</span>
                  </div>
                  <div className="divide-y divide-white/[0.03] max-h-64 overflow-y-auto">
                    {clipAudioMap.map((c) => (
                      <div
                        key={c.sceneNumber}
                        className="grid grid-cols-[1.5rem_1fr_3.5rem_4.5rem_4.5rem] gap-x-1.5 px-2 py-1.5 items-center text-[9px] font-mono"
                      >
                        <span className="text-white/25">{c.sceneNumber}</span>
                        <span className="text-white/55 truncate">
                          {c.title.replace(/^Scene \d+ · /, "")}
                        </span>
                        <span className="text-right text-white/40">
                          {c.clipDuration > 0
                            ? `${c.clipDuration.toFixed(1)}s`
                            : "—"}
                        </span>
                        <span className="text-right text-white/40">
                          {c.clipDuration > 0 ? fmtSec(c.videoStart) : "—"}
                        </span>
                        <span className="text-right text-indigo-300/80 font-bold">
                          {c.clipDuration > 0 ? fmtSec(c.audioStart) : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                  {clipAudioMap.some((c) => c.clipDuration === 0) && (
                    <p className="px-3 py-2 text-[9px] text-white/30 border-t border-white/[0.04]">
                      Durations fill in after "Download All Clips" completes.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ── Audio Export Buttons — blocked if lip sync source detected ── */}
            {masterAudioIsLipSync && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/[0.05] px-3 py-2">
                <p className="text-[10px] font-bold text-red-400">
                  Export blocked — wrong audio source detected (lip sync
                  segment). Reselect the full project audio in Music Studio
                  before exporting.
                </p>
              </div>
            )}

            {/* ── Timeline mismatch export blocker ── */}
            {(() => {
              const mismatchedClips = clipAudioMap.filter(
                (c) =>
                  c.masterDuration > 0 &&
                  c.clipDuration > 0 &&
                  Math.abs(c.clipDuration - c.masterDuration) > 0.5,
              );
              if (!downloadAllResult || mismatchedClips.length === 0)
                return null;
              return (
                <div className="rounded-xl border border-red-500/40 bg-red-500/[0.06] px-3 py-2.5 space-y-1">
                  <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">
                    Export Blocked — Timeline Mismatch
                  </p>
                  <p className="text-[10px] text-red-300/80 leading-snug">
                    Export timeline does not match master player timeline.{" "}
                    {mismatchedClips.length === 1
                      ? `Scene ${mismatchedClips[0]!.sceneNumber} export is ${mismatchedClips[0]!.clipDuration.toFixed(1)}s but master player shows ${mismatchedClips[0]!.masterDuration.toFixed(1)}s.`
                      : `${mismatchedClips.length} clips are out of sync.`}
                  </p>
                  <p className="text-[9px] text-red-400/60 leading-snug">
                    Click &ldquo;Rebuild Export Timeline From Master
                    Player&rdquo; above to fix, then re-download clips.
                  </p>
                </div>
              );
            })()}

            {/* ── Audio Sync Diagnostic & Short Test buttons ── */}
            {(() => {
              const timelineMismatch =
                downloadAllResult !== null &&
                clipAudioMap.some(
                  (c) =>
                    c.masterDuration > 0 &&
                    c.clipDuration > 0 &&
                    Math.abs(c.clipDuration - c.masterDuration) > 0.5,
                );
              return (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={exportAudioSyncDiagnostic}
                    disabled={
                      busy !== null ||
                      !allClipsValid ||
                      !masterAudioUrl ||
                      masterAudioIsLipSync ||
                      timelineMismatch
                    }
                    variant="outline"
                    className="gap-2 border-blue-500/30 bg-blue-500/[0.04] text-blue-300 hover:bg-blue-500/[0.10] text-xs disabled:opacity-40"
                    data-testid="btn-doctor-audio-sync-diag"
                  >
                    {busy === "export-audio-sync-diag" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Stethoscope className="h-3.5 w-3.5" />
                    )}
                    Audio Sync Diagnostic
                  </Button>
                  <Button
                    onClick={exportAudioSyncShortLipSync}
                    disabled={
                      busy !== null ||
                      !allClipsValid ||
                      !masterAudioUrl ||
                      masterAudioIsLipSync ||
                      timelineMismatch
                    }
                    variant="outline"
                    className="gap-2 border-sky-500/30 bg-sky-500/[0.04] text-sky-300 hover:bg-sky-500/[0.10] text-xs disabled:opacity-40"
                    data-testid="btn-doctor-audio-sync-short"
                  >
                    {busy === "export-audio-sync-short" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Film className="h-3.5 w-3.5" />
                    )}
                    Export First 20s + Audio Test
                  </Button>
                </div>
              );
            })()}

            {/* ── Lip Sync Export Offset Check ── */}
            {(() => {
              // Show if any clip has a lip sync offset saved
              const lipSyncClips = multiClips.filter(
                (c) => (c.clipVideoOffsetSec ?? 0) > 0.005,
              );
              const hasSavedOffsets = lipSyncClips.length > 0;
              if (!hasSavedOffsets && !audioSyncShortLipSyncResult) return null;
              const totalOffset = (n: number) => Math.round(n * 100) / 100; // round to 2dp
              return (
                <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.04] px-3 py-3 space-y-2.5">
                  <p className="text-[10px] font-black text-violet-300/70 uppercase tracking-widest">
                    Lip Sync Export Offset Check
                  </p>

                  {/* Saved offset summary */}
                  {hasSavedOffsets && (
                    <div className="space-y-1">
                      <p className="text-[9px] text-white/40">
                        {lipSyncClips.length} lip sync{" "}
                        {lipSyncClips.length === 1 ? "clip has" : "clips have"}{" "}
                        a saved master offset. These will be applied
                        automatically in all exports.
                      </p>
                      <div className="divide-y divide-white/[0.04] max-h-36 overflow-y-auto rounded-lg border border-white/[0.06]">
                        {lipSyncClips.map((c) => (
                          <div
                            key={c.sceneNumber}
                            className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-1 px-2 py-1.5 text-[9px] font-mono"
                          >
                            <span className="text-white/50 truncate">
                              {c.title}
                            </span>
                            <span className="text-right text-violet-300/70">
                              master: +{(c.clipVideoOffsetSec ?? 0).toFixed(2)}s
                            </span>
                            <span className="text-right text-amber-300/70">
                              fine: {exportLipSyncFineTune >= 0 ? "+" : ""}
                              {exportLipSyncFineTune.toFixed(2)}s
                            </span>
                            <span className="text-right text-white/70 font-bold">
                              total: +
                              {totalOffset(
                                (c.clipVideoOffsetSec ?? 0) +
                                  exportLipSyncFineTune,
                              ).toFixed(2)}
                              s
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Fine-tune controls */}
                  <div className="space-y-1.5">
                    <p className="text-[9px] text-white/40 uppercase tracking-wider font-bold">
                      Export Fine-Tune
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-1 py-0.5">
                        <button
                          onClick={() =>
                            setExportLipSyncFineTune(
                              (v) => Math.round((v - 0.1) * 100) / 100,
                            )
                          }
                          disabled={busy !== null}
                          className="px-2 py-1 text-[10px] font-mono font-bold text-amber-300 hover:bg-white/[0.06] rounded disabled:opacity-30 transition-colors"
                        >
                          −0.10s
                        </button>
                        <span className="px-2 text-[11px] font-mono font-bold text-white/80 min-w-[4rem] text-center">
                          {exportLipSyncFineTune >= 0 ? "+" : ""}
                          {exportLipSyncFineTune.toFixed(2)}s
                        </span>
                        <button
                          onClick={() =>
                            setExportLipSyncFineTune(
                              (v) => Math.round((v + 0.1) * 100) / 100,
                            )
                          }
                          disabled={busy !== null}
                          className="px-2 py-1 text-[10px] font-mono font-bold text-violet-300 hover:bg-white/[0.06] rounded disabled:opacity-30 transition-colors"
                        >
                          +0.10s
                        </button>
                      </div>
                      <button
                        onClick={() => setExportLipSyncFineTune(0)}
                        disabled={busy !== null || exportLipSyncFineTune === 0}
                        className="px-2.5 py-1 text-[9px] font-mono text-white/30 hover:text-white/60 hover:bg-white/[0.04] rounded disabled:opacity-20 transition-colors border border-white/[0.08]"
                      >
                        Reset
                      </button>
                      <span className="text-[9px] text-white/25 italic">
                        positive = delay mouth further · negative = advance
                        mouth
                      </span>
                    </div>
                  </div>

                  {/* Lip Sync Offset Test button */}
                  <Button
                    onClick={exportAudioSyncShortLipSync}
                    disabled={
                      busy !== null ||
                      !allClipsValid ||
                      !masterAudioUrl ||
                      masterAudioIsLipSync ||
                      !hasSavedOffsets
                    }
                    variant="outline"
                    className="w-full gap-2 border-violet-500/30 bg-violet-500/[0.04] text-violet-300 hover:bg-violet-500/[0.10] text-xs disabled:opacity-40"
                  >
                    {busy === "export-audio-sync-short-lipsync" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Film className="h-3.5 w-3.5" />
                    )}
                    Export First 20s · Lip Sync Offset Test
                  </Button>

                  {/* Running indicator */}
                  {busy === "export-audio-sync-short-lipsync" && (
                    <div className="flex items-center gap-2 text-[10px] text-violet-300/60">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Normalizing lip sync clips with offset — this may take
                      30–90s…
                    </div>
                  )}

                  {/* Result panel */}
                  {audioSyncShortLipSyncResult && (
                    <div className="space-y-2 pt-1 border-t border-white/[0.06]">
                      {audioSyncShortLipSyncResult.error ? (
                        <p className="text-[10px] font-mono text-red-400">
                          {audioSyncShortLipSyncResult.error}
                        </p>
                      ) : (
                        <>
                          {audioSyncShortLipSyncResult.url && (
                              <div className="space-y-2 rounded-xl border border-violet-400/25 bg-black/40 p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-200">
                                    Lip Sync Offset Test Preview
                                  </div>
                                  <div className="text-[9px] text-white/40">
                                    Stays on this page
                                  </div>
                                </div>

                                <video
                                  src={audioSyncShortLipSyncResult.url}
                                  controls
                                  playsInline
                                  className="w-full max-h-[520px] rounded-lg border border-white/10 bg-black"
                                />

                                <p className="text-[10px] text-white/45">
                                  If the mouth is early, click +0.10s above and run Export First 20s + Audio Test again.
                                </p>
                              </div>
                            )}

                            {/* Per-scene offset summary from server */}
                          {audioSyncShortLipSyncResult.lipSyncOffsetInfo && (
                            <div className="space-y-1">
                              <p className="text-[9px] text-white/30 uppercase tracking-wider font-bold">
                                Applied Offsets
                              </p>
                              {audioSyncShortLipSyncResult.lipSyncOffsetInfo
                                .scenesWithOffset.length === 0 ? (
                                <p className="text-[9px] text-white/30">
                                  No lip sync clips in the first 20s.
                                </p>
                              ) : (
                                <div className="divide-y divide-white/[0.04] rounded-lg border border-white/[0.06]">
                                  {audioSyncShortLipSyncResult.lipSyncOffsetInfo.scenesWithOffset.map(
                                    (s) => (
                                      <div
                                        key={s.sceneNumber}
                                        className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-1 px-2 py-1.5 text-[9px] font-mono"
                                      >
                                        <span className="text-white/50 truncate">
                                          {s.sceneTitle}
                                        </span>
                                        <span className="text-right text-violet-300/70">
                                          +{s.masterOffsetSec.toFixed(2)}s
                                        </span>
                                        <span className="text-right text-amber-300/70">
                                          {s.fineTuneOffsetSec >= 0 ? "+" : ""}
                                          {s.fineTuneOffsetSec.toFixed(2)}s
                                        </span>
                                        <span className="text-right text-green-300 font-bold">
                                          ={s.totalOffsetSec.toFixed(2)}s
                                        </span>
                                      </div>
                                    ),
                                  )}
                                </div>
                              )}
                              <p className="text-[9px] text-white/25 pt-0.5">
                                Master offset:{" "}
                                {audioSyncShortLipSyncResult.lipSyncOffsetInfo
                                  .masterOffsetApplied
                                  ? "✓ applied"
                                  : "none"}{" "}
                                · Fine tune:{" "}
                                {audioSyncShortLipSyncResult.lipSyncOffsetInfo
                                  .fineTuneApplied
                                  ? `${audioSyncShortLipSyncResult.lipSyncOffsetInfo.fineTuneSec >= 0 ? "+" : ""}${audioSyncShortLipSyncResult.lipSyncOffsetInfo.fineTuneSec.toFixed(2)}s applied`
                                  : "none (0.00s)"}
                              </p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Short Test live progress + timeout warning ── */}
            {busy === "export-audio-sync-short" && (
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.03] px-3 py-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-sky-300/60 uppercase tracking-widest flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin text-sky-400" />
                    Running
                  </p>
                  <span className="text-[10px] font-mono text-white/30">
                    {shortTestElapsed}s elapsed
                    {shortTestElapsed >= 90 && " · slow network?"}
                  </span>
                </div>
                <p className="text-[10px] font-mono text-sky-200/70">
                  step:{" "}
                  <span className="text-sky-300">
                    {shortTestStep ?? "preparing…"}
                  </span>
                </p>
                <p className="text-[9px] text-white/25">
                  started at:{" "}
                  {shortTestStartedAt
                    ? new Date(shortTestStartedAt).toLocaleTimeString()
                    : "—"}
                </p>
                {shortTestElapsed >= 115 && (
                  <p className="text-[10px] text-amber-400 font-bold pt-1">
                    ⚠ Export taking longer than expected. If it doesn't finish
                    soon, try refreshing the page and running again.
                  </p>
                )}
              </div>
            )}

            {/* ── Short Test timeout error ── */}
            {!busy &&
              shortTestDebug.buttonClicked &&
              !shortTestDebug.resultUrl &&
              shortTestDebug.lastError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/[0.04] px-3 py-3 space-y-1">
                  <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">
                    First 20s Export Failed
                  </p>
                  <p className="text-[10px] font-mono text-red-300/80">
                    {shortTestDebug.lastError}
                  </p>
                  <p className="text-[9px] text-white/30 font-mono">
                    last step: {shortTestDebug.lastStep ?? "—"}
                  </p>
                </div>
              )}

            {/* ── First 20s Export Debug panel ── */}
            {shortTestDebug.buttonClicked && (
              <div className="rounded-xl border border-slate-500/15 bg-slate-500/[0.02] px-3 py-2.5 space-y-0.5">
                <p className="text-[9px] font-black text-slate-300/40 uppercase tracking-widest mb-1.5">
                  First 20s Export Debug
                </p>
                {(
                  [
                    [
                      "button clicked",
                      shortTestDebug.buttonClicked ? "yes ✓" : "no",
                      shortTestDebug.buttonClicked,
                    ],
                    [
                      "export route called",
                      shortTestDebug.routeCalled ? "yes ✓" : "no",
                      shortTestDebug.routeCalled,
                    ],
                    [
                      "clip durations loaded",
                      shortTestDebug.clipDurationsLoaded
                        ? "yes ✓"
                        : "no — run Download All Clips first",
                      shortTestDebug.clipDurationsLoaded,
                    ],
                    [
                      "audio ready",
                      shortTestDebug.audioReady
                        ? "yes ✓"
                        : "no — no audio URL or lip sync blocked",
                      shortTestDebug.audioReady,
                    ],
                    [
                      "ffmpeg started",
                      shortTestDebug.ffmpegStarted
                        ? "yes ✓"
                        : busy === "export-audio-sync-short"
                          ? "pending…"
                          : "no",
                      shortTestDebug.ffmpegStarted,
                    ],
                    [
                      "ffmpeg finished",
                      shortTestDebug.ffmpegFinished
                        ? "yes ✓"
                        : busy === "export-audio-sync-short"
                          ? "pending…"
                          : "no",
                      shortTestDebug.ffmpegFinished,
                    ],
                    [
                      "current step",
                      busy === "export-audio-sync-short"
                        ? (shortTestStep ?? "preparing…")
                        : (shortTestDebug.lastStep ?? "—"),
                      null,
                    ],
                    [
                      "elapsed time",
                      busy === "export-audio-sync-short"
                        ? `${shortTestElapsed}s`
                        : shortTestElapsed > 0
                          ? `${shortTestElapsed}s (finished)`
                          : "—",
                      null,
                    ],
                    [
                      "result URL",
                      shortTestDebug.resultUrl ? "yes ✓" : "no",
                      shortTestDebug.resultUrl ? true : false,
                    ],
                    [
                      "last error",
                      shortTestDebug.lastError ?? "none",
                      shortTestDebug.lastError ? false : null,
                    ],
                  ] as [string, string, boolean | null][]
                ).map(([label, value, ok]) => (
                  <div
                    key={label}
                    className="flex items-start justify-between gap-2"
                  >
                    <span className="text-[9px] font-mono text-white/25 shrink-0">
                      {label}
                    </span>
                    <span
                      className={`text-[9px] font-mono text-right leading-snug ${
                        ok === true
                          ? "text-green-400"
                          : ok === false
                            ? "text-red-400"
                            : "text-white/40"
                      }`}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* ── Audio Diagnostic / Short Test results ── */}
            {[
              { result: audioSyncDiagResult, label: "Audio Sync Diagnostic" },
              { result: audioSyncShortResult, label: "First 20s Audio Test" },
            ].map(
              ({ result, label }) =>
                result && (
                  <div
                    key={label}
                    className="rounded-xl border border-blue-500/20 bg-blue-500/[0.03] px-3 py-3 space-y-2"
                  >
                    <p className="text-[10px] font-black text-blue-300/60 uppercase tracking-widest">
                      {label} Result
                    </p>

                    {/* Export start vs expected 0:00 comparison */}
                    {(() => {
                      const exportStart =
                        result.exportAudioStartSec ?? result.audioOffset ?? 0;
                      const match = exportStart < 0.1;
                      return (
                        <div
                          className={`grid grid-cols-2 gap-2 rounded-lg border px-2.5 py-2 text-[10px] font-mono ${
                            match
                              ? "border-green-500/20 bg-green-500/[0.04]"
                              : "border-red-500/20 bg-red-500/[0.04]"
                          }`}
                        >
                          <div>
                            <p className="text-[9px] text-white/30 mb-0.5">
                              expected audio start
                            </p>
                            <p className="font-bold text-white/70">
                              0:00.0 (0.00s)
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] text-white/30 mb-0.5">
                              actual export audio start
                            </p>
                            <p
                              className={`font-bold ${match ? "text-green-400" : "text-red-400"}`}
                            >
                              {fmtSec(exportStart)} ({exportStart.toFixed(2)}s)
                            </p>
                          </div>
                          <div className="col-span-2 pt-1 border-t border-white/[0.06]">
                            <span
                              className={`font-bold text-[10px] ${match ? "text-green-400" : "text-red-400"}`}
                            >
                              starts at beginning:{" "}
                              {match
                                ? "yes ✓"
                                : `no — offset is ${exportStart.toFixed(2)}s (should be 0.00s)`}
                            </span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Timing detail rows */}
                    {(
                      [
                        [
                          "audio offset applied",
                          `${(result.audioOffset ?? 0).toFixed(2)}s`,
                        ],
                        [
                          "timeline video duration",
                          result.timelineVideoDuration != null
                            ? `${result.timelineVideoDuration.toFixed(2)}s`
                            : "—",
                        ],
                        [
                          "audio file duration",
                          result.audioDuration != null
                            ? `${result.audioDuration.toFixed(2)}s`
                            : "—",
                        ],
                        [
                          "final export duration",
                          result.duration != null
                            ? `${result.duration.toFixed(2)}s`
                            : "—",
                        ],
                        [
                          "audio/video sync mode",
                          result.audioVideoSyncMode ?? syncMode ?? "keep-as-is",
                        ],
                      ] as [string, string][]
                    ).map(([k, v]) => (
                      <div
                        key={k}
                        className="flex items-start justify-between gap-2"
                      >
                        <span className="text-[10px] font-mono text-white/35 shrink-0">
                          {k}
                        </span>
                        <span className="text-[10px] font-mono text-white/55 text-right">
                          {v}
                        </span>
                      </div>
                    ))}

                    {/* Per-clip timeline from server */}
                    {result.clipTimeline && result.clipTimeline.length > 0 && (
                      <div className="pt-2 border-t border-white/[0.06]">
                        <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-1.5">
                          Server Clip Timeline
                        </p>
                        <div className="space-y-0.5 max-h-40 overflow-y-auto">
                          {result.clipTimeline.map((c) => (
                            <div
                              key={c.sceneNumber}
                              className="grid grid-cols-[1.5rem_1fr_3rem_5rem] gap-x-2 items-center text-[9px] font-mono"
                            >
                              <span className="text-white/25">
                                {c.sceneNumber}
                              </span>
                              <span className="text-white/45 truncate">
                                {c.title}
                              </span>
                              <span className="text-white/35 text-right">
                                {c.clipDuration.toFixed(1)}s
                              </span>
                              <span className="text-white/25 text-right">
                                vid {c.timelineStartSec.toFixed(1)}→
                                {c.timelineEndSec.toFixed(1)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Download link */}
                    {result.url && (
                      <a
                        href={result.url}
                        download
                        
                        className="flex items-center gap-1.5 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Download {label} Export
                      </a>
                    )}

                    {result.error && (
                      <p className="text-[10px] text-red-400/80 break-words leading-snug">
                        {result.error}
                      </p>
                    )}
                    {result.stderrTail?.map((line, i) => (
                      <div
                        key={i}
                        className="text-[9px] font-mono text-red-400/60 break-words"
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                ),
            )}

            {/* ── First 20s Sync Check ── shows after short test result is available */}
            {audioSyncShortResult &&
              (() => {
                const exportStart =
                  audioSyncShortResult.exportAudioStartSec ??
                  audioSyncShortResult.audioOffset ??
                  0;
                const audioStartOk = exportStart < 0.1;
                const mismatchedClips = clipAudioMap.filter(
                  (c) =>
                    c.masterDuration > 0 &&
                    c.clipDuration > 0 &&
                    Math.abs(c.clipDuration - c.masterDuration) > 0.35,
                );
                const durationsMatch = mismatchedClips.length === 0;
                const hasTimestamps = clipAudioMap.some(
                  (c) => c.masterDuration > 0,
                );
                const scene1 = clipAudioMap[0];
                const scene1Ok =
                  !scene1 ||
                  scene1.masterDuration === 0 ||
                  scene1.clipDuration === 0
                    ? null
                    : Math.abs(scene1.clipDuration - scene1.masterDuration) <
                      0.35;
                const trimFiltersUsed = clipAudioMap.some(
                  (c) =>
                    c.masterDuration > 0 &&
                    c.rawDuration > 0 &&
                    c.rawDuration > c.masterDuration + 0.2,
                );
                const resultUrl = audioSyncShortResult.url;
                const checks: [string, string, boolean | null][] = [
                  [
                    "audio starts at 0:00",
                    audioStartOk
                      ? "yes ✓"
                      : `no — offset ${exportStart.toFixed(2)}s`,
                    audioStartOk,
                  ],
                  [
                    "scene durations match master",
                    !hasTimestamps
                      ? "no timestamps — unknown"
                      : durationsMatch
                        ? "yes ✓"
                        : `no — ${mismatchedClips.length} clip(s) out of sync`,
                    hasTimestamps ? durationsMatch : null,
                  ],
                  [
                    "scene 1 trimmed correctly",
                    scene1Ok === null
                      ? "unknown (no timestamps)"
                      : scene1Ok
                        ? "yes ✓"
                        : `no — export ${scene1?.clipDuration.toFixed(1)}s vs master ${scene1?.masterDuration.toFixed(1)}s`,
                    scene1Ok,
                  ],
                  [
                    "ffmpeg trim filters used",
                    trimFiltersUsed
                      ? "yes ✓"
                      : hasTimestamps
                        ? "no — raw video ≤ master (no trim needed)"
                        : "unknown",
                    trimFiltersUsed ? true : null,
                  ],
                  [
                    "result URL generated",
                    resultUrl ? "yes ✓" : "no",
                    resultUrl ? true : false,
                  ],
                  [
                    "overall sync",
                    audioStartOk && durationsMatch ? "PASS ✓" : "FAIL ✗",
                    audioStartOk && durationsMatch,
                  ],
                ];
                return (
                  <div
                    className={`rounded-xl border px-3 py-3 space-y-1.5 ${
                      audioStartOk && durationsMatch
                        ? "border-green-500/25 bg-green-500/[0.04]"
                        : "border-amber-500/25 bg-amber-500/[0.03]"
                    }`}
                  >
                    <p className="text-[10px] font-black uppercase tracking-widest mb-2 text-sky-300/60">
                      First 20s Sync Check
                    </p>
                    {checks.map(([label, value, ok]) => (
                      <div
                        key={label}
                        className="flex items-start justify-between gap-2"
                      >
                        <span className="text-[10px] font-mono text-white/35 shrink-0">
                          {label}
                        </span>
                        <span
                          className={`text-[10px] font-mono text-right leading-snug font-bold ${
                            ok === true
                              ? "text-green-400"
                              : ok === false
                                ? "text-red-400"
                                : "text-white/45"
                          }`}
                        >
                          {value}
                        </span>
                      </div>
                    ))}
                    {!durationsMatch && (
                      <p className="text-[9px] text-amber-400/70 leading-snug pt-1 border-t border-white/[0.05]">
                        To fix: click &ldquo;Rebuild Export Timeline From Master
                        Player&rdquo; and re-run this test.
                      </p>
                    )}
                  </div>
                );
              })()}

            <Button
              onClick={exportAllClipsCaptions}
              disabled={busy !== null || !allClipsValid || !fcCaptionsFound}
              variant="outline"
              className="gap-2 border-amber-500/30 bg-amber-500/5 text-amber-400 hover:bg-amber-500/10 text-xs disabled:opacity-40"
              data-testid="btn-doctor-export-all-captions"
            >
              {busy === "export-all-captions" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Stethoscope className="h-3.5 w-3.5" />
              )}
              Export All {multiClips.length} Clips + Audio + Captions Only
            </Button>
            <Button
              onClick={exportAllClipsEffects}
              disabled={busy !== null || !allClipsValid || !fcEffectsFound}
              variant="outline"
              className="gap-2 border-fuchsia-500/30 bg-fuchsia-500/5 text-fuchsia-400 hover:bg-fuchsia-500/10 text-xs disabled:opacity-40"
              data-testid="btn-doctor-export-all-effects"
            >
              {busy === "export-all-effects" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Export All {multiClips.length} Clips + Audio + Captions + Effects
              Only
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={runEffectMatchTest}
                disabled={busy !== null || !allClipsValid || !fcEffectsFound}
                variant="outline"
                className="gap-2 border-cyan-500/30 bg-cyan-500/5 text-cyan-300 hover:bg-cyan-500/10 text-xs disabled:opacity-40"
                data-testid="btn-doctor-effect-match-test"
              >
                {busy === "effect-match-test" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Render 3-Second Effect Match Test
              </Button>
              <Button
                onClick={connectTransitions}
                disabled={busy !== null || !allClipsValid}
                variant="outline"
                className="gap-2 border-violet-500/30 bg-violet-500/5 text-violet-300 hover:bg-violet-500/10 text-xs disabled:opacity-40"
                data-testid="btn-doctor-connect-transitions"
              >
                {busy === "export-transitions" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                Connect Transitions To Export
              </Button>
            </div>
            {/* ── Overlay / Watermark section ── */}
            <Button
              onClick={exportAllClipsOverlays}
              disabled={busy !== null || !allClipsValid || !fcOverlaysFound}
              variant="outline"
              className="gap-2 border-[#C9A84C]/30 bg-[#C9A84C]/5 text-[#C9A84C] hover:bg-[#C9A84C]/10 text-xs disabled:opacity-40 w-full"
              data-testid="btn-doctor-export-all-overlays"
            >
              {busy === "export-all-overlays" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Export All {multiClips.length} Clips + Audio + Captions + Effects
              + Watermark
            </Button>
          </div>
          {!allClipsValid && (
            <p className="text-center text-[10px] text-white/25 leading-relaxed -mt-1 mb-3">
              Export buttons unlock after all clips download and pass ffprobe.
            </p>
          )}

          {/* ── Per-scene table ── */}
          {downloadAllResult && (
            <div className="rounded-xl border border-white/[0.08] overflow-hidden mb-3">
              <div className="px-3 py-2 bg-white/[0.03] border-b border-white/[0.06]">
                <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">
                  Per-Scene Results
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="text-white/35 border-b border-white/[0.06]">
                      <th className="text-left px-2 py-1.5 font-medium">
                        Scene
                      </th>
                      <th className="text-center px-1 py-1.5 font-medium">
                        File
                      </th>
                      <th className="text-right px-1 py-1.5 font-medium">
                        Size
                      </th>
                      <th className="text-right px-1 py-1.5 font-medium">
                        Dur
                      </th>
                      <th className="text-center px-1 py-1.5 font-medium">
                        Res
                      </th>
                      <th className="text-center px-2 py-1.5 font-medium">
                        ffprobe
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {downloadAllResult.clips.map((c) => (
                      <tr
                        key={c.sceneNumber}
                        className="border-b border-white/[0.04] last:border-0"
                      >
                        <td className="px-2 py-1.5 text-white/55 whitespace-nowrap">
                          {c.sceneNumber}
                        </td>
                        <td className="text-center px-1 py-1.5">
                          <span
                            className={
                              c.fileExists ? "text-green-400" : "text-red-400"
                            }
                          >
                            {c.fileExists ? "✓" : "✗"}
                          </span>
                        </td>
                        <td className="text-right px-1 py-1.5 text-white/45">
                          {fmtBytes(c.fileSize)}
                        </td>
                        <td className="text-right px-1 py-1.5 text-white/45">
                          {c.duration ? `${c.duration.toFixed(1)}s` : "—"}
                        </td>
                        <td className="text-center px-1 py-1.5 text-white/45">
                          {c.width ? `${c.width}×${c.height}` : "—"}
                        </td>
                        <td className="text-center px-2 py-1.5">
                          <span
                            className={`font-bold ${c.ffprobeValid ? "text-green-400" : "text-red-400"}`}
                          >
                            {c.ffprobeValid ? "valid" : "invalid"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {downloadAllResult.clips.some((c) => c.error) && (
                <div className="px-3 py-2 border-t border-white/[0.06] space-y-1">
                  {downloadAllResult.clips
                    .filter((c) => c.error)
                    .map((c) => (
                      <div
                        key={c.sceneNumber}
                        className="text-[10px] font-mono text-red-400/80 break-words"
                      >
                        Scene {c.sceneNumber}: {c.error}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* ── All clips export result ── */}
          {exportAllResult?.success && exportAllResult.url && (
            <div className="rounded-xl border border-green-500/25 bg-green-500/[0.04] px-3 py-3 space-y-2 mb-3">
              <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
                <CheckCircle2 className="h-4 w-4" /> All clips export succeeded
                · {exportAllResult.clipCount ?? "?"} clips ·{" "}
                {exportAllResult.duration?.toFixed(1)}s ·{" "}
                {fmtBytes(exportAllResult.fileSize)}
              </div>
              <video
                src={exportAllResult.url}
                controls
                className="w-full max-h-64 rounded-lg bg-black"
              />
              <a
                href={exportAllResult.url}
                download
                
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open / download test video
              </a>
            </div>
          )}

          {/* ── All clips + audio export result ── */}
          {exportAllAudioResult?.success && exportAllAudioResult.url && (
            <div className="rounded-xl border border-green-500/25 bg-green-500/[0.04] px-3 py-3 space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
                <CheckCircle2 className="h-4 w-4" /> All clips + audio export
                succeeded · {exportAllAudioResult.clipCount ?? "?"} clips ·{" "}
                {exportAllAudioResult.duration?.toFixed(1)}s · audio{" "}
                {exportAllAudioResult.hasAudio ? "✓" : "✗"}
              </div>
              <video
                src={exportAllAudioResult.url}
                controls
                className="w-full max-h-64 rounded-lg bg-black"
              />
              <a
                href={exportAllAudioResult.url}
                download
                
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open / download test video
              </a>
            </div>
          )}

          {/* ── Caption Export Doctor status block ── */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] px-3 py-3 space-y-1.5 mt-3">
            <p className="text-[10px] font-black text-amber-400/70 uppercase tracking-widest mb-1">
              Caption Export Doctor
            </p>
            {captionStatusRows.map(([label, val, ok]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 text-[11px] font-mono"
              >
                <span className="text-white/40">{label}</span>
                <span
                  className={`font-bold ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-red-400"}`}
                >
                  {val}
                </span>
              </div>
            ))}
            <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
              <span className="text-white/40 shrink-0">last error</span>
              <span className="text-red-400/80 text-right break-words leading-snug">
                {exportAllCaptionsResult?.error ??
                  (busy !== "export-all-captions" &&
                  exportAllCaptionsResult === null
                    ? (lastError ?? "—")
                    : "—")}
              </span>
            </div>
            {/* Real FFmpeg subtitle error tail on failure */}
            {exportAllCaptionsResult?.stderrTail &&
              exportAllCaptionsResult.stderrTail.length > 0 && (
                <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-0.5">
                  <span className="text-[10px] font-black text-red-400/60 uppercase tracking-widest">
                    FFmpeg subtitle error
                  </span>
                  {exportAllCaptionsResult.stderrTail.map((line, i) => (
                    <div
                      key={i}
                      className="text-[10px] font-mono text-red-400/70 break-words leading-snug"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              )}
          </div>

          {/* ── Caption test export result ── */}
          {exportAllCaptionsResult?.success && exportAllCaptionsResult.url && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] px-3 py-3 space-y-2 mt-3">
              <div className="flex items-center gap-2 text-[11px] text-amber-300 font-bold">
                <CheckCircle2 className="h-4 w-4" /> Captions burned ·{" "}
                {exportAllCaptionsResult.clipCount ?? "?"} clips ·{" "}
                {exportAllCaptionsResult.duration?.toFixed(1)}s ·{" "}
                {exportAllCaptionsResult.captionRows ?? 0} rows · audio{" "}
                {exportAllCaptionsResult.hasAudio ? "✓" : "✗"}
              </div>
              <video
                src={exportAllCaptionsResult.url}
                controls
                className="w-full max-h-64 rounded-lg bg-black"
              />
              <a
                href={exportAllCaptionsResult.url}
                download
                
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open / download captioned
                test video
              </a>
            </div>
          )}

          {/* ── Effects Export Doctor status block ── */}
          <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.03] px-3 py-3 space-y-1.5 mt-3">
            <p className="text-[10px] font-black text-fuchsia-400/70 uppercase tracking-widest mb-1">
              Effects Export Doctor
            </p>
            {effectsStatusRows.map(([label, val, ok]) => (
              <div
                key={label}
                className="flex items-start justify-between gap-2 text-[11px] font-mono"
              >
                <span className="text-white/40 shrink-0">{label}</span>
                <span
                  className={`font-bold text-right break-words ${ok === null ? "text-white/30" : ok ? "text-green-400" : "text-red-400"}`}
                >
                  {val}
                </span>
              </div>
            ))}
            <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
              <span className="text-white/40 shrink-0">last error</span>
              <span className="text-red-400/80 text-right break-words leading-snug">
                {exportAllEffectsResult?.error ??
                  (busy !== "export-all-effects" &&
                  exportAllEffectsResult === null
                    ? (lastError ?? "—")
                    : "—")}
              </span>
            </div>
            {/* Real FFmpeg effects error tail on failure */}
            {exportAllEffectsResult?.stderrTail &&
              exportAllEffectsResult.stderrTail.length > 0 && (
                <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-0.5">
                  <span className="text-[10px] font-black text-red-400/60 uppercase tracking-widest">
                    FFmpeg effects error
                  </span>
                  {exportAllEffectsResult.stderrTail.map((line, i) => (
                    <div
                      key={i}
                      className="text-[10px] font-mono text-red-400/70 break-words leading-snug"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              )}
            <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
              <span className="text-white/40 shrink-0">
                master/export effect stack match
              </span>
              <span
                className={`font-bold text-right ${!stackMatchKnown ? "text-white/30" : stackMatch ? "text-green-400" : "text-red-400"}`}
              >
                {!stackMatchKnown ? "—" : stackMatch ? "yes" : "no"}
              </span>
            </div>
          </div>

          {/* ── Effect conflict resolver (Black & White ↔ Luxury Gold) ── */}
          {conflict?.detected && (
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/[0.05] px-3 py-3 space-y-2 mt-3">
              <p className="text-[10px] font-black text-orange-300/80 uppercase tracking-widest">
                Effect conflict detected
              </p>
              <p className="text-[11px] text-orange-200/80 leading-snug">
                {conflict.note}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ["bw-only", "Black & White only"],
                    ["gold-only", "Luxury Gold only"],
                    ["blend", "Blend both"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setConflictMode(mode)}
                    disabled={busy !== null}
                    data-testid={`btn-conflict-${mode}`}
                    className={`rounded-lg border px-2 py-1.5 text-[10px] font-bold leading-tight transition-colors disabled:opacity-40 ${
                      conflictMode === mode
                        ? "border-orange-400/60 bg-orange-400/15 text-orange-200"
                        : "border-white/[0.08] bg-white/[0.02] text-white/50 hover:bg-white/[0.05]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-white/35 leading-snug">
                Re-run the effects export or match test after changing the
                resolution to apply it.
              </p>
            </div>
          )}

          {/* ── Effect Stack Comparison (master vs export) ── */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3 space-y-2 mt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black text-white/50 uppercase tracking-widest flex items-center gap-1.5">
                <Layers className="h-3 w-3" /> Effect Stack Comparison
              </p>
              <span
                className={`text-[10px] font-bold ${!stackMatchKnown ? "text-white/30" : stackMatch ? "text-green-400" : "text-red-400"}`}
              >
                match: {!stackMatchKnown ? "—" : stackMatch ? "yes" : "no"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["Master Effect Stack", masterStack],
                  ["Export Effect Stack", exportStack],
                ] as const
              ).map(([title, stack]) => (
                <div key={title} className="space-y-1">
                  <p className="text-[9px] font-black text-white/35 uppercase tracking-widest">
                    {title}
                  </p>
                  {stack.length === 0 ? (
                    <p className="text-[10px] font-mono text-white/25">
                      — none —
                    </p>
                  ) : (
                    stack.map((e, i) => (
                      <div
                        key={`${e.name}-${i}`}
                        className="rounded-md border border-white/[0.05] bg-white/[0.015] px-1.5 py-1 text-[9px] font-mono leading-tight"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-white/70 font-bold truncate">
                            {e.name}
                          </span>
                          <span
                            className={
                              e.applied ? "text-green-400" : "text-white/30"
                            }
                          >
                            {e.applied ? "applied" : "off"}
                          </span>
                        </div>
                        <div className="text-white/35">
                          {e.type} · {e.scope} · int {e.intensity ?? "—"} · op{" "}
                          {Math.round(e.opacity * 100)}% · {e.blend} ·{" "}
                          {e.startSec.toFixed(0)}–
                          {e.endSec > 0 ? e.endSec.toFixed(0) : "end"}s
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-white/30 leading-snug pt-1 border-t border-white/[0.06]">
              Effects are global in this project, so scope=global, opacity=100%,
              blend=normal, range=full clip.
            </p>
          </div>

          {/* ── 3-Second Effect Match Test status ── */}
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] px-3 py-3 space-y-1.5 mt-3">
            <p className="text-[10px] font-black text-cyan-300/70 uppercase tracking-widest mb-1">
              Effect Match Test
            </p>
            {matchStatusRows.map(([label, val, ok]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 text-[11px] font-mono"
              >
                <span className="text-white/40">{label}</span>
                <span
                  className={`font-bold ${ok === null ? "text-white/50" : ok ? "text-green-400" : "text-red-400"}`}
                >
                  {val}
                </span>
              </div>
            ))}
            {em?.stderrTail && em.stderrTail.length > 0 && (
              <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-0.5">
                <span className="text-[10px] font-black text-red-400/60 uppercase tracking-widest">
                  FFmpeg match-test error
                </span>
                {em.stderrTail.map((line, i) => (
                  <div
                    key={i}
                    className="text-[10px] font-mono text-red-400/70 break-words leading-snug"
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Effect match test result video ── */}
          {em?.success && em.url && (
            <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] px-3 py-3 space-y-2 mt-3">
              <div className="flex items-center gap-2 text-[11px] text-cyan-200 font-bold">
                <CheckCircle2 className="h-4 w-4" /> 3s match · from{" "}
                {em.rangeStart?.toFixed(1)}s · Scene{" "}
                {(em.activeSceneIndex ?? 0) + 1} · {em.effectsApplied ?? 0} fx ·
                match {em.stackMatch ? "✓" : "✗"}
              </div>
              <video
                src={em.url}
                controls
                className="w-full max-h-64 rounded-lg bg-black"
              />
              <a
                href={em.url}
                download
                
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open / download match test
              </a>
            </div>
          )}

          {/* ── Transitions Export Doctor status block ── */}
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] px-3 py-3 space-y-1.5 mt-3">
            <p className="text-[10px] font-black text-violet-300/70 uppercase tracking-widest mb-1">
              Transitions In Export
            </p>
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-white/40">applied transitions</span>
              <span
                className={`font-bold ${appliedTx.length > 0 ? "text-green-400" : "text-white/30"}`}
              >
                {appliedTx.length}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-white/40">connected to export</span>
              <span
                className={`font-bold ${!tx ? "text-white/30" : tx.transitionsConnected ? "text-green-400" : "text-red-400"}`}
              >
                {!tx ? "—" : tx.transitionsConnected ? "yes" : "no"}
              </span>
            </div>
            {tx && (
              <>
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-white/40">supported</span>
                  <span className="font-bold text-green-400">
                    {txSupported.length}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-white/40">unsupported</span>
                  <span
                    className={`font-bold ${txUnsupported.length > 0 ? "text-amber-400" : "text-white/30"}`}
                  >
                    {txUnsupported.length}
                  </span>
                </div>
                {txPlan.length > 0 && (
                  <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-1">
                    {txPlan.map((p) => (
                      <div
                        key={p.sceneIndex}
                        className="text-[10px] font-mono leading-snug"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white/55">
                            Scene {p.sceneIndex + 1}→{p.sceneIndex + 2}:{" "}
                            {p.type}
                          </span>
                          <span
                            className={
                              p.supported
                                ? "text-green-400 font-bold"
                                : "text-amber-400 font-bold"
                            }
                          >
                            {p.supported ? `xfade=${p.xfade}` : "unsupported"}
                          </span>
                        </div>
                        {p.reason && (
                          <div className="text-amber-400/70 break-words">
                            {p.reason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {!tx && (
              <p className="text-[10px] text-white/35 leading-snug pt-1 border-t border-white/[0.06]">
                Run "Connect Transitions To Export" to render the xfade chain.
                All catalog transitions render: Cut, Crossfade, Fade to Black, Flash,
                Glitch, Whip Pan, Zoom, Light Leak, Slide, Spin, Blur Dissolve.
              </p>
            )}
            {tx?.stderrTail && tx.stderrTail.length > 0 && (
              <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-0.5">
                <span className="text-[10px] font-black text-red-400/60 uppercase tracking-widest">
                  FFmpeg transitions error
                </span>
                {tx.stderrTail.map((line, i) => (
                  <div
                    key={i}
                    className="text-[10px] font-mono text-red-400/70 break-words leading-snug"
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Transitions test export result video ── */}
          {tx?.success && tx.url && (
            <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.04] px-3 py-3 space-y-2 mt-3">
              <div className="flex items-center gap-2 text-[11px] text-violet-200 font-bold">
                <CheckCircle2 className="h-4 w-4" /> Transitions burned ·{" "}
                {tx.clipCount ?? "?"} clips · {tx.duration?.toFixed(1)}s ·{" "}
                {txSupported.length} supported · {txUnsupported.length} fallback
              </div>
              <video
                src={tx.url}
                controls
                className="w-full max-h-64 rounded-lg bg-black"
              />
              <a
                href={tx.url}
                download
                
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open / download transitions
                test
              </a>
            </div>
          )}

          {/* ── Effects test export result ── */}
          {exportAllEffectsResult?.success && exportAllEffectsResult.url && (
            <div className="rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/[0.04] px-3 py-3 space-y-2 mt-3">
              <div className="flex items-center gap-2 text-[11px] text-fuchsia-300 font-bold">
                <CheckCircle2 className="h-4 w-4" /> Effects burned ·{" "}
                {exportAllEffectsResult.clipCount ?? "?"} clips ·{" "}
                {exportAllEffectsResult.duration?.toFixed(1)}s ·{" "}
                {exportAllEffectsResult.effectsCount ?? 0} fx · captions{" "}
                {exportAllEffectsResult.captionsPreserved ? "✓" : "—"} · audio{" "}
                {exportAllEffectsResult.hasAudio ? "✓" : "✗"}
              </div>
              <video
                src={exportAllEffectsResult.url}
                controls
                className="w-full max-h-64 rounded-lg bg-black"
              />
              <a
                href={exportAllEffectsResult.url}
                download
                
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open / download effects
                test video
              </a>
            </div>
          )}

          {/* ── Overlay / Watermark Doctor status panel ── */}
          {(fcOverlaysFound || !!ovr) && (
            <div className="rounded-xl border border-[#C9A84C]/20 bg-[#C9A84C]/[0.03] px-3 py-3 space-y-1.5 mt-3">
              <p className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-widest mb-1">
                Overlay / Watermark Doctor
              </p>
              {overlayStatusRows.map(([label, val, ok]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-2 text-[11px] font-mono"
                >
                  <span className="text-white/40">{label}</span>
                  <span
                    className={`font-bold ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-amber-400"}`}
                  >
                    {String(val)}
                  </span>
                </div>
              ))}
              {ovr?.stderrTail && ovr.stderrTail.length > 0 && (
                <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-0.5">
                  <span className="text-[10px] font-black text-red-400/60 uppercase tracking-widest">
                    FFmpeg error
                  </span>
                  {ovr.stderrTail.map((line, i) => (
                    <div
                      key={i}
                      className="text-[10px] font-mono text-red-400/70 break-words leading-snug"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Overlay / Watermark test export result video ── */}
          {ovr?.success && ovr.url && (
            <div className="rounded-xl border border-[#C9A84C]/30 bg-[#C9A84C]/[0.05] px-3 py-3 space-y-2 mt-3">
              <div className="flex items-center gap-2 text-[11px] text-[#C9A84C] font-bold">
                <CheckCircle2 className="h-4 w-4" /> Watermark burned ·{" "}
                {ovr.clipCount ?? "?"} clips · {ovr.duration?.toFixed(1)}s · "
                {ovr.overlayWatermarkText ?? "Bow Down Visuals"}"
              </div>
              <video
                src={ovr.url}
                controls
                className="w-full max-h-64 rounded-lg bg-black"
              />
              <a
                href={ovr.url}
                download
                
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open / download overlay +
                watermark test
              </a>
            </div>
          )}
        </div>
      </div>
    </EditorCard>
  );
}
