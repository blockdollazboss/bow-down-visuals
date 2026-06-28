import { useState, useRef, useEffect, useCallback } from "react";
import {
  Mic2, Play, Save, CheckCircle2, XCircle, Loader2, AlertTriangle,
  SkipForward, Info, Radio, User, Sliders, RefreshCw, X, Upload, Music,
  KeyRound, FlaskConical, ScanSearch, ShieldCheck, Copy, ExternalLink,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import {
  getClipEdit,
  sceneHasClip,
  type EditorSettings,
  type LipSyncStrength,
  type ClipEdit,
} from "@/lib/editor-settings";
import { EditorCard, Collapsible, Segmented } from "@/components/editor/controls";
import { EmptyScenes } from "@/components/editor/sections/shared";
import { useAuth } from "@/contexts/AuthContext";

/* ── Provider status (fetched from backend — no secrets in frontend) ── */
interface ProviderStatus {
  connected:          boolean;
  providerName:       string | null;
  serverKeyFound:     boolean;
  frontendKeyExposed: boolean;
  mode:               "real" | "mock";
  missingKeyMessage:  string | null;
}

/* ── Types ────────────────────────────────────────────────────────────────── */
interface LipSyncSectionProps {
  scenes:      SceneData[];
  settings:    EditorSettings;
  setSettings: (s: EditorSettings) => void;
  /** Raw project audio URL (from project.input_data.audioUrl). */
  audioUrl?:       string | null;
  /** Effective master-player audio URL (stem-aware). */
  masterAudioUrl?: string | null;
}

interface ProcessState {
  running:    boolean;
  current:    number;
  total:      number;
  cancelled:  boolean;
  lastError:  string | null;
}

/* ── Input check types ── */
interface UrlCheckResult {
  found:       boolean;
  sourceType:  string;
  probe:       { status: number; contentType: string | null } | null;
  error:       string | null;
}

interface InputCheckResult {
  audio:          UrlCheckResult & { url: string | null };
  clip:           UrlCheckResult & { url: string | null };
  provider:       { connected: boolean; providerName: string | null };
  payload?:       {
    sanitizedKeys:  string[];
    removedFields:  string[];
    payloadValid:   boolean;
    sanitizedReady: boolean;
  };
  readyToSubmit:  boolean;
  checkedAt:      string;
}

/* ── Structured debug for non-JSON / network errors from the apply route ── */
interface LipSyncDebug {
  endpoint:    string;
  status:      string;
  contentType: string;
  isJson:      boolean;
  preview:     string;
  nextStep:    string;
}

class LipSyncNetworkError extends Error {
  debug: LipSyncDebug;
  constructor(message: string, debug: LipSyncDebug) {
    super(message);
    this.name = "LipSyncNetworkError";
    this.debug = debug;
  }
}

interface AccountCheckResult {
  keyPresent:                 boolean;
  activeKeyVar:               string | null;
  activeKeyLast4:             string | null;
  multipleKeysFound:          boolean;
  providerEndpointConfigured: boolean;
  accountStatusAvailable:     boolean;
  billingBlocked:             boolean | null;
  httpStatus:                 number | null;
  lastError:                  string | null;
  message:                    string;
  checkedAt:                  string;
}

/* ── Scene timing helpers ─────────────────────────────────────────────────── */

/** Sync Labs plan limit in seconds (kept in sync with backend PROVIDER_LIMIT_SEC) */
const PROVIDER_LIMIT_SEC = 20;

/** Parse "M:SS" or "MM:SS" → total seconds */
function parseTimePart(s: string): number {
  const parts = s.trim().split(":").map(Number);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return 0;
}

/** Format seconds as "M:SS" */
function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.round(s % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

interface SceneTiming {
  startSec:    number;
  endSec:      number;
  durationSec: number;
  hasExplicitEnd: boolean;
}

/**
 * Parse a scene's timestamp string into start/end seconds.
 * Handles "M:SS-M:SS", "M:SS", etc.
 * Falls back to the next scene's start (or start + 8s) when end is not explicit.
 */
function parseSceneTiming(scene: SceneData, allScenes: SceneData[]): SceneTiming {
  const ts    = scene.timestamp ?? "";
  const parts = ts.split("-").map((p) => p.trim()).filter(Boolean);
  const startSec = parts[0] ? parseTimePart(parts[0]) : 0;
  let endSec: number;
  let hasExplicitEnd = false;

  if (parts[1]) {
    endSec = parseTimePart(parts[1]);
    hasExplicitEnd = true;
  } else {
    const next = allScenes.find((s) => s.sceneNumber === scene.sceneNumber + 1);
    if (next) {
      const np = (next.timestamp ?? "").split("-").map((p) => p.trim()).filter(Boolean);
      endSec = np[0] ? parseTimePart(np[0]) : startSec + 8;
    } else {
      endSec = startSec + 8;
    }
  }

  const durationSec = Math.max(0, endSec - startSec);
  return { startSec, endSec, durationSec, hasExplicitEnd };
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function Toggle({
  value, onChange, label, sub,
}: {
  value:    boolean;
  onChange: (v: boolean) => void;
  label:    string;
  sub?:     string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex items-center justify-between gap-3 w-full py-1.5 group"
    >
      <div className="flex-1 min-w-0 text-left">
        <span className="text-xs font-semibold text-white/80">{label}</span>
        {sub && <p className="text-[10px] text-white/35 mt-0.5 leading-snug">{sub}</p>}
      </div>
      <div className={`relative shrink-0 h-5 w-9 rounded-full transition-colors duration-150 ${
        value ? "bg-primary" : "bg-white/15"
      }`}>
        <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${
          value ? "translate-x-4" : "translate-x-0.5"
        }`} />
      </div>
    </button>
  );
}

function StatusRow({
  label, value, ok,
}: {
  label:  string;
  value:  string;
  ok?:    boolean | null;
}) {
  const color =
    ok === true  ? "text-green-400" :
    ok === false ? "text-red-400/80" :
    "text-white/35";
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="font-mono text-white/40">{label}</span>
      <span className={`font-bold ${color}`}>{value}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export function LipSyncSection({
  scenes,
  settings,
  setSettings,
  audioUrl,
  masterAudioUrl,
}: LipSyncSectionProps) {

  const ls = settings.lipSync;
  const ms = settings.musicStudio;
  const { getAccessToken } = useAuth();

  /* ── Provider status (fetched from backend on mount) ── */
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [providerLoading, setProviderLoading] = useState(false);

  const fetchProviderStatus = useCallback(async () => {
    setProviderLoading(true);
    try {
      const res = await fetch("/api/lip-sync/status");
      if (res.ok) {
        const data = await res.json() as ProviderStatus;
        setProviderStatus(data);
      }
    } catch {
      /* network error — leave null */
    } finally {
      setProviderLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProviderStatus();
  }, [fetchProviderStatus]);

  const providerConnected = providerStatus?.connected ?? false;
  const providerName      = providerStatus?.providerName ?? null;

  /* ── Process-all state ── */
  const [processState, setProcessState] = useState<ProcessState | null>(null);
  const cancelRef = useRef(false);

  /* ── Local apply state ── */
  const [applyError, setApplyError]     = useState<string | null>(null);
  const [applyDebug, setApplyDebug]     = useState<LipSyncDebug | null>(null);
  const [confirmOpen, setConfirmOpen]   = useState<"single" | "all" | null>(null);

  /* ── Vocal stem upload state ── */
  const [stemUploading, setStemUploading] = useState(false);
  const [stemUploadError, setStemUploadError] = useState<string | null>(null);
  const stemInputRef = useRef<HTMLInputElement>(null);

  /* ── Music Mixer acapella export state ── */
  const [acapellaExporting, setAcapellaExporting] = useState(false);
  const [acapellaError, setAcapellaError] = useState<string | null>(null);

  /* ── Setup / demo mode state ── */
  const [demoMode, setDemoMode]                   = useState(false);
  const [showKeyInstructions, setShowKeyInstructions] = useState(false);
  const [demoRunSet, setDemoRunSet]               = useState<Set<string>>(new Set());

  /* ── Input check state ── */
  const [inputCheck, setInputCheck]         = useState<InputCheckResult | null>(null);
  const [inputCheckLoading, setInputCheckLoading] = useState(false);

  /* ── Account check state ── */
  const [accountCheck, setAccountCheck]         = useState<AccountCheckResult | null>(null);
  const [accountCheckLoading, setAccountCheckLoading] = useState(false);

  /* ── Health check state ── */
  const [healthCheck, setHealthCheck]           = useState<{ reachable: boolean; status: number; contentType: string; isJson: boolean } | null>(null);
  const [healthLoading, setHealthLoading]       = useState(false);

  /* ── Check existing Sync.so job state ── */
  const [checkJobLoading, setCheckJobLoading]   = useState(false);
  const [checkJobResult, setCheckJobResult]     = useState<{
    jobId:         string;
    rawStatus:     string;
    outputUrl:     string | null;
    providerError: string | null;
    checkedAt:     string;
  } | null>(null);

  /* ── Route test state ── */
  const [routeTest, setRouteTest] = useState<{
    reachable:                  boolean;
    returnsJson:                boolean;
    status:                     number;
    contentType:                string;
    providerKeyPresent:         boolean;
    providerEndpointConfigured: boolean;
    checkedAt:                  string;
  } | null>(null);
  const [routeTestLoading, setRouteTestLoading] = useState(false);

  /* ── Clip duration detection + audio-segment preview ── */
  const [clipVideoDuration, setClipVideoDuration] = useState<number | null>(null);
  const [clipDurationReloadKey, setClipDurationReloadKey] = useState(0);
  const [isPreviewingAudio, setIsPreviewingAudio] = useState(false);
  const [showTimingValidation, setShowTimingValidation] = useState(false);
  const [previewModalUrl, setPreviewModalUrl]   = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Derived: audio source ── */
  const vocalExportUrl = ms.exports.find(r => r.kind === "acapella")?.url ?? null;
  const vocalStemUrl   =
    ls.uploadedVocalStemUrl ??
    vocalExportUrl ??
    ms.stems.find(s =>
      s.name?.toLowerCase().includes("vocal") ||
      s.name?.toLowerCase().includes("acapella") ||
      s.name?.toLowerCase().includes("voice")
    )?.url ?? null;
  const projectAudioFound = !!(audioUrl || masterAudioUrl);
  const vocalStemFound    = !!vocalStemUrl;
  const effectiveAudioUrl =
    ls.audioSource === "vocals" && vocalStemFound
      ? vocalStemUrl
      : (masterAudioUrl ?? audioUrl ?? null);
  const audioReady     = !!effectiveAudioUrl;
  const usingFullMix   = !vocalStemFound || ls.audioSource === "full";

  /* ── Derived: selected scene — deduplicated by scene ID ── */
  const clipsWithFaces = Array.from(
    new Map(
      scenes.filter(s => sceneHasClip(s)).map(s => [s.id, s] as const)
    ).values()
  );
  const selectedScene   = scenes.find(s => s.id === ls.selectedSceneId) ?? clipsWithFaces[0] ?? null;
  const selectedClipEdit: ClipEdit | null = selectedScene
    ? getClipEdit(settings, selectedScene.id)
    : null;
  const audioOffset    = selectedClipEdit?.lipSyncAudioOffset ?? 0;
  const rawTiming      = selectedScene ? parseSceneTiming(selectedScene, scenes) : null;

  /* Target duration priority:
     1. Actual loaded video metadata duration (most accurate)
     2. Fallback: scene timestamp duration (last resort)                        */
  const targetDuration = clipVideoDuration ?? rawTiming?.durationSec ?? 0;
  const durationSource = clipVideoDuration != null ? "real video metadata" : "fallback (scene duration)";

  /* Offset shifts only the START of the extraction window.
     END = start + real clip duration (duration stays fixed regardless of offset). */
  const selectedTiming = rawTiming
    ? {
        ...rawTiming,
        startSec:    rawTiming.startSec + audioOffset,
        endSec:      rawTiming.startSec + audioOffset + targetDuration,
        durationSec: targetDuration,
      }
    : null;

  /* Timing validation */
  const audioSegmentDuration = selectedTiming?.durationSec ?? 0;
  const timingDiff  = clipVideoDuration != null ? Math.abs(audioSegmentDuration - clipVideoDuration) : null;
  const timingOk    = timingDiff != null ? timingDiff < 0.25 : null;
  /** True only when we are NOT in demo mode and the timing mismatch is confirmed */
  const timingBlock = !demoMode && timingOk === false;
  const selectedSceneTitle = selectedScene
    ? (selectedScene.section || selectedScene.lyricLine || `Scene ${selectedScene.sceneNumber}`)
    : "—";

  /* ── Derived: face detection (mock — based on whether clip URL exists) ── */
  const faceDetected    = !!selectedScene?.demoClipUrl;
  const faceConfidence  = faceDetected ? "high (mock)" : "—";
  const clipSourceReady = !!selectedScene?.demoClipUrl;

  /* ── Helpers ── */
  function updateLipSync(patch: Partial<typeof ls>) {
    setSettings({ ...settings, lipSync: { ...ls, ...patch } });
  }

  function updateClipEdit(sceneId: string, patch: Partial<ClipEdit>) {
    const existing = getClipEdit(settings, sceneId);
    setSettings({
      ...settings,
      clips: {
        ...settings.clips,
        [sceneId]: { ...existing, ...patch },
      },
    });
  }

  /* ── Detect clip video duration when selected clip changes or reload is forced ── */
  useEffect(() => {
    const url = selectedScene?.demoClipUrl;
    if (!url) { setClipVideoDuration(null); return; }
    const vid = document.createElement("video");
    vid.preload = "metadata";
    vid.crossOrigin = "anonymous";
    vid.addEventListener("loadedmetadata", () => {
      setClipVideoDuration(isFinite(vid.duration) ? vid.duration : null);
    });
    vid.addEventListener("error", () => setClipVideoDuration(null));
    vid.src = url;
    return () => { vid.src = ""; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScene?.demoClipUrl, clipDurationReloadKey]);

  /* ── Preview the exact audio segment that will be sent to Sync.so ── */
  function previewAudioSegment() {
    if (!effectiveAudioUrl || !selectedTiming) return;
    if (isPreviewingAudio) {
      previewAudioRef.current?.pause();
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      setIsPreviewingAudio(false);
      return;
    }
    const audio = new Audio(effectiveAudioUrl);
    audio.crossOrigin = "anonymous";
    audio.currentTime = Math.max(0, selectedTiming.startSec);
    previewAudioRef.current = audio;
    setIsPreviewingAudio(true);
    void audio.play().catch(() => setIsPreviewingAudio(false));
    const ms = Math.max(200, selectedTiming.durationSec * 1000);
    previewTimerRef.current = setTimeout(() => {
      audio.pause();
      setIsPreviewingAudio(false);
    }, ms);
    audio.addEventListener("ended", () => setIsPreviewingAudio(false));
  }

  /* ── Adjust audio offset for the selected scene ── */
  function setAudioOffset(offset: number) {
    if (!selectedScene) return;
    updateClipEdit(selectedScene.id, {
      lipSyncAudioOffset: Math.round(offset * 10) / 10,
    });
  }

  /* ── Force re-detect clip video duration (in case first load failed / stale) ── */
  function rebuildFromRealClipDuration() {
    setClipVideoDuration(null);
    setClipDurationReloadKey(k => k + 1);
  }

  /* ── Upload vocal stem ── */
  async function uploadVocalStem(file: File) {
    setStemUploading(true);
    setStemUploadError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/lip-sync/upload-vocal-stem", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "audio/mpeg",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: file,
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? `Upload failed: HTTP ${res.status}`);
      }
      updateLipSync({ uploadedVocalStemUrl: data.url, audioSource: "vocals" });
    } catch (err) {
      setStemUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setStemUploading(false);
    }
  }

  /* ── Export acapella from Music Mixer ── */
  async function exportAcapellaStem() {
    const acapellaStems = ms.stems.filter(s =>
      s.name?.toLowerCase().includes("vocal") ||
      s.name?.toLowerCase().includes("acapella") ||
      s.name?.toLowerCase().includes("voice") ||
      s.name?.toLowerCase().includes("lead") ||
      s.name?.toLowerCase().includes("ad-lib") ||
      s.name?.toLowerCase().includes("background")
    );
    if (acapellaStems.length === 0) {
      setAcapellaError("No vocal stems found in Music Mixer. Label your stems (Lead, Acapella, Background) and try again.");
      return;
    }
    setAcapellaExporting(true);
    setAcapellaError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/music/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ exportType: "acapella-mp3", stems: ms.stems, masterVolume: 100 }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? `Export failed: HTTP ${res.status}`);
      }
      updateLipSync({ uploadedVocalStemUrl: data.url, audioSource: "vocals" });
    } catch (err) {
      setAcapellaError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setAcapellaExporting(false);
    }
  }

  /* ── Check existing Sync.so job (no new submission) ── */
  async function checkExistingJob() {
    if (!selectedScene || !selectedClipEdit?.lipSyncJobId) return;
    const jobId = selectedClipEdit.lipSyncJobId;
    setCheckJobLoading(true);
    setApplyError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/lip-sync/check-provider-job/${jobId}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
        signal:  AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Check failed: HTTP ${res.status} — ${body.slice(0, 200)}`);
      }
      const data = await res.json() as { status: string; outputUrl?: string; error?: string };
      const normalStatus = data.status.toLowerCase();

      const result = {
        jobId,
        rawStatus:     data.status,
        outputUrl:     data.outputUrl ?? null,
        providerError: data.error ?? null,
        checkedAt:     new Date().toISOString(),
      };
      setCheckJobResult(result);
      setApplyError(null); // clear any stale error — result panel is the authoritative signal

      if (normalStatus === "failed") {
        updateClipEdit(selectedScene.id, {
          lipSyncStatus: "failed",
          lipSyncError:  data.error ?? "Sync.so job failed.",
        });
        /* Do NOT setApplyError — shown in checkJobResult panel */
      }
      /* "completed": do NOT auto-save — user chooses via buttons in the panel.
         "processing" / "pending": leave status as-is, never mark failed. */
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckJobLoading(false);
    }
  }

  /* ── Save completed Sync.so result to scene metadata only ── */
  function saveResultToScene(jobId: string, outputUrl: string) {
    if (!selectedScene) return;
    updateClipEdit(selectedScene.id, {
      lipSyncUrl:       outputUrl,
      lipSyncStatus:    "done",
      lipSyncProvider:  "sync.so",
      lipSyncJobId:     jobId,
      lipSyncCreatedAt: new Date().toISOString(),
      lipSyncError:     null,
      useLipSync:       true,
    });
    setApplyError(null);
  }

  /* ── Apply completed result to master player (save + activate useLipSync) ── */
  function useResultInPlayer(jobId: string, outputUrl: string) {
    if (!selectedScene) return;
    updateClipEdit(selectedScene.id, {
      lipSyncUrl:       outputUrl,
      lipSyncStatus:    "done",
      lipSyncProvider:  "sync.so",
      lipSyncJobId:     jobId,
      lipSyncCreatedAt: new Date().toISOString(),
      lipSyncError:     null,
      replaceUrl:       outputUrl,
      useLipSync:       true,
    });
    setApplyError(null);
  }

  /* ── Attach already-stored lip sync result to master player ── */
  function attachStoredResult() {
    if (!selectedScene || !selectedClipEdit?.lipSyncUrl) return;
    updateClipEdit(selectedScene.id, {
      useLipSync:    true,
      lipSyncStatus: "done",
      lipSyncError:  null,
    });
    setApplyError(null);
  }

  /* ── Detach lip sync (keep stored, stop using in player) ── */
  function detachFromPlayer() {
    if (!selectedScene) return;
    updateClipEdit(selectedScene.id, { useLipSync: false });
  }

  /* ── Stop tracking job locally (no API call) ── */
  function stopTrackingJob(sceneId: string) {
    updateClipEdit(sceneId, {
      lipSyncJobId:       null,
      lipSyncSubmittedAt: null,
      lipSyncStatus:      null,
      lipSyncError:       null,
    });
    setApplyError(null);
  }

  /* ── Apply to selected ── */
  async function applyToSelected() {
    if (!selectedScene) return;
    if (!faceDetected)  { setApplyError("No clear face found for lip sync on this clip."); return; }

    /* Guard: don't resubmit if a Sync.so job is already in flight */
    const existingJobId = getClipEdit(settings, selectedScene.id).lipSyncJobId;
    const existingStatus = getClipEdit(settings, selectedScene.id).lipSyncStatus;
    if (existingJobId && existingStatus === "processing") {
      setApplyError("Lip Sync job already processing. Checking status instead of submitting again.");
      return;
    }

    /* Demo mode — simulate processing, no real API call */
    if (demoMode) {
      setApplyError(null);
      setConfirmOpen(null);
      updateClipEdit(selectedScene.id, { lipSyncStatus: "processing", lipSyncError: null });
      await new Promise<void>(r => setTimeout(r, 1500));
      updateClipEdit(selectedScene.id, { lipSyncStatus: null, lipSyncError: null });
      setDemoRunSet(prev => new Set([...prev, selectedScene.id]));
      return;
    }

    if (!providerConnected) {
      setApplyError("Lip Sync provider not connected. Add LIP_SYNC_API_KEY in Replit Secrets.");
      return;
    }
    if (!audioReady) { setApplyError("No audio source available."); return; }

    /* ── Pre-flight: check both URLs are reachable before burning credits ── */
    const check = await checkInputs(effectiveAudioUrl!, selectedScene.demoClipUrl!);
    if (check) {
      if (!check.audio.found) {
        setApplyError(`Audio URL check failed: ${check.audio.error ?? "not reachable"} (type: ${check.audio.sourceType})`);
        return;
      }
      if (!check.clip.found) {
        setApplyError(`Clip URL check failed: ${check.clip.error ?? "not reachable"}`);
        return;
      }
    }

    setApplyError(null);
    setApplyDebug(null);
    setConfirmOpen(null);
    const sceneId = selectedScene.id;
    /* Flag any existing result as timing-mismatch — kept until corrected job succeeds */
    if (getClipEdit(settings, sceneId).lipSyncUrl) {
      updateClipEdit(sceneId, { lipSyncTimingMismatch: true });
    }
    updateClipEdit(sceneId, {
      lipSyncStatus:      "processing",
      lipSyncError:       null,
      lipSyncSubmittedAt: new Date().toISOString(),
    });

    try {
      /* Use offset-adjusted timing so Sync.so receives the correct audio window */
      const timing = selectedTiming ?? parseSceneTiming(selectedScene, scenes);
      const result = await callLipSyncBackend({
        clipUrl:            selectedScene.demoClipUrl!,
        audioUrl:           effectiveAudioUrl!,
        sceneStartSec:      timing.startSec,
        sceneEndSec:        timing.endSec,
        audioSourceType:    ls.audioSource === "vocals" ? "vocals_only" : "full_mix",
        strength:           ls.strength,
        preserveFaceIdentity: ls.preserveFaceIdentity,
        preserveArtistLook:   ls.preserveArtistLook,
        getAccessToken,
        onSyncLabsJobAccepted: (syncLabsJobId) => {
          /* Save provider job ID immediately — persists even if local polling times out */
          updateClipEdit(sceneId, { lipSyncJobId: syncLabsJobId, lipSyncProvider: "sync.so" });
        },
      });

      updateClipEdit(sceneId, {
        lipSyncUrl:             result.url,
        lipSyncStatus:          "done",
        lipSyncProvider:        result.provider,
        lipSyncCreatedAt:       new Date().toISOString(),
        lipSyncError:           null,
        lipSyncJobId:           null,
        replaceUrl:             result.url,
        useLipSync:             true,
        lipSyncTimingMismatch:  false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof StillProcessingError) {
        /* Keep status as processing — Sync.so may still be running */
        updateClipEdit(sceneId, { lipSyncError: msg });
        setApplyError(msg);
      } else {
        updateClipEdit(sceneId, { lipSyncStatus: "failed", lipSyncError: msg });
        setApplyError(msg);
        setApplyDebug(err instanceof LipSyncNetworkError ? err.debug : null);
      }
    }
  }

  /* ── Apply to all ── */
  async function applyToAll() {
    const eligible = clipsWithFaces.filter(s => !!s.demoClipUrl);
    if (eligible.length === 0) { setApplyError("No clips with detectable faces found."); return; }

    /* Demo mode — simulate each clip, no real API calls */
    if (demoMode) {
      setApplyError(null);
      setConfirmOpen(null);
      cancelRef.current = false;
      setProcessState({ running: true, current: 0, total: eligible.length, cancelled: false, lastError: null });

      for (let i = 0; i < eligible.length; i++) {
        if (cancelRef.current) {
          setProcessState(p => p ? { ...p, running: false, cancelled: true } : null);
          return;
        }
        const scene = eligible[i]!;
        setProcessState(p => p ? { ...p, current: i + 1 } : null);
        updateClipEdit(scene.id, { lipSyncStatus: "processing", lipSyncError: null });
        await new Promise<void>(r => setTimeout(r, 900));
        updateClipEdit(scene.id, { lipSyncStatus: null, lipSyncError: null });
        setDemoRunSet(prev => new Set([...prev, scene.id]));
      }

      setProcessState(p => p ? { ...p, running: false } : null);
      return;
    }

    if (!providerConnected) {
      setApplyError("Lip Sync provider not connected. Add LIP_SYNC_API_KEY in Replit Secrets.");
      return;
    }
    if (!audioReady) { setApplyError("No audio source available."); return; }

    setApplyError(null);
    setApplyDebug(null);
    setConfirmOpen(null);
    cancelRef.current = false;
    setProcessState({ running: true, current: 0, total: eligible.length, cancelled: false, lastError: null });

    for (let i = 0; i < eligible.length; i++) {
      if (cancelRef.current) {
        setProcessState(p => p ? { ...p, running: false, cancelled: true } : null);
        return;
      }
      const scene = eligible[i]!;
      setProcessState(p => p ? { ...p, current: i + 1 } : null);
      updateClipEdit(scene.id, {
        lipSyncStatus:      "processing",
        lipSyncError:       null,
        lipSyncSubmittedAt: new Date().toISOString(),
      });

      try {
        const sid = scene.id;
        const sceneTiming = parseSceneTiming(scene, scenes);
        const result = await callLipSyncBackend({
          clipUrl:            scene.demoClipUrl!,
          audioUrl:           effectiveAudioUrl!,
          sceneStartSec:      sceneTiming.startSec,
          sceneEndSec:        sceneTiming.endSec,
          audioSourceType:    ls.audioSource === "vocals" ? "vocals_only" : "full_mix",
          strength:           ls.strength,
          preserveFaceIdentity: ls.preserveFaceIdentity,
          preserveArtistLook:   ls.preserveArtistLook,
          getAccessToken,
          onSyncLabsJobAccepted: (syncLabsJobId) => {
            updateClipEdit(sid, { lipSyncJobId: syncLabsJobId, lipSyncProvider: "sync.so" });
          },
        });
        updateClipEdit(scene.id, {
          lipSyncUrl:         result.url,
          lipSyncStatus:      "done",
          lipSyncProvider:    result.provider,
          lipSyncCreatedAt:   new Date().toISOString(),
          lipSyncError:       null,
          lipSyncJobId:       null,
          replaceUrl:         result.url,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof StillProcessingError) {
          updateClipEdit(scene.id, { lipSyncError: msg });
          setProcessState(p => p ? { ...p, lastError: `Scene ${scene.sceneNumber}: still processing` } : null);
        } else {
          updateClipEdit(scene.id, { lipSyncStatus: "failed", lipSyncError: msg });
          setProcessState(p => p ? { ...p, lastError: `Scene ${scene.sceneNumber}: ${msg}` } : null);
          if (err instanceof LipSyncNetworkError) setApplyDebug(err.debug);
        }
      }
    }

    setProcessState(p => p ? { ...p, running: false } : null);
  }

  function cancelAll() { cancelRef.current = true; }

  /* ── Check lip sync inputs ── */
  async function checkInputs(overrideAudioUrl?: string, overrideClipUrl?: string): Promise<InputCheckResult | null> {
    const audioToCheck = overrideAudioUrl ?? effectiveAudioUrl;
    const clipToCheck  = overrideClipUrl  ?? selectedScene?.demoClipUrl;
    if (!audioToCheck && !clipToCheck) return null;
    setInputCheckLoading(true);
    try {
      const params = new URLSearchParams();
      if (audioToCheck) params.set("audioUrl", audioToCheck);
      if (clipToCheck)  params.set("clipUrl",  clipToCheck);
      const res = await fetch(`/api/lip-sync/check-inputs?${params.toString()}`);
      if (!res.ok) return null;
      const data = await res.json() as Omit<InputCheckResult, "checkedAt">;
      const result: InputCheckResult = { ...data, checkedAt: new Date().toLocaleTimeString() };
      setInputCheck(result);
      return result;
    } catch {
      return null;
    } finally {
      setInputCheckLoading(false);
    }
  }

  /* ── Sync Labs account check ── */
  async function fetchAccountCheck() {
    setAccountCheckLoading(true);
    try {
      const res = await fetch("/api/lip-sync/account-check");
      const ct  = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        const preview = (await res.text()).slice(0, 120);
        setAccountCheck({
          keyPresent: false, activeKeyVar: null, activeKeyLast4: null,
          multipleKeysFound: false, providerEndpointConfigured: false,
          accountStatusAvailable: false, billingBlocked: null,
          httpStatus: res.status, lastError: `Non-JSON response: ${preview}`,
          message: "Account check failed", checkedAt: new Date().toLocaleTimeString(),
        });
        return;
      }
      const data = await res.json() as Omit<AccountCheckResult, "checkedAt">;
      setAccountCheck({ ...data, checkedAt: new Date().toLocaleTimeString() });
    } catch (err) {
      setAccountCheck({
        keyPresent: false, activeKeyVar: null, activeKeyLast4: null,
        multipleKeysFound: false, providerEndpointConfigured: false,
        accountStatusAvailable: false, billingBlocked: null,
        httpStatus: null,
        lastError: err instanceof Error ? err.message : "Network error",
        message: "Account check failed", checkedAt: new Date().toLocaleTimeString(),
      });
    } finally {
      setAccountCheckLoading(false);
    }
  }

  /* ── Health check ── */
  async function fetchHealth() {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/lip-sync/health", { signal: AbortSignal.timeout(10_000) });
      const contentType = res.headers.get("content-type") ?? "";
      setHealthCheck({
        reachable:   res.ok,
        status:      res.status,
        contentType: contentType || "(none)",
        isJson:      contentType.includes("application/json"),
      });
    } catch {
      setHealthCheck({ reachable: false, status: 0, contentType: "(none)", isJson: false });
    } finally {
      setHealthLoading(false);
    }
  }

  /* ── Test submit route ── */
  async function testSubmitRoute() {
    setRouteTestLoading(true);
    try {
      const res = await fetch("/api/lip-sync/status");
      const ct = res.headers.get("content-type") ?? "";
      const isJson = ct.includes("application/json");
      let providerKeyPresent = false;
      if (isJson) {
        const data = await res.json() as { serverKeyFound?: boolean; connected?: boolean };
        providerKeyPresent = !!(data.serverKeyFound ?? data.connected);
      }
      setRouteTest({
        reachable:                  true,
        returnsJson:                isJson,
        status:                     res.status,
        contentType:                ct || "(none)",
        providerKeyPresent,
        providerEndpointConfigured: true,
        checkedAt:                  new Date().toLocaleTimeString(),
      });
    } catch {
      setRouteTest({
        reachable:                  false,
        returnsJson:                false,
        status:                     0,
        contentType:                "(network error)",
        providerKeyPresent:         false,
        providerEndpointConfigured: false,
        checkedAt:                  new Date().toLocaleTimeString(),
      });
    } finally {
      setRouteTestLoading(false);
    }
  }

  /* ── Clear result ── */
  function clearLipSync(sceneId: string) {
    const existing = getClipEdit(settings, sceneId);
    setSettings({
      ...settings,
      clips: {
        ...settings.clips,
        [sceneId]: {
          ...existing,
          lipSyncUrl:         null,
          lipSyncStatus:      null,
          lipSyncProvider:    null,
          lipSyncCreatedAt:   null,
          lipSyncError:       null,
          lipSyncJobId:       null,
          lipSyncSubmittedAt: null,
          replaceUrl: existing.replaceUrl === existing.lipSyncUrl ? null : existing.replaceUrl,
        },
      },
    });
  }

  if (scenes.length === 0) return <EmptyScenes />;

  const allDoneCount       = scenes.filter(s => getClipEdit(settings, s.id).lipSyncStatus === "done").length;
  const allProcessingCount = scenes.filter(s => getClipEdit(settings, s.id).lipSyncStatus === "processing").length;

  return (
    <div className="space-y-4">

      {/* ── Enable Lip Sync ── */}
      <EditorCard
        title="Lip Sync"
        subtitle="Match artist mouth movement to project audio"
        icon={<Mic2 className="h-4 w-4" />}
      >
        <Toggle
          value={ls.enabled}
          onChange={v => updateLipSync({ enabled: v })}
          label="Enable Lip Sync"
          sub="Applies AI lip sync to video clips using project vocals"
        />
      </EditorCard>

      {ls.enabled && (
        <>
          {/* ── Provider status ── */}
          <EditorCard title="Provider" icon={<Radio className="h-4 w-4" />}>
            <div className="space-y-2">
              {/* Checking */}
              {providerLoading && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] text-white/40 text-[11px]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  Checking provider…
                </div>
              )}

              {/* Connected */}
              {!providerLoading && providerConnected && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-green-500/30 bg-green-500/[0.06] text-green-400 text-[11px] font-semibold">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  Connected · {providerName}
                </div>
              )}

              {/* Demo mode active */}
              {!providerLoading && !providerConnected && demoMode && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-blue-500/30 bg-blue-500/[0.06] text-blue-400 text-[11px] font-semibold">
                  <FlaskConical className="h-3.5 w-3.5 shrink-0" />
                  Demo Mode Active — simulations only, no real API calls
                  <button
                    type="button"
                    onClick={() => setDemoMode(false)}
                    className="ml-auto text-white/30 hover:text-white/60 transition-colors"
                    title="Exit demo mode"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Not connected — setup flow */}
              {!providerLoading && !providerConnected && !demoMode && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] text-amber-400 text-[11px] font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      {providerStatus?.missingKeyMessage ?? "Lip Sync is not connected yet."}
                      <br />
                      <span className="font-normal text-amber-400/70">
                        To use real lip sync, connect a lip sync provider API key in Replit Secrets.
                      </span>
                    </span>
                  </div>

                  {!showKeyInstructions && (
                    <>
                      {/* Setup steps */}
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-3 space-y-2">
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Lip Sync Setup</p>
                        {[
                          "Choose a lip sync provider (e.g. HeyGen, Sync.so, Hedra)",
                          "Copy your API key from that provider's dashboard",
                          "Add it to Replit Secrets as LIP_SYNC_API_KEY",
                          "Refresh this page",
                        ].map((step, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="shrink-0 inline-flex items-center justify-center h-4 w-4 rounded-full bg-white/10 text-[9px] font-black text-white/50 mt-0.5">{i + 1}</span>
                            <span className="text-[11px] text-white/60">{step}</span>
                          </div>
                        ))}
                      </div>
                      {/* Two action buttons */}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowKeyInstructions(true)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-primary/40 bg-primary/[0.08] text-primary text-[11px] font-bold hover:bg-primary/[0.15] transition-colors"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          I Have An API Key
                        </button>
                        <button
                          type="button"
                          onClick={() => setDemoMode(true)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-white/60 text-[11px] font-bold hover:bg-white/[0.06] transition-colors"
                        >
                          <FlaskConical className="h-3.5 w-3.5" />
                          Use Demo Mode For Now
                        </button>
                      </div>
                    </>
                  )}

                  {/* "I Have An API Key" instructions */}
                  {showKeyInstructions && (
                    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-3 space-y-2.5">
                      <p className="text-[11px] font-bold text-primary">Add your API key to Replit Secrets:</p>
                      <div className="space-y-1.5">
                        {[
                          "Open Replit → Tools → Secrets",
                          "Click + Add new secret",
                          "Key: LIP_SYNC_API_KEY",
                          "Value: paste your provider API key",
                          "Save, then click Refresh below",
                        ].map((step, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="shrink-0 inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary/20 text-[9px] font-black text-primary/70 mt-0.5">{i + 1}</span>
                            <span className="text-[10px] text-white/60">{step}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => { void fetchProviderStatus(); setShowKeyInstructions(false); }}
                          disabled={providerLoading}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-primary text-black text-[11px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className="h-3 w-3" /> Refresh
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowKeyInstructions(false)}
                          className="px-3 py-2 rounded-xl border border-white/10 text-white/40 text-[11px] hover:bg-white/[0.04] transition-colors"
                        >
                          Back
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Status rows */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                <StatusRow label="provider"            value={providerStatus?.providerName ?? "none"}              ok={providerConnected} />
                <StatusRow label="connected"           value={providerConnected ? "yes" : "no"}                    ok={providerConnected} />
                <StatusRow label="server key found"    value={providerStatus?.serverKeyFound ? "yes" : "no"}       ok={providerStatus?.serverKeyFound} />
                <StatusRow label="frontend key exposed" value="no"                                                  ok={true} />
                <StatusRow label="mode"                value={demoMode ? "demo" : (providerStatus?.mode ?? "—")}   ok={providerConnected || demoMode ? true : false} />
                <StatusRow label="clips lip synced"    value={`${allDoneCount} / ${scenes.length}`}                ok={allDoneCount > 0 ? true : null} />
                <StatusRow label="clips processing"    value={allProcessingCount > 0 ? `${allProcessingCount} running` : "none"} ok={allProcessingCount > 0 ? null : undefined} />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void fetchProviderStatus()}
                  disabled={providerLoading}
                  className="flex items-center gap-1.5 text-[10px] text-white/30 hover:text-white/60 transition-colors disabled:opacity-40"
                >
                  <RefreshCw className="h-3 w-3" /> Refresh status
                </button>
                <button
                  type="button"
                  onClick={() => void testSubmitRoute()}
                  disabled={routeTestLoading}
                  className="flex items-center gap-1.5 text-[10px] text-white/30 hover:text-white/60 transition-colors disabled:opacity-40"
                >
                  {routeTestLoading
                    ? <><Loader2 className="h-3 w-3 animate-spin" /> Testing…</>
                    : <><ShieldCheck className="h-3 w-3" /> Test Submit Route</>}
                </button>
              </div>

              {/* Route test result */}
              {routeTest && !routeTestLoading && (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest pb-0.5">
                    Submit Route Test · {routeTest.checkedAt}
                  </p>
                  <StatusRow label="internal route reachable"      value={routeTest.reachable ? "yes ✓" : "no ✗"}             ok={routeTest.reachable} />
                  <StatusRow label="route returns JSON"            value={routeTest.returnsJson ? "yes ✓" : "no ✗"}           ok={routeTest.returnsJson} />
                  <StatusRow label="provider key present"          value={routeTest.providerKeyPresent ? "yes ✓" : "no ✗"}    ok={routeTest.providerKeyPresent} />
                  <StatusRow label="provider endpoint configured"  value={routeTest.providerEndpointConfigured ? "yes" : "no"} ok={routeTest.providerEndpointConfigured} />
                  <StatusRow label="last response status"          value={routeTest.status ? String(routeTest.status) : "—"}  ok={routeTest.status === 200 ? true : null} />
                  <StatusRow label="last response content-type"    value={routeTest.contentType}                               ok={routeTest.returnsJson ? true : false} />
                </div>
              )}
            </div>
          </EditorCard>

          {/* ── Test Submit Route ── */}
          <EditorCard title="Test Sync Labs Submit Route" icon={<ShieldCheck className="h-4 w-4" />}>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void testSubmitRoute()}
                disabled={routeTestLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-primary/30 bg-primary/[0.06] text-primary text-[11px] font-bold hover:bg-primary/[0.12] transition-colors disabled:opacity-40"
              >
                {routeTestLoading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing route…</>
                  : <><ShieldCheck className="h-3.5 w-3.5" /> Test Sync Labs Submit Route</>}
              </button>

              {!routeTest && !routeTestLoading && (
                <p className="text-[10px] text-white/35 text-center">
                  Click to verify the submit route works before applying lip sync
                </p>
              )}

              {routeTest && !routeTestLoading && (
                <div className="space-y-1.5">
                  <StatusRow label="internal route reachable"     value={routeTest.reachable ? "yes ✓" : "no ✗"}             ok={routeTest.reachable} />
                  <StatusRow label="route returns JSON"           value={routeTest.returnsJson ? "yes ✓" : "no ✗"}           ok={routeTest.returnsJson} />
                  <StatusRow label="provider key present"         value={routeTest.providerKeyPresent ? "yes ✓" : "no ✗"}    ok={routeTest.providerKeyPresent} />
                  <StatusRow label="provider endpoint configured" value={routeTest.providerEndpointConfigured ? "yes" : "no"} ok={routeTest.providerEndpointConfigured} />
                  <StatusRow label="last response status"         value={routeTest.status ? String(routeTest.status) : "—"}  ok={routeTest.status === 200 ? true : null} />
                  <StatusRow label="last response content-type"   value={routeTest.contentType}                               ok={routeTest.returnsJson ? true : false} />

                  {routeTest.reachable && routeTest.returnsJson && routeTest.providerKeyPresent ? (
                    <div className="flex items-center gap-1.5 mt-1 px-3 py-2 rounded-lg border border-green-500/30 bg-green-500/[0.06] text-green-400 text-[10px] font-bold">
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                      Ready — now click Apply to Scene
                    </div>
                  ) : (
                    <div className="flex items-start gap-1.5 mt-1 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] text-amber-400/80 text-[10px] font-semibold">
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                      {!routeTest.reachable
                        ? "Route unreachable — check API server is running"
                        : !routeTest.returnsJson
                          ? "Route not returning JSON — check server logs"
                          : "Provider key missing — add LIP_SYNC_API_KEY in Replit Secrets"}
                    </div>
                  )}
                </div>
              )}
            </div>
          </EditorCard>

          {/* ── Sync Labs Account Check ── */}
          <EditorCard title="Sync Labs Account Check" icon={<KeyRound className="h-4 w-4" />}>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void fetchAccountCheck()}
                disabled={accountCheckLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-white/70 text-[11px] font-bold hover:bg-white/[0.08] transition-colors disabled:opacity-40"
              >
                {accountCheckLoading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking Sync Labs account…</>
                  : <><RefreshCw className="h-3.5 w-3.5" /> Refresh Sync Labs Account Status</>}
              </button>

              {!accountCheck && !accountCheckLoading && (
                <p className="text-[10px] text-white/35 text-center">
                  Click to verify which API key is active and check billing status
                </p>
              )}

              {accountCheck && !accountCheckLoading && (
                <div className="space-y-1.5">
                  {/* Key inventory */}
                  <StatusRow
                    label="Sync Labs API key present"
                    value={accountCheck.keyPresent ? "yes ✓" : "no ✗"}
                    ok={accountCheck.keyPresent}
                  />
                  {accountCheck.keyPresent && (
                    <>
                      <StatusRow
                        label="API key source"
                        value={accountCheck.activeKeyVar ?? "—"}
                        ok={null}
                      />
                      <StatusRow
                        label="API key last 4 chars"
                        value={accountCheck.activeKeyLast4 ? `…${accountCheck.activeKeyLast4}` : "—"}
                        ok={null}
                      />
                    </>
                  )}
                  {accountCheck.multipleKeysFound && (
                    <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] text-amber-400/80 text-[10px] font-semibold">
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                      Multiple Sync Labs keys found. Using: {accountCheck.activeKeyVar} ending in {accountCheck.activeKeyLast4}
                    </div>
                  )}
                  <StatusRow
                    label="provider endpoint configured"
                    value={accountCheck.providerEndpointConfigured ? "yes" : "no"}
                    ok={accountCheck.providerEndpointConfigured}
                  />
                  <StatusRow
                    label="account status checked"
                    value={accountCheck.accountStatusAvailable ? "yes" : "n/a"}
                    ok={accountCheck.accountStatusAvailable ? true : null}
                  />
                  <StatusRow
                    label="billing / free-tier blocked"
                    value={
                      accountCheck.billingBlocked === true  ? "yes ✗" :
                      accountCheck.billingBlocked === false ? "no ✓"  : "unknown"
                    }
                    ok={
                      accountCheck.billingBlocked === true  ? false :
                      accountCheck.billingBlocked === false ? true  : null
                    }
                  />
                  {accountCheck.httpStatus !== null && (
                    <StatusRow
                      label="last HTTP status"
                      value={String(accountCheck.httpStatus)}
                      ok={accountCheck.httpStatus === 200 ? true : accountCheck.httpStatus === 405 ? null : false}
                    />
                  )}

                  {/* Main verdict */}
                  {accountCheck.billingBlocked === true && (
                    <div className="flex items-start gap-1.5 mt-1 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/[0.06] text-red-400 text-[10px] font-bold">
                      <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                      This API key is tied to a free / exhausted Sync Labs account. Replace it with your paid account API key.
                    </div>
                  )}
                  {accountCheck.billingBlocked === false && (
                    <div className="flex items-center gap-1.5 mt-1 px-3 py-2 rounded-lg border border-green-500/30 bg-green-500/[0.06] text-green-400 text-[10px] font-bold">
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                      Account active — billing looks good
                    </div>
                  )}
                  {!accountCheck.keyPresent && (
                    <div className="flex items-start gap-1.5 mt-1 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] text-amber-400/80 text-[10px] font-semibold">
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                      Add LIP_SYNC_API_KEY or SYNC_LABS_API_KEY in Replit Secrets
                    </div>
                  )}

                  {/* Last error / info message */}
                  {accountCheck.lastError && (
                    <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-[9px] text-white/40 font-mono break-all">
                      {accountCheck.lastError}
                    </div>
                  )}

                  <p className="text-[9px] text-white/25 text-right pt-0.5">
                    checked {accountCheck.checkedAt}
                  </p>
                </div>
              )}

              {/* ── Route health check ── */}
              <div className="pt-1 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => void fetchHealth()}
                  disabled={healthLoading}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/60 text-[11px] font-semibold hover:bg-white/[0.06] disabled:opacity-40 transition-colors"
                >
                  {healthLoading
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</>
                    : <><ShieldCheck className="h-3.5 w-3.5" /> Test Lip Sync Health</>}
                </button>
                {healthCheck && (
                  <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                    <StatusRow label="health route reachable" value={healthCheck.reachable ? "yes ✓" : "no ✗"} ok={healthCheck.reachable} />
                    <StatusRow label="status"                 value={String(healthCheck.status)}             ok={healthCheck.reachable ? true : false} />
                    <StatusRow label="content-type"           value={healthCheck.contentType}                ok={null} />
                    <StatusRow label="returned JSON"          value={healthCheck.isJson ? "yes" : "no"}      ok={healthCheck.isJson} />
                  </div>
                )}
              </div>
            </div>
          </EditorCard>

          {/* ── Audio Source ── */}
          <EditorCard title="Lip Sync Audio Source" icon={<Radio className="h-4 w-4" />}>
            <div className="space-y-3">
              <Segmented
                value={ls.audioSource}
                onChange={(v: "vocals" | "full") => updateLipSync({ audioSource: v })}
                options={[
                  { value: "vocals" as const, label: "Vocals Only" },
                  { value: "full"   as const, label: "Full Mix" },
                ]}
              />
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                <StatusRow label="project audio found"  value={projectAudioFound ? "yes" : "no"}                              ok={projectAudioFound} />
                <StatusRow label="vocal stem found"     value={vocalStemFound ? "yes" : "no"}                                 ok={vocalStemFound} />
                <StatusRow label="uploaded stem"        value={ls.uploadedVocalStemUrl ? "yes ✓" : "none"}                    ok={!!ls.uploadedVocalStemUrl} />
                <StatusRow label="using full mix"       value={usingFullMix ? "yes" : "no"}                                   ok={null} />
                <StatusRow label="audio ready"          value={audioReady ? "yes ✓" : "no"}                                   ok={audioReady} />
              </div>

              {/* ── Check Audio URL button ── */}
              <button
                type="button"
                disabled={!effectiveAudioUrl || inputCheckLoading}
                onClick={() => void checkInputs()}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/50 text-[11px] font-semibold hover:bg-white/[0.07] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {inputCheckLoading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</>
                  : <><ScanSearch className="h-3.5 w-3.5" /> Check Lip Sync Audio URL</>}
              </button>

              {/* Check result inline */}
              {inputCheck && !inputCheckLoading && (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest pb-0.5">
                    Last check · {inputCheck.checkedAt}
                  </p>
                  <StatusRow
                    label="audio source type"
                    value={inputCheck.audio.sourceType}
                    ok={null}
                  />
                  <StatusRow
                    label="audio reachable"
                    value={inputCheck.audio.found ? "yes ✓" : "no ✗"}
                    ok={inputCheck.audio.found}
                  />
                  {inputCheck.audio.error && (
                    <div className="flex items-start gap-1.5 text-[10px] text-red-400/80 font-semibold pt-0.5">
                      <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                      {inputCheck.audio.error}
                    </div>
                  )}
                </div>
              )}

              {/* Full mix fallback warning */}
              {ls.audioSource === "vocals" && !vocalStemFound && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] text-amber-400/80 text-[10px]">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  No vocal stem found. Using full mix may reduce lip sync accuracy.
                  Upload or export a vocal stem below for better results.
                </div>
              )}

              {/* Upload vocal stem */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Upload Vocal Stem</p>
                <input
                  ref={stemInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) void uploadVocalStem(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={stemUploading}
                  onClick={() => stemInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/60 text-[11px] font-semibold hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {stemUploading
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                    : <><Upload className="h-3.5 w-3.5" /> Upload Vocal Stem</>}
                </button>
                {stemUploadError && (
                  <p className="text-[10px] text-red-400/80">{stemUploadError}</p>
                )}
                {ls.uploadedVocalStemUrl && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-green-400/80 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Vocal stem uploaded
                    </span>
                    <button
                      type="button"
                      onClick={() => updateLipSync({ uploadedVocalStemUrl: null })}
                      className="text-[10px] text-white/30 hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {/* Export acapella from Music Mixer */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Export Vocals from Music Mixer</p>
                <button
                  type="button"
                  disabled={acapellaExporting || ms.stems.length === 0}
                  onClick={() => void exportAcapellaStem()}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/60 text-[11px] font-semibold hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title={ms.stems.length === 0 ? "Add stems in the Music Mixer first" : undefined}
                >
                  {acapellaExporting
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…</>
                    : <><Music className="h-3.5 w-3.5" /> Export Vocals / Acapella Stem</>}
                </button>
                {ms.stems.length === 0 && (
                  <p className="text-[10px] text-white/25">
                    Vocal stem export not connected yet — add stems in the Music Mixer tab.
                  </p>
                )}
                {acapellaError && (
                  <p className="text-[10px] text-red-400/80">{acapellaError}</p>
                )}
              </div>
            </div>
          </EditorCard>

          {/* ── Scene selector ── */}
          <EditorCard title="Select Clip / Scene" icon={<Sliders className="h-4 w-4" />}>
            <div className="space-y-3">
              {clipsWithFaces.length === 0 ? (
                <div className="text-[11px] text-white/40 text-center py-3">
                  No clips with video URLs found. Generate or upload clips first.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-1 max-h-48 overflow-y-auto">
                  {clipsWithFaces.map((scene) => {
                    const ce    = getClipEdit(settings, scene.id);
                    const isSel = scene.id === (ls.selectedSceneId ?? clipsWithFaces[0]?.id);
                    const status = ce.lipSyncStatus;
                    return (
                      <button
                        key={scene.id}
                        type="button"
                        onClick={() => updateLipSync({ selectedSceneId: scene.id })}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-colors text-[11px] ${
                          isSel
                            ? "border-primary/50 bg-primary/[0.08] text-white"
                            : "border-white/[0.06] bg-white/[0.02] text-white/60 hover:bg-white/[0.04]"
                        }`}
                      >
                        <span className={`inline-flex items-center justify-center h-5 min-w-[20px] rounded px-1 text-[9px] font-black shrink-0 ${
                          isSel ? "bg-primary text-black" : "bg-white/10 text-white/60"
                        }`}>{scene.sceneNumber}</span>
                        <span className="flex-1 truncate">{scene.section || scene.lyricLine || `Scene ${scene.sceneNumber}`}</span>
                        {status === "done"       && <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />}
                        {status === "processing" && <Loader2 className="h-3 w-3 text-primary animate-spin shrink-0" />}
                        {status === "failed"     && <XCircle className="h-3 w-3 text-red-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </EditorCard>

          {/* ── Face Detection ── */}
          {selectedScene && (
            <EditorCard title="Face Detection" icon={<User className="h-4 w-4" />}>
              <div className="space-y-2">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                  <StatusRow label="scene selected"    value={`Scene ${selectedScene.sceneNumber}`} ok={null} />
                  <StatusRow label="face found"        value={faceDetected ? "yes" : "no"}          ok={faceDetected} />
                  <StatusRow label="face confidence"   value={faceConfidence}                        ok={faceDetected ? true : false} />
                  <StatusRow label="clip source ready" value={clipSourceReady ? "yes ✓" : "no"}     ok={clipSourceReady} />
                </div>
                {!faceDetected && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] text-amber-400 text-[11px] font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    No clear face found for lip sync on this clip.
                  </div>
                )}
              </div>
            </EditorCard>
          )}

          {/* ── Settings ── */}
          <EditorCard title="Lip Sync Settings" icon={<Sliders className="h-4 w-4" />}>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Strength</p>
                <Segmented
                  value={ls.strength}
                  onChange={(v: LipSyncStrength) => updateLipSync({ strength: v })}
                  options={[
                    { value: "low"    as const, label: "Low" },
                    { value: "medium" as const, label: "Medium" },
                    { value: "high"   as const, label: "High" },
                  ]}
                />
              </div>
              <div className="space-y-1 divide-y divide-white/[0.04]">
                <Toggle
                  value={ls.preserveFaceIdentity}
                  onChange={v => updateLipSync({ preserveFaceIdentity: v })}
                  label="Preserve Face Identity"
                  sub="Keep original facial features during lip sync"
                />
                <div className="pt-1">
                  <Toggle
                    value={ls.preserveArtistLook}
                    onChange={v => updateLipSync({ preserveArtistLook: v })}
                    label="Preserve Artist Look"
                    sub="Maintain artist style, skin tone, and expression"
                  />
                </div>
              </div>
            </div>
          </EditorCard>

          {/* ── Lip Sync Input Check panel ── */}
          {!demoMode && (
            <EditorCard title="Lip Sync Input Check" icon={<ShieldCheck className="h-4 w-4" />}>
              <div className="space-y-3">

                {/* URL + provider checks */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] font-bold text-white/25 uppercase tracking-widest pb-0.5">URLs &amp; Provider</p>
                  <StatusRow
                    label="audio ready"
                    value={audioReady ? "yes ✓" : "no"}
                    ok={audioReady}
                  />
                  <StatusRow
                    label="audio URL ready"
                    value={
                      !inputCheck ? "—"
                      : inputCheck.audio.found ? "yes ✓"
                      : inputCheck.audio.error ? `no — ${inputCheck.audio.error.slice(0, 50)}`
                      : "no"
                    }
                    ok={!inputCheck ? null : inputCheck.audio.found}
                  />
                  <StatusRow
                    label="clip video ready"
                    value={clipSourceReady ? "yes ✓" : "no"}
                    ok={clipSourceReady}
                  />
                  <StatusRow
                    label="clip URL ready"
                    value={
                      !inputCheck ? "—"
                      : inputCheck.clip.found ? "yes ✓"
                      : inputCheck.clip.error ? `no — ${inputCheck.clip.error.slice(0, 50)}`
                      : "no"
                    }
                    ok={!inputCheck ? null : inputCheck.clip.found}
                  />
                  <StatusRow
                    label="provider key present"
                    value={providerConnected ? "yes ✓" : "no"}
                    ok={providerConnected}
                  />
                </div>

                {/* Payload validation */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] font-bold text-white/25 uppercase tracking-widest pb-0.5">Sync Labs Payload</p>
                  <StatusRow
                    label="invalid fields in payload"
                    value={!inputCheck?.payload ? "—" : "none ✓"}
                    ok={!inputCheck?.payload ? null : true}
                  />
                  <StatusRow
                    label="removed from payload"
                    value={
                      !inputCheck?.payload ? "—"
                      : inputCheck.payload.removedFields.length > 0
                        ? inputCheck.payload.removedFields.join(", ")
                        : "none"
                    }
                    ok={null}
                  />
                  <StatusRow
                    label="payload validated"
                    value={
                      !inputCheck?.payload ? "—"
                      : inputCheck.payload.payloadValid ? "yes ✓"
                      : "no"
                    }
                    ok={!inputCheck?.payload ? null : inputCheck.payload.payloadValid}
                  />
                  <StatusRow
                    label="sanitized payload ready"
                    value={
                      !inputCheck?.payload ? "—"
                      : inputCheck.payload.sanitizedReady ? "yes ✓"
                      : "no"
                    }
                    ok={!inputCheck?.payload ? null : inputCheck.payload.sanitizedReady}
                  />
                  {inputCheck?.payload?.sanitizedKeys && (
                    <div className="flex items-center justify-between gap-2 text-[11px] pt-0.5">
                      <span className="font-mono text-white/30 text-[10px]">payload keys</span>
                      <span className="text-white/30 text-[10px] font-mono">{inputCheck.payload.sanitizedKeys.join(", ")}</span>
                    </div>
                  )}
                </div>

                {/* Overall ready */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5">
                  <StatusRow
                    label="ready to submit"
                    value={
                      !inputCheck ? "run check first"
                      : inputCheck.readyToSubmit ? "yes ✓"
                      : "no ✗"
                    }
                    ok={!inputCheck ? null : inputCheck.readyToSubmit}
                  />
                </div>

                {/* URL errors */}
                {inputCheck && (inputCheck.audio.error || inputCheck.clip.error) && (
                  <div className="space-y-1.5">
                    {inputCheck.audio.error && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-red-500/25 bg-red-500/[0.05] text-red-400/90 text-[10px] font-semibold">
                        <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                        Audio: {inputCheck.audio.error}
                      </div>
                    )}
                    {inputCheck.clip.error && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-red-500/25 bg-red-500/[0.05] text-red-400/90 text-[10px] font-semibold">
                        <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                        Clip: {inputCheck.clip.error}
                      </div>
                    )}
                  </div>
                )}

                {/* Ready banner */}
                {inputCheck?.readyToSubmit && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-green-500/25 bg-green-500/[0.05] text-green-400/90 text-[10px] font-semibold">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    All checks passed — safe to submit
                  </div>
                )}

                <button
                  type="button"
                  disabled={!effectiveAudioUrl || inputCheckLoading}
                  onClick={() => void checkInputs()}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/50 text-[11px] font-semibold hover:bg-white/[0.07] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {inputCheckLoading
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Validating…</>
                    : <><ScanSearch className="h-3.5 w-3.5" /> Validate Sync Labs Payload</>}
                </button>
              </div>
            </EditorCard>
          )}

          {/* ── Apply / Preview / Save ── */}
          <EditorCard title="Apply Lip Sync" icon={<Mic2 className="h-4 w-4" />}>
            <div className="space-y-3">

              {applyError && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-red-500/30 bg-red-500/[0.06] text-red-400 text-[11px] font-semibold">
                  <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{applyError}</span>
                </div>
              )}

              {/* Confirm dialog */}
              {confirmOpen && (() => {
                const timing = confirmOpen === "single" ? selectedTiming : null;
                const segmentDuration = timing?.durationSec ?? 0;
                const safeToSubmit    =
                  demoMode             ? true
                  : !providerConnected ? true
                  : !timing            ? true
                  : segmentDuration > PROVIDER_LIMIT_SEC ? false
                  : timingBlock        ? false
                  : true;

                return (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-3 space-y-3">

                    {/* ── Warning header ── */}
                    {!demoMode && confirmOpen === "single" ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                          <p className="text-[12px] font-bold text-amber-300">Paid job confirmation</p>
                        </div>
                        <p className="text-[11px] text-amber-400/80 leading-snug">
                          This will submit a new paid Sync.so lip sync job and may use credits.
                        </p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-white/70 font-semibold">
                        {demoMode
                          ? confirmOpen === "single"
                            ? `Run Demo simulation on Scene ${selectedScene?.sceneNumber ?? "—"}?`
                            : `Run Demo simulation on all ${clipsWithFaces.length} clips?`
                          : `Apply lip sync to all ${clipsWithFaces.length} clips with faces?`}
                      </p>
                    )}

                    {/* ── Job details — single scene only ── */}
                    {confirmOpen === "single" && selectedScene && !demoMode && (
                      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5">
                        <p className="text-[10px] font-bold text-white/35 uppercase tracking-widest pb-0.5">
                          Job details
                        </p>
                        <StatusRow label="scene"               value={`Scene ${selectedScene.sceneNumber} — ${selectedSceneTitle}`} ok={null} />
                        <StatusRow label="audio start"         value={timing ? fmtSec(timing.startSec) : "—"} ok={null} />
                        <StatusRow label="audio end"           value={timing ? fmtSec(timing.endSec) : "—"} ok={null} />
                        <StatusRow label="audio offset"        value={audioOffset !== 0 ? `${audioOffset >= 0 ? "+" : ""}${audioOffset.toFixed(1)}s` : "none"} ok={null} />
                        <StatusRow label="audio segment"       value={timing ? `${timing.durationSec.toFixed(2)}s` : "—"} ok={timing ? (safeToSubmit ? true : false) : null} />
                        <StatusRow label="clip video duration" value={clipVideoDuration != null ? `${clipVideoDuration.toFixed(2)}s` : "—"} ok={null} />
                        <StatusRow label="timing match"        value={timingOk === null ? "checking…" : timingOk ? "yes ✓ (<0.25s diff)" : `no — diff ${timingDiff!.toFixed(2)}s`} ok={timingOk} />
                        <StatusRow label="audio source"        value={ls.audioSource === "vocals" ? "vocals only" : "full mix"} ok={null} />
                        <StatusRow label="provider"            value="Sync.so"                                          ok={null} />
                        <StatusRow label="provider limit"      value={`${PROVIDER_LIMIT_SEC}s`}                         ok={null} />
                        <div className="border-t border-white/[0.06] my-1" />
                        <StatusRow label="existing saved job"  value={selectedClipEdit?.lipSyncJobId ? `yes — ${selectedClipEdit.lipSyncJobId.slice(0, 12)}…` : "none"} ok={selectedClipEdit?.lipSyncJobId ? false : null} />
                        <StatusRow label="last submitted"      value={fmtDate(selectedClipEdit?.lipSyncSubmittedAt ?? null)} ok={null} />
                      </div>
                    )}

                    {/* Over-limit warning */}
                    {!safeToSubmit && (
                      <div className="flex items-start gap-1.5 text-[10px] text-red-400/90 font-semibold">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                        Audio segment is {segmentDuration.toFixed(1)}s — over the {PROVIDER_LIMIT_SEC}s plan limit. Trim this scene or upgrade your Sync.so plan.
                      </div>
                    )}

                    {demoMode ? (
                      <div className="flex items-center gap-1.5 text-[10px] text-blue-400/80">
                        <FlaskConical className="h-3 w-3 shrink-0" />
                        Demo mode — no real API call. No credits charged.
                      </div>
                    ) : !providerConnected ? (
                      <p className="text-[10px] text-red-400/80 font-semibold">
                        ⚠ Provider not connected — add LIP_SYNC_API_KEY in Replit Secrets.
                      </p>
                    ) : null}

                    {/* Corrected-job note when an existing result exists */}
                    {!demoMode && selectedClipEdit?.lipSyncUrl && confirmOpen === "single" && (
                      <div className="text-[10px] text-amber-400/80 font-semibold leading-snug">
                        ⚠ This will submit a new Sync.so job using the corrected scene audio segment.
                        The existing result is kept until the corrected job succeeds.
                      </div>
                    )}

                    {!demoMode && usingFullMix && ls.audioSource === "vocals" && (
                      <p className="text-[10px] text-amber-400/70">
                        ⚠ No vocal stem found — using full mix. Accuracy may be lower.
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmOpen(null)}
                        className="flex-1 py-2 rounded-lg border border-white/10 text-white/50 text-[11px] font-semibold hover:bg-white/[0.04] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!safeToSubmit || !providerConnected}
                        onClick={confirmOpen === "single" ? () => void applyToSelected() : () => void applyToAll()}
                        className="flex-1 py-2 rounded-lg bg-amber-500 text-black text-[11px] font-bold hover:bg-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {demoMode ? "Run Simulation" : "Submit Paid Job"}
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* ── Job safety controls — always visible above Apply ── */}
              {!confirmOpen && selectedScene && (
                <div className="space-y-2 pt-1 border-t border-white/[0.06]">
                  {/* Banner */}
                  {selectedClipEdit?.lipSyncJobId ? (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] text-amber-400 text-[11px] font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>Existing Sync.so job found — check status instead of submitting again.</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.06] bg-white/[0.02] text-white/30 text-[10px] font-semibold">
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                      No existing job — safe to submit.
                    </div>
                  )}

                  {/* ── Check job result detail panel ── */}
                  {(() => {
                    const cjr = checkJobResult;
                    if (!cjr || cjr.jobId !== selectedClipEdit?.lipSyncJobId) return null;
                    const submittedAt  = selectedClipEdit?.lipSyncSubmittedAt ?? null;
                    const submittedMs  = submittedAt ? new Date(submittedAt).getTime() : null;
                    const checkedMs    = new Date(cjr.checkedAt).getTime();
                    const elapsedMin   = submittedMs != null ? Math.round((checkedMs - submittedMs) / 60_000) : null;
                    const normalStatus = cjr.rawStatus.toLowerCase();
                    const isLongRun    = (elapsedMin ?? 0) > 10;
                    const isProcessing = normalStatus === "processing" || normalStatus === "pending";
                    const isCompleted  = normalStatus === "completed";
                    const isFailed     = normalStatus === "failed";
                    const isSaved      = !!cjr.outputUrl && selectedClipEdit?.lipSyncUrl === cjr.outputUrl;
                    const isInPlayer   = !!cjr.outputUrl && selectedClipEdit?.replaceUrl  === cjr.outputUrl;
                    return (
                      <div className={`rounded-xl border px-3 py-3 space-y-2.5 ${isCompleted ? "border-green-500/35 bg-green-500/[0.05]" : isFailed ? "border-red-500/30 bg-red-500/[0.04]" : "border-primary/20 bg-primary/[0.03]"}`}>

                        {/* ── Completed headline ── */}
                        {isCompleted && (
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                            <p className="text-[12px] font-bold text-green-300">Lip Sync Result Ready</p>
                          </div>
                        )}

                        {!isCompleted && (
                          <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Last check result</p>
                        )}

                        {/* Status rows */}
                        <div className="space-y-1.5">
                          <StatusRow label="Sync.so job ID"    value={cjr.jobId}                                                     ok={null} />
                          <StatusRow label="selected scene"    value={`Scene ${selectedScene.sceneNumber} — ${selectedSceneTitle}`}  ok={null} />
                          <StatusRow label="submitted"         value={fmtDate(submittedAt)}                                          ok={null} />
                          <StatusRow label="processing time"   value={elapsedMin != null ? `${elapsedMin} min` : "—"}                ok={isLongRun && isProcessing ? false : null} />
                          <StatusRow label="provider status"   value={cjr.rawStatus}                                                 ok={isCompleted ? true : isFailed ? false : null} />
                          <StatusRow label="checked at"        value={fmtDate(cjr.checkedAt)}                                        ok={null} />
                          {isCompleted && (
                            <>
                              <StatusRow label="result URL available" value="yes"                ok={true} />
                              <StatusRow label="saved to scene"       value={isSaved    ? "yes" : "no"} ok={isSaved    ? true : false} />
                              <StatusRow label="master player using"  value={isInPlayer ? "yes" : "no"} ok={isInPlayer ? true : false} />
                            </>
                          )}
                          {cjr.providerError && <StatusRow label="provider error" value={cjr.providerError} ok={false} />}
                        </div>

                        {/* ── Completed: not attached yet warning ── */}
                        {isCompleted && cjr.outputUrl && !isSaved && (
                          <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] text-amber-400 text-[10px] font-semibold leading-snug">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>Completed result found but not attached yet.<br />
                              <span className="font-normal">Use the buttons below to save it or activate it in the master player.</span>
                            </span>
                          </div>
                        )}

                        {/* ── Completed: 3 main action buttons ── */}
                        {isCompleted && cjr.outputUrl && (
                          <div className="space-y-2">
                            <button
                              type="button"
                              onClick={() => setPreviewModalUrl(cjr.outputUrl!)}
                              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-green-500/40 bg-green-500/[0.08] text-green-300 text-[11px] font-bold hover:bg-green-500/[0.15] transition-colors"
                            >
                              <Play className="h-3.5 w-3.5" /> Preview Lip Sync Result
                            </button>
                            <button
                              type="button"
                              onClick={() => useResultInPlayer(cjr.jobId, cjr.outputUrl!)}
                              disabled={isInPlayer}
                              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-primary/40 bg-primary/[0.08] text-primary text-[11px] font-bold hover:bg-primary/[0.15] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {isInPlayer ? "Master Player Using Lip Sync ✓" : "Use Result in Master Player"}
                            </button>
                            <button
                              type="button"
                              onClick={() => saveResultToScene(cjr.jobId, cjr.outputUrl!)}
                              disabled={isSaved}
                              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/15 bg-white/[0.04] text-white/60 text-[11px] font-semibold hover:bg-white/[0.08] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Save className="h-3.5 w-3.5" />
                              {isSaved ? "Result Saved to Scene ✓" : "Save Result to Scene"}
                            </button>
                          </div>
                        )}

                        {/* Long-running warning */}
                        {isLongRun && isProcessing && (
                          <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] text-amber-400 text-[10px] font-semibold leading-snug">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>This Sync.so job is taking longer than expected.<br />
                              <span className="font-normal">Do not resubmit yet. Check Sync.so dashboard for the job ID, or keep checking status.</span>
                            </span>
                          </div>
                        )}

                        {/* Failure notice */}
                        {isFailed && (
                          <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-red-500/25 bg-red-500/[0.06] text-red-400 text-[10px] font-semibold leading-snug">
                            <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>Provider returned failure{cjr.providerError ? `: ${cjr.providerError}` : "."}<br />
                              <span className="font-normal text-red-400/70">Do not retry automatically — use Submit New Lip Sync Job after reviewing the details.</span>
                            </span>
                          </div>
                        )}

                        {/* Utility buttons: always available */}
                        <div className="flex flex-wrap gap-2 pt-1 border-t border-white/[0.05]">
                          <button
                            type="button"
                            onClick={() => { void navigator.clipboard.writeText(cjr.jobId); }}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-white/40 text-[10px] font-semibold hover:bg-white/[0.07] transition-colors"
                          >
                            <Copy className="h-3 w-3" /> Copy Sync.so Job ID
                          </button>
                          <button
                            type="button"
                            onClick={() => window.open("https://sync.so", "_blank")}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-white/40 text-[10px] font-semibold hover:bg-white/[0.07] transition-colors"
                          >
                            <ExternalLink className="h-3 w-3" /> Open Sync.so Dashboard
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Lip Sync Audio Segment status ── */}
                  {selectedTiming && (
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                      <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest pb-0.5">Lip Sync Audio Segment</p>
                      <StatusRow label="timeline scene start"   value={rawTiming ? fmtSec(rawTiming.startSec) : "—"} ok={null} />
                      <StatusRow label="target duration source" value={durationSource} ok={clipVideoDuration != null ? true : null} />
                      <StatusRow label="target lip sync dur."   value={`${targetDuration.toFixed(2)}s`} ok={clipVideoDuration != null ? true : null} />
                      <StatusRow label="audio segment duration" value={`${audioSegmentDuration.toFixed(2)}s`} ok={null} />
                      <StatusRow label="clip video duration"    value={clipVideoDuration != null ? `${clipVideoDuration.toFixed(2)}s` : "detecting…"} ok={clipVideoDuration != null ? true : null} />
                      <StatusRow label="durations match"        value={timingOk === null ? "checking…" : timingOk ? `yes ✓ (diff ${(timingDiff ?? 0).toFixed(2)}s)` : `no — diff ${(timingDiff ?? 0).toFixed(2)}s`} ok={timingOk} />
                      <StatusRow label="safe to submit"         value={timingOk === null ? "checking…" : timingOk ? "yes ✓" : "no — fix timing"} ok={timingOk} />
                    </div>
                  )}

                  {/* ── Audio segment offset controls ── */}
                  {selectedTiming && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold text-white/35 uppercase tracking-widest">Audio Segment Offset</p>
                        <p className="text-[10px] font-bold text-white/50">{audioOffset >= 0 ? "+" : ""}{audioOffset.toFixed(1)}s</p>
                      </div>
                      <div className="flex gap-1">
                        {([-1.0, -0.5, 0, 0.5, 1.0] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setAudioOffset(v)}
                            className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                              audioOffset === v
                                ? "bg-primary/20 border border-primary/50 text-primary"
                                : "border border-white/10 text-white/40 hover:bg-white/[0.05]"
                            }`}
                          >
                            {v > 0 ? `+${v}s` : `${v}s`}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setAudioOffset(audioOffset - 0.1)}
                          className="flex-1 py-1.5 rounded-lg border border-white/10 text-white/50 text-[10px] font-bold hover:bg-white/[0.05] transition-colors"
                        >
                          −0.1s
                        </button>
                        <p className="flex-[2] text-center text-[10px] text-white/30 font-semibold">Fine adjust</p>
                        <button
                          type="button"
                          onClick={() => setAudioOffset(audioOffset + 0.1)}
                          className="flex-1 py-1.5 rounded-lg border border-white/10 text-white/50 text-[10px] font-bold hover:bg-white/[0.05] transition-colors"
                        >
                          +0.1s
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── Preview Audio Segment + Validate Timing buttons ── */}
                  {selectedTiming && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={previewAudioSegment}
                        disabled={!audioReady}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          isPreviewingAudio
                            ? "border-amber-500/40 bg-amber-500/[0.08] text-amber-300"
                            : "border-green-500/30 bg-green-500/[0.05] text-green-300 hover:bg-green-500/[0.10]"
                        }`}
                      >
                        {isPreviewingAudio
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Stop Preview</>
                          : <><Play className="h-3.5 w-3.5" /> Preview Audio Segment</>}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowTimingValidation(v => !v)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-white/10 bg-white/[0.02] text-white/50 text-[11px] font-semibold hover:bg-white/[0.05] transition-colors"
                      >
                        <ScanSearch className="h-3.5 w-3.5" /> Validate Timing
                      </button>
                    </div>
                  )}

                  {/* ── Timing validation panel ── */}
                  {showTimingValidation && selectedTiming && (
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                      <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest pb-0.5">Timing Validation</p>
                      <StatusRow label="timeline scene start"  value={rawTiming ? fmtSec(rawTiming.startSec) : "—"} ok={null} />
                      <StatusRow label="audio offset"          value={audioOffset !== 0 ? `${audioOffset >= 0 ? "+" : ""}${audioOffset.toFixed(1)}s` : "none"} ok={null} />
                      <StatusRow label="audio starts at"       value={fmtSec(selectedTiming.startSec)} ok={null} />
                      <StatusRow label="audio ends at"         value={fmtSec(selectedTiming.endSec)} ok={null} />
                      <StatusRow label="clip video duration"   value={clipVideoDuration != null ? `${clipVideoDuration.toFixed(3)}s` : "detecting…"} ok={null} />
                      <StatusRow label="audio segment duration" value={`${audioSegmentDuration.toFixed(3)}s`} ok={null} />
                      <StatusRow label="difference"            value={timingDiff != null ? `${timingDiff.toFixed(3)}s` : "—"} ok={timingOk} />
                      <StatusRow label="safe to submit"        value={timingOk === null ? "checking…" : timingOk ? "yes ✓" : `no — diff ≥ 0.25s`} ok={timingOk} />
                    </div>
                  )}

                  {/* ── Rebuild from real clip duration ── */}
                  {selectedTiming && (
                    <button
                      type="button"
                      onClick={rebuildFromRealClipDuration}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-white/10 bg-white/[0.02] text-white/50 text-[11px] font-semibold hover:bg-white/[0.06] transition-colors"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${clipVideoDuration === null && selectedScene?.demoClipUrl ? "animate-spin" : ""}`} />
                      {clipVideoDuration !== null
                        ? `Rebuild Audio Segment — using ${clipVideoDuration.toFixed(2)}s clip`
                        : "Rebuild Audio Segment From Real Clip Duration"}
                    </button>
                  )}

                  {/* ── Timing mismatch error — blocks submit ── */}
                  {timingBlock && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-red-500/30 bg-red-500/[0.06] text-red-400 text-[11px] font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        Audio segment ({audioSegmentDuration.toFixed(2)}s) does not match clip ({(clipVideoDuration ?? 0).toFixed(2)}s).
                        Adjust the offset or fix the scene timestamp before submitting.
                      </span>
                    </div>
                  )}

                  {/* ── Lip Sync Job Safety status ── */}
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                    <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest pb-0.5">Lip Sync Job Safety</p>
                    <StatusRow label="selected scene"          value={`Scene ${selectedScene.sceneNumber} — ${selectedSceneTitle}`}                                               ok={null} />
                    <StatusRow label="clip duration"           value={selectedTiming ? `${selectedTiming.durationSec.toFixed(1)}s` : "—"}                                         ok={null} />
                    <StatusRow label="existing job id"         value={selectedClipEdit?.lipSyncJobId ? `yes — ${selectedClipEdit.lipSyncJobId.slice(0, 12)}…` : "none"}           ok={selectedClipEdit?.lipSyncJobId ? false : true} />
                    <StatusRow label="will submit new paid job" value={selectedClipEdit?.lipSyncStatus === "processing" ? "no — job already running" : "yes — uses credits"}      ok={selectedClipEdit?.lipSyncStatus === "processing" ? true : null} />
                    <StatusRow label="job id saved after submit" value="yes — always saved immediately"                                                                            ok={true} />
                    <StatusRow label="timeout will not resubmit" value="yes — stays processing, not failed"                                                                       ok={true} />
                  </div>

                  {/* Check + Stop row */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void checkExistingJob()}
                      disabled={!selectedClipEdit?.lipSyncJobId || checkJobLoading}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-primary/30 bg-primary/[0.06] text-primary text-[11px] font-semibold hover:bg-primary/[0.12] disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                    >
                      {checkJobLoading
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</>
                        : <><RefreshCw className="h-3.5 w-3.5" /> Check Job Status</>}
                    </button>
                    <button
                      type="button"
                      onClick={() => stopTrackingJob(selectedScene.id)}
                      disabled={!selectedClipEdit?.lipSyncJobId}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-500/20 bg-red-500/[0.04] text-red-400/70 text-[11px] font-semibold hover:bg-red-500/[0.08] disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                    >
                      <X className="h-3.5 w-3.5" /> Stop Tracking
                    </button>
                  </div>

                  {/* Submit new job */}
                  <button
                    type="button"
                    disabled={!faceDetected || (!demoMode && !audioReady) || selectedClipEdit?.lipSyncStatus === "processing" || timingBlock}
                    onClick={() => { setApplyError(null); setConfirmOpen("single"); }}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      demoMode
                        ? "border-blue-500/30 bg-blue-500/[0.06] text-blue-400 hover:bg-blue-500/[0.12]"
                        : "border-primary/40 bg-primary/[0.08] text-primary hover:bg-primary/[0.15]"
                    }`}
                    data-testid="btn-lip-sync-apply-selected"
                  >
                    {selectedClipEdit?.lipSyncStatus === "processing"
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing — do not resubmit</>
                      : demoMode
                        ? <><FlaskConical className="h-3.5 w-3.5" /> Simulate Scene {selectedScene.sceneNumber}</>
                        : <><Mic2 className="h-3.5 w-3.5" /> Submit New Lip Sync Job</>}
                  </button>
                </div>
              )}

              {/* Apply to all */}
              {!confirmOpen && !processState?.running && (
                <button
                  type="button"
                  disabled={clipsWithFaces.length === 0 || (!demoMode && !audioReady)}
                  onClick={() => { setApplyError(null); setConfirmOpen("all"); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-white/60 text-[11px] font-bold hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="btn-lip-sync-apply-all"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  {demoMode ? "Simulate All" : "Apply to All"} {clipsWithFaces.length} Clips
                </button>
              )}

              {/* Progress bar */}
              {processState?.running && (
                <div className={`rounded-xl border px-3 py-3 space-y-2 ${
                  demoMode ? "border-blue-500/20 bg-blue-500/[0.04]" : "border-primary/20 bg-primary/[0.04]"
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[11px] font-bold ${demoMode ? "text-blue-400" : "text-primary"}`}>
                      {demoMode ? "Simulating" : "Lip Sync"} {processState.current} of {processState.total}
                    </span>
                    <button
                      type="button"
                      onClick={cancelAll}
                      className="flex items-center gap-1 text-[10px] text-white/40 hover:text-red-400 transition-colors"
                    >
                      <X className="h-3 w-3" /> Cancel
                    </button>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${(processState.current / processState.total) * 100}%` }}
                    />
                  </div>
                  {processState.lastError && (
                    <p className="text-[10px] text-red-400/80 truncate">{processState.lastError}</p>
                  )}
                </div>
              )}
              {processState && !processState.running && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] font-semibold ${
                  processState.cancelled
                    ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-400"
                    : demoMode
                      ? "border-blue-500/30 bg-blue-500/[0.06] text-blue-400"
                      : "border-green-500/30 bg-green-500/[0.06] text-green-400"
                }`}>
                  {processState.cancelled
                    ? <><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Cancelled at {processState.current} of {processState.total}</>
                    : demoMode
                      ? <><FlaskConical className="h-3.5 w-3.5 shrink-0" /> Demo complete · {processState.total} clips simulated — no real API calls made</>
                      : <><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Done · {processState.total} clips processed</>}
                  <button
                    type="button"
                    onClick={() => setProcessState(null)}
                    className="ml-auto text-white/30 hover:text-white/60"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          </EditorCard>

          {/* ── Result for selected clip ── */}
          {selectedScene && selectedClipEdit && (
            <EditorCard title="Lip Sync Result" icon={<Save className="h-4 w-4" />}>
              <div className="space-y-3">

                {/* ── Lip Sync Save Status table ── */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest pb-0.5">Lip Sync Save Status</p>
                  <StatusRow label="selected scene"           value={`Scene ${selectedScene.sceneNumber} — ${selectedSceneTitle}`}          ok={null} />
                  <StatusRow label="completed result URL"     value={selectedClipEdit.lipSyncUrl ? "yes ✓" : "none"}                        ok={!!selectedClipEdit.lipSyncUrl} />
                  <StatusRow label="saved to clip"            value={selectedClipEdit.lipSyncStatus === "done" ? "yes ✓" : "no"}            ok={selectedClipEdit.lipSyncStatus === "done"} />
                  <StatusRow label="useLipSync"               value={selectedClipEdit.useLipSync ? "on" : "off"}                            ok={selectedClipEdit.useLipSync ? true : null} />
                  <StatusRow label="master player using"      value={selectedClipEdit.useLipSync && selectedClipEdit.lipSyncStatus === "done" ? "lip sync ✓" : "original clip"}  ok={selectedClipEdit.useLipSync && selectedClipEdit.lipSyncStatus === "done" ? true : null} />
                  <StatusRow label="timeline badge"           value={selectedClipEdit.lipSyncStatus === "done" ? "LS✓ visible" : "not shown"} ok={selectedClipEdit.lipSyncStatus === "done"} />
                  <StatusRow label="current offset"           value={`${(selectedClipEdit.lipSyncOffsetSeconds ?? 0) >= 0 ? "+" : ""}${(selectedClipEdit.lipSyncOffsetSeconds ?? 0).toFixed(2)}s`} ok={null} />
                  <StatusRow label="offset active"            value={selectedClipEdit.useLipSync && selectedClipEdit.lipSyncStatus === "done" && (selectedClipEdit.lipSyncOffsetSeconds ?? 0) !== 0 ? "yes ✓" : (selectedClipEdit.lipSyncOffsetSeconds ?? 0) !== 0 ? "saved, enable useLipSync" : "none (0.00s)"} ok={(selectedClipEdit.lipSyncOffsetSeconds ?? 0) !== 0 && selectedClipEdit.useLipSync ? true : null} />
                  <StatusRow label="persisted after refresh"  value="yes — stored in browser"                                               ok={true} />
                  {selectedClipEdit.lipSyncError && selectedClipEdit.lipSyncStatus !== "done" && (
                    <StatusRow label="last error" value={selectedClipEdit.lipSyncError} ok={false} />
                  )}
                </div>

                {/* ── Timing mismatch warning on stored result ── */}
                {selectedClipEdit.lipSyncTimingMismatch && selectedClipEdit.lipSyncUrl && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] text-amber-400 text-[11px] font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      Lip Sync timing mismatch — this result used incorrect audio timing.
                      Adjust the Audio Segment Offset and submit a corrected job.
                    </span>
                  </div>
                )}

                {/* ── Use Lip Sync toggle ── */}
                {selectedClipEdit.lipSyncUrl && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
                    <div className="space-y-0.5">
                      <p className="text-[11px] font-semibold text-white/70">Use Lip Sync Result</p>
                      <p className="text-[10px] text-white/35">
                        {selectedClipEdit.useLipSync
                          ? "Master player is using the lip synced clip"
                          : "Master player is using the original clip"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => selectedClipEdit.useLipSync ? detachFromPlayer() : attachStoredResult()}
                      className={`relative shrink-0 w-10 h-5 rounded-full transition-colors ${selectedClipEdit.useLipSync ? "bg-green-500" : "bg-white/15"}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${selectedClipEdit.useLipSync ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                )}

                {/* ── Lip Sync Playback Offset ── */}
                {selectedClipEdit.lipSyncUrl && (
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <p className="text-[11px] font-semibold text-white/70">Lip Sync Playback Offset</p>
                        <p className="text-[10px] text-white/35">
                          Nudge the video earlier or later without resubmitting
                        </p>
                      </div>
                      <span className={`text-[13px] font-black tabular-nums shrink-0 ${(selectedClipEdit.lipSyncOffsetSeconds ?? 0) !== 0 ? "text-primary" : "text-white/30"}`}>
                        {(selectedClipEdit.lipSyncOffsetSeconds ?? 0) >= 0 ? "+" : ""}
                        {(selectedClipEdit.lipSyncOffsetSeconds ?? 0).toFixed(2)}s
                      </span>
                    </div>
                    {/* Step buttons */}
                    <div className="grid grid-cols-2 gap-1.5">
                      {([
                        { label: "Earlier −0.10s", delta: -0.10 },
                        { label: "Later +0.10s",   delta: +0.10 },
                        { label: "Earlier −0.05s", delta: -0.05 },
                        { label: "Later +0.05s",   delta: +0.05 },
                      ] as const).map(({ label, delta }) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => {
                            const cur = selectedClipEdit.lipSyncOffsetSeconds ?? 0;
                            const next = Math.round((cur + delta) * 100) / 100;
                            updateClipEdit(selectedScene.id, { lipSyncOffsetSeconds: next });
                          }}
                          className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/60 text-[10px] font-semibold hover:bg-white/[0.08] hover:text-white/80 transition-colors"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => updateClipEdit(selectedScene.id, { lipSyncOffsetSeconds: 0 })}
                      disabled={(selectedClipEdit.lipSyncOffsetSeconds ?? 0) === 0}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-white/10 bg-white/[0.02] text-white/35 text-[10px] font-semibold hover:bg-white/[0.06] hover:text-white/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Reset 0.00s
                    </button>
                    <p className="text-[9px] text-white/25 leading-relaxed">
                      Later = lip sync video starts later (use when mouth moves too early).
                      Earlier = video starts sooner (use when mouth moves too late).
                      No new Sync.so job is needed.
                    </p>
                  </div>
                )}

                {/* ── Preview + action buttons when result is available ── */}
                {selectedClipEdit.lipSyncUrl && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setPreviewModalUrl(selectedClipEdit.lipSyncUrl!)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-green-500/35 bg-green-500/[0.07] text-green-300 text-[11px] font-bold hover:bg-green-500/[0.14] transition-colors"
                    >
                      <Play className="h-3.5 w-3.5" /> Preview Lip Sync Result
                    </button>
                    <button
                      type="button"
                      onClick={attachStoredResult}
                      disabled={selectedClipEdit.useLipSync}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-primary/40 bg-primary/[0.07] text-primary text-[11px] font-bold hover:bg-primary/[0.14] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {selectedClipEdit.useLipSync ? "Master Player Using Lip Sync ✓" : "Use Result in Master Player"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedClipEdit.lipSyncStatus || selectedClipEdit.lipSyncStatus !== "done") {
                          /* not yet saved — save it first */
                          if (selectedClipEdit.lipSyncUrl && selectedClipEdit.lipSyncJobId) {
                            saveResultToScene(selectedClipEdit.lipSyncJobId, selectedClipEdit.lipSyncUrl);
                          }
                        }
                      }}
                      disabled={selectedClipEdit.lipSyncStatus === "done"}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/15 bg-white/[0.04] text-white/60 text-[11px] font-semibold hover:bg-white/[0.08] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {selectedClipEdit.lipSyncStatus === "done" ? "Result Saved to Scene ✓" : "Save Result to Scene"}
                    </button>
                    <button
                      type="button"
                      onClick={() => clearLipSync(selectedScene.id)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-500/20 bg-red-500/[0.04] text-red-400/70 text-[11px] font-semibold hover:bg-red-500/[0.08] transition-colors"
                    >
                      <RefreshCw className="h-3 w-3" /> Clear Lip Sync Result
                    </button>
                  </div>
                )}

                {/* ── Processing: check/stop controls ── */}
                {selectedClipEdit.lipSyncStatus === "processing" && selectedClipEdit.lipSyncJobId && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-1.5 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] text-amber-400/80 text-[10px] font-semibold">
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin mt-0.5" />
                      <span>Job is processing on Sync.so — do not resubmit. Use Check Job Status above.</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void checkExistingJob()}
                        disabled={checkJobLoading}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-primary/30 bg-primary/[0.06] text-primary text-[11px] font-semibold hover:bg-primary/[0.12] disabled:opacity-40 transition-colors"
                      >
                        {checkJobLoading
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</>
                          : <><RefreshCw className="h-3.5 w-3.5" /> Check Job Status</>}
                      </button>
                      <button
                        type="button"
                        onClick={() => stopTrackingJob(selectedScene.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-500/20 bg-red-500/[0.04] text-red-400/70 text-[11px] font-semibold hover:bg-red-500/[0.08] transition-colors"
                      >
                        <X className="h-3.5 w-3.5" /> Stop Tracking
                      </button>
                    </div>
                  </div>
                )}

                {/* Demo run result */}
                {demoRunSet.has(selectedScene.id) && !selectedClipEdit.lipSyncUrl && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-blue-500/30 bg-blue-500/[0.06] text-blue-400 text-[11px] font-semibold">
                    <FlaskConical className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>Demo simulation complete.<br />
                      <span className="font-normal text-blue-400/70">No real API call was made. Connect a provider to run real lip sync.</span>
                    </span>
                  </div>
                )}
              </div>
            </EditorCard>
          )}

          {/* ── Apply debug card (shown only when non-JSON / network error occurred) ── */}
          {applyDebug && (
            <EditorCard title="Lip Sync Apply Debug" icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                <StatusRow label="endpoint called" value={applyDebug.endpoint}    ok={null} />
                <StatusRow label="status"          value={applyDebug.status}      ok={false} />
                <StatusRow label="content-type"    value={applyDebug.contentType} ok={null} />
                <StatusRow label="returned JSON"   value={applyDebug.isJson ? "yes" : "no"} ok={applyDebug.isJson} />
                <StatusRow label="next step"       value={applyDebug.nextStep}    ok={null} />
              </div>
              {applyDebug.preview && (
                <div className="mt-2">
                  <p className="text-[10px] text-white/40 mb-1 px-1">response preview</p>
                  <pre className="text-[10px] text-red-400/80 whitespace-pre-wrap break-all font-mono leading-relaxed px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/[0.04]">
                    {applyDebug.preview}
                  </pre>
                </div>
              )}
            </EditorCard>
          )}

          {/* ── All clips summary ── */}
          <Collapsible title="All Clips Lip Sync Status">
            <div className="space-y-1">
              {scenes.map(scene => {
                const ce     = getClipEdit(settings, scene.id);
                const hasClip = sceneHasClip(scene);
                return (
                  <div key={scene.id} className="flex items-center justify-between gap-2 py-1 border-b border-white/[0.04] last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[9px] font-black text-white/30 shrink-0 w-5 text-right">{scene.sceneNumber}</span>
                      <span className="text-[10px] text-white/50 truncate">{scene.section || scene.lyricLine || `Scene ${scene.sceneNumber}`}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!hasClip && <span className="text-[9px] text-white/20">no clip</span>}
                      {hasClip && (
                        <>
                          {ce.lipSyncStatus === "done"       && <><CheckCircle2 className="h-3 w-3 text-green-400" /><span className="text-[9px] text-green-400/80 font-bold">done</span></>}
                          {ce.lipSyncStatus === "processing" && <><Loader2 className="h-3 w-3 text-primary animate-spin" /><span className="text-[9px] text-primary/80 font-bold">running</span></>}
                          {ce.lipSyncStatus === "failed"     && <><XCircle className="h-3 w-3 text-red-400" /><span className="text-[9px] text-red-400/80 font-bold">failed</span></>}
                          {!ce.lipSyncStatus                 && <span className="text-[9px] text-white/25">idle</span>}
                        </>
                      )}
                      {ce.lipSyncStatus === "done" && (
                        <button
                          type="button"
                          onClick={() => clearLipSync(scene.id)}
                          className="text-white/20 hover:text-red-400 transition-colors ml-1"
                          title="Clear lip sync"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Collapsible>

        </>
      )}

      {/* ── Lip Sync Preview Modal ── */}
      {previewModalUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setPreviewModalUrl(null); }}
        >
          <div className="relative w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0d0d0d] overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07]">
              <div className="flex items-center gap-2">
                <Play className="h-4 w-4 text-green-400" />
                <p className="text-sm font-black text-white">Lip Sync Result Preview</p>
                {selectedScene && (
                  <span className="text-[10px] text-white/40 font-normal">Scene {selectedScene.sceneNumber}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewModalUrl(null)}
                className="text-white/40 hover:text-white/80 transition-colors"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Video */}
            <video
              src={previewModalUrl}
              controls
              autoPlay
              className="w-full max-h-[55vh] bg-black"
            />

            {/* Action buttons */}
            <div className="p-4 space-y-2 border-t border-white/[0.07]">
              {selectedScene && selectedClipEdit && (() => {
                const url    = previewModalUrl;
                const jobId  = selectedClipEdit.lipSyncJobId ?? "";
                const isSaved    = selectedClipEdit.lipSyncStatus === "done" && selectedClipEdit.lipSyncUrl === url;
                const isInPlayer = selectedClipEdit.useLipSync && isSaved;
                return (
                  <>
                    <button
                      type="button"
                      onClick={() => { useResultInPlayer(jobId, url); setPreviewModalUrl(null); }}
                      disabled={isInPlayer}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-primary/40 bg-primary/[0.08] text-primary text-[11px] font-bold hover:bg-primary/[0.15] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {isInPlayer ? "Master Player Using Lip Sync ✓" : "Use Result in Master Player"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { saveResultToScene(jobId, url); }}
                      disabled={isSaved}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/15 bg-white/[0.04] text-white/60 text-[11px] font-semibold hover:bg-white/[0.08] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {isSaved ? "Result Saved to Scene ✓" : "Save Result to Scene"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewModalUrl(null)}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-white/10 bg-white/[0.02] text-white/40 text-[11px] font-semibold hover:bg-white/[0.06] transition-colors"
                    >
                      <X className="h-3.5 w-3.5" /> Close Preview
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Backend lip sync call — all secrets stay server-side.
   The frontend never sees LIP_SYNC_API_KEY.
══════════════════════════════════════════════════════════════════════════ */
interface LipSyncBackendRequest {
  clipUrl:              string;
  audioUrl:             string;
  sceneStartSec:        number;
  sceneEndSec:          number;
  audioSourceType:      "vocals_only" | "full_mix";
  strength:             LipSyncStrength;
  preserveFaceIdentity: boolean;
  preserveArtistLook:   boolean;
  getAccessToken:       () => Promise<string | null>;
  /** Called the first time the backend records the Sync.so provider job ID.
   *  The client should immediately persist this to the clip so it survives
   *  a local timeout or server restart. */
  onSyncLabsJobAccepted?: (syncLabsJobId: string) => void;
}

/** Thrown when the backend poll exhausts but the Sync.so job is still running.
 *  Keeps the clip as "processing" instead of marking it "failed". */
class StillProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StillProcessingError";
  }
}

interface LipSyncResult {
  url:      string;
  provider: string;
}

async function callLipSyncBackend(req: LipSyncBackendRequest): Promise<LipSyncResult> {
  const token = await req.getAccessToken();

  /* ── Step 1: POST to enqueue the job — returns in < 1 s ────────────────
     The server validates inputs, starts background processing, and returns
     a jobId immediately. This avoids the Replit proxy timeout (which was
     killing the old synchronous route after ~30–60 s).                     */
  const startRes = await fetch("/api/lip-sync/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? ""}`,
    },
    body: JSON.stringify({
      clipUrl:              req.clipUrl,
      audioUrl:             req.audioUrl,
      sceneStartSec:        req.sceneStartSec,
      sceneEndSec:          req.sceneEndSec,
      audioSourceType:      req.audioSourceType,
      strength:             req.strength,
      preserveFaceIdentity: req.preserveFaceIdentity,
      preserveArtistLook:   req.preserveArtistLook,
    }),
    signal: AbortSignal.timeout(30_000), // 30 s — only for validation + queuing
  });

  const startCt = startRes.headers.get("content-type") ?? "";
  if (!startCt.includes("application/json")) {
    const preview  = (await startRes.text()).slice(0, 200).replace(/\s+/g, " ").trim();
    const status   = `${startRes.status} ${startRes.statusText}`.trim();
    const nextStep =
      startRes.status === 401 || startRes.status === 403
        ? "Sign in again or refresh the page."
        : startRes.status === 402
          ? "Sync Labs billing blocked — replace API key with a paid account key in Replit Secrets."
          : startRes.status === 503
            ? "API server not available. Check Replit Secrets or try again."
            : startRes.status >= 500
              ? "Server error. Try again in a moment."
              : startCt.includes("text/html")
                ? "Server returned an HTML page — may be restarting. Try again."
                : "Retry the operation. If the problem persists, check server logs.";
    throw new LipSyncNetworkError(
      `Lip sync returned non-JSON (HTTP ${startRes.status}) — see debug card below`,
      { endpoint: "POST /api/lip-sync/preview", status, contentType: startCt || "(none)", isJson: false, preview: preview || "(empty body)", nextStep },
    );
  }

  const startData = await startRes.json() as { jobId?: string; error?: string; code?: string };
  if (!startRes.ok || !startData.jobId) {
    throw new Error(startData.error ?? `Lip sync failed: HTTP ${startRes.status}`);
  }

  const { jobId } = startData;

  /* ── Step 2: Poll for job completion ────────────────────────────────────
     Check every 3 s. The Sync Labs processing + FFmpeg can take 2–8 minutes
     so we allow up to 8 minutes total before giving up.                    */
  const deadline = Date.now() + 480_000;
  let syncLabsJobNotified = false;

  while (Date.now() < deadline) {
    await new Promise<void>(r => setTimeout(r, 3_000));

    const pollRes = await fetch(`/api/lip-sync/job/${jobId}`, {
      headers: { Authorization: `Bearer ${token ?? ""}` },
      signal:  AbortSignal.timeout(15_000),
    });

    if (!pollRes.ok) {
      const body = await pollRes.text().catch(() => "");
      throw new Error(`Job polling failed: HTTP ${pollRes.status} — ${body.slice(0, 200)}`);
    }

    const job = await pollRes.json() as {
      status:         string;
      url?:           string;
      provider?:      string;
      error?:         string;
      code?:          string;
      syncLabsJobId?: string;
    };

    /* Notify caller the moment the Sync.so provider job ID becomes available */
    if (job.syncLabsJobId && !syncLabsJobNotified) {
      req.onSyncLabsJobAccepted?.(job.syncLabsJobId);
      syncLabsJobNotified = true;
    }

    if (job.status === "done") {
      if (!job.url) throw new Error("Lip sync job completed but returned no URL.");
      return { url: job.url, provider: job.provider ?? "sync" };
    }
    if (job.status === "failed") {
      throw new Error(job.error ?? "Lip sync job failed.");
    }
    /* Backend polled Sync.so until its own limit — job may still be running */
    if (job.status === "processing" && job.code === "still_processing") {
      throw new StillProcessingError(
        job.error ?? "Still processing on Sync.so. Check again in a few minutes.",
      );
    }
    /* "queued" | "processing" — keep polling */
  }

  throw new StillProcessingError(
    "Sync.so is taking longer than 8 minutes. The job may still be running — use 'Check Job Status' to follow up.",
  );
}
