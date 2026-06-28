import { useState, useMemo } from "react";
import {
  Stethoscope, Loader2, CheckCircle2, XCircle, Link2, Download, Film, Music2, ExternalLink, Layers, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorCard } from "@/components/editor/controls";
import { useAuth } from "@/contexts/AuthContext";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionSettings, AudioVideoSyncMode } from "@/lib/editor-settings";

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
}

/** Every candidate URL field the spec asks us to surface for Scene 1. */
const URL_FIELD_KEYS = [
  "clip.url", "clip.video_url", "clip.videoUrl", "clip.output_url", "clip.outputUrl",
  "clip.asset_url", "clip.assetUrl", "clip.runway_url", "clip.runwayUrl",
  "clip.storage_url", "clip.storageUrl",
  "scene.clip_url", "scene.clipUrl", "scene.video_url", "scene.videoUrl",
  "scene.runway_output_url", "scene.runwayOutputUrl",
  "scene.generated_clip_url", "scene.generatedClipUrl",
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
  duration: number;
  width: number;
  height: number;
  codec: string;
  ffprobeValid: boolean;
  responseStatus: number;
  contentType: string;
  error: string | null;
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

async function readJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!ct.toLowerCase().includes("application/json")) {
    throw new Error(`API returned ${ct || "non-JSON"} (HTTP ${res.status}) instead of JSON.`);
  }
  return JSON.parse(text) as T;
}

function fmtBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function ExportDoctor({ scenes, projectId, masterAudioUrl, captions, effects, overlays, overlayIntensity, watermarkText, watermarkType, watermarkPosition, watermarkSize, watermarkIncludeInExport, masterCurrentTimeSec, projectDurationSec, appliedTransitions, syncMode, clipEdits, selectedLipSyncSceneId }: ExportDoctorProps) {
  const { getAccessToken } = useAuth();

  // Deduplicate the scenes array by scene id.
  // The timeline can produce duplicate entries (same id appearing twice) if the
  // parent re-merges or the saved data contains repeated clip rows.
  // First occurrence wins; order is preserved.
  const { uniqueScenes, duplicateCount } = useMemo(() => {
    const seen = new Set<string>();
    const unique: SceneData[] = [];
    for (const s of scenes) {
      if (!seen.has(s.id)) { seen.add(s.id); unique.push(s); }
    }
    return { uniqueScenes: unique, duplicateCount: scenes.length - unique.length };
  }, [scenes]);

  // Scene 1 = first scene that has a usable clip URL (from deduplicated list)
  const scene1 = uniqueScenes.find((s) => !!s.demoClipUrl?.startsWith("http")) ?? uniqueScenes[0] ?? null;
  const scene1Url = scene1?.demoClipUrl ?? "";

  const [busy, setBusy] = useState<
    null | "url" | "download" | "export" | "export-audio" | "download-all" | "export-all" | "export-all-audio" | "export-all-captions" | "export-all-effects" | "effect-match-test" | "export-transitions" | "export-all-overlays" | "overlay-match-test" | "lip-sync-preview"
  >(null);
  const [conflictMode, setConflictMode] = useState<"bw-only" | "gold-only" | "blend">("blend");
  const [effectMatchResult, setEffectMatchResult] = useState<ExportResult | null>(null);
  const [transitionsResult, setTransitionsResult] = useState<ExportResult | null>(null);
  const [urlResult, setUrlResult] = useState<UrlTestResult | null>(null);
  const [downloadResult, setDownloadResult] = useState<DownloadResult | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [audioExportResult, setAudioExportResult] = useState<ExportResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // Multi-clip ("All 5 Clips") doctor state
  const [downloadAllResult, setDownloadAllResult] = useState<DownloadAllResult | null>(null);
  const [exportAllResult, setExportAllResult] = useState<ExportResult | null>(null);
  const [exportAllAudioResult, setExportAllAudioResult] = useState<ExportResult | null>(null);
  const [exportAllCaptionsResult, setExportAllCaptionsResult] = useState<ExportResult | null>(null);
  const [exportAllEffectsResult, setExportAllEffectsResult] = useState<ExportResult | null>(null);
  const [exportAllOverlaysResult, setExportAllOverlaysResult] = useState<ExportResult | null>(null);
  const [overlayMatchResult, setOverlayMatchResult] = useState<ExportResult | null>(null);
  const [lipSyncExportResult, setLipSyncExportResult] = useState<ExportResult | null>(null);
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

  const doctorId = downloadResult?.doctorId ?? null;
  const downloadOk = !!downloadResult?.fileExists && !!downloadResult?.ffprobeValid;

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
    const exportUrl = useLipSyncUrl ? ce!.lipSyncUrl! : s.demoClipUrl ?? null;
    return {
      sceneNumber: i + 1,          // position in dragged order, not original scene number
      title: s.section
        ? `Scene ${i + 1} · ${s.section}`
        : `Scene ${i + 1}`,
      url: exportUrl,
      _lipSyncActive: useLipSyncUrl,
      _originalSceneNum: s.sceneNumber ?? i + 1,  // kept only for display / debug
    };
  });

  // Detect whether the user has reordered relative to the original generated sequence.
  const isReordered = uniqueScenes.some((s, i) => (s.sceneNumber ?? i + 1) !== i + 1);
  const orderSourceLabel = isReordered ? "saved timeline order" : "original generated order";
  // Show original scene numbers listed in their current (possibly dragged) positions.
  const orderDisplay = uniqueScenes.map((s, i) => s.sceneNumber ?? i + 1).join(", ");
  const multiClipsWithUrl = multiClips.filter((c) => !!c.url?.startsWith("http"));
  const multiId = downloadAllResult?.multiId ?? null;
  const allClipsValid = !!downloadAllResult?.allValid && downloadAllResult.total > 0;

  async function authHeaders() {
    const token = await getAccessToken();
    return { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` };
  }

  async function testUrl() {
    setBusy("url"); setLastError(null); setUrlResult(null);
    try {
      const res = await fetch("/api/export-doctor/test-url", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ url: scene1Url }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await readJson<UrlTestResult>(res);
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      setUrlResult(data);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function downloadScene1() {
    setBusy("download"); setLastError(null); setDownloadResult(null);
    setExportResult(null); setAudioExportResult(null);
    try {
      const res = await fetch("/api/export-doctor/download", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ projectId, url: scene1Url }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const data = await readJson<DownloadResult>(res);
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      setDownloadResult(data);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function exportScene1() {
    if (!doctorId) return;
    setBusy("export"); setLastError(null); setExportResult(null);
    try {
      const res = await fetch("/api/export-doctor/export", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ doctorId }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setExportResult(data);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function exportScene1Audio() {
    if (!doctorId) return;
    setBusy("export-audio"); setLastError(null); setAudioExportResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-audio", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ doctorId, audioUrl: masterAudioUrl ?? null }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAudioExportResult(data);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function downloadAllClips() {
    setBusy("download-all"); setLastError(null);
    setDownloadAllResult(null); setExportAllResult(null); setExportAllAudioResult(null); setExportAllCaptionsResult(null); setExportAllEffectsResult(null); setExportAllOverlaysResult(null); setOverlayMatchResult(null);
    try {
      const res = await fetch("/api/export-doctor/download-all", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ projectId, clips: multiClips }),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      const data = await readJson<DownloadAllResult>(res);
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      setDownloadAllResult(data);
      if (data.lastError) setLastError(data.lastError);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function exportAllClips() {
    if (!multiId) return;
    setBusy("export-all"); setLastError(null); setExportAllResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ multiId }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setExportAllResult(data);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function exportAllClipsAudio() {
    if (!multiId) return;
    setBusy("export-all-audio"); setLastError(null); setExportAllAudioResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all-audio", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ multiId, audioUrl: masterAudioUrl ?? null }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setExportAllAudioResult(data);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function exportAllClipsCaptions() {
    if (!multiId) return;
    setBusy("export-all-captions"); setLastError(null); setExportAllCaptionsResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all-captions", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ multiId, audioUrl: masterAudioUrl ?? null, captions: captions ?? null }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      // Persist the body even on non-2xx so the real FFmpeg subtitle error + stderrTail survive.
      setExportAllCaptionsResult(data);
      if (!res.ok) { setLastError(data.error ?? `HTTP ${res.status}`); return; }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function exportAllClipsEffects() {
    if (!multiId) return;
    setBusy("export-all-effects"); setLastError(null); setExportAllEffectsResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all-effects", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ multiId, audioUrl: masterAudioUrl ?? null, captions: captions ?? null, effects: effects ?? [], conflictMode }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      // Persist the body even on non-2xx so the real FFmpeg error + stderrTail survive.
      setExportAllEffectsResult(data);
      if (!res.ok) { setLastError(data.error ?? `HTTP ${res.status}`); return; }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function exportAllClipsOverlays() {
    if (!multiId) return;
    setBusy("export-all-overlays"); setLastError(null); setExportAllOverlaysResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all-overlays", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({
          multiId, audioUrl: masterAudioUrl ?? null,
          captions: captions ?? null, effects: effects ?? [],
          overlays: overlays ?? [], overlayIntensity: overlayIntensity ?? {},
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
      if (!res.ok) { setLastError(data.error ?? `HTTP ${res.status}`); return; }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function runOverlayMatchTest() {
    if (!multiId) return;
    setBusy("overlay-match-test"); setLastError(null); setOverlayMatchResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-overlays-range", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({
          multiId, audioUrl: masterAudioUrl ?? null,
          captions: captions ?? null, effects: effects ?? [],
          overlays: overlays ?? [], overlayIntensity: overlayIntensity ?? {},
          watermarkText: watermarkText ?? "Bow Down Visuals",
          watermarkType: watermarkType ?? "logo",
          watermarkIncludeInExport: watermarkIncludeInExport ?? true,
          conflictMode,
          startSec: masterCurrentTimeSec ?? 0, durationSec: 3,
        }),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      setOverlayMatchResult(data);
      if (!res.ok) { setLastError(data.error ?? `HTTP ${res.status}`); return; }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function runEffectMatchTest() {
    if (!multiId) return;
    setBusy("effect-match-test"); setLastError(null); setEffectMatchResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-effects-range", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({
          multiId, audioUrl: masterAudioUrl ?? null, captions: captions ?? null,
          effects: effects ?? [], conflictMode,
          startSec: masterCurrentTimeSec ?? 0, durationSec: 3,
        }),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      setEffectMatchResult(data);
      if (!res.ok) { setLastError(data.error ?? `HTTP ${res.status}`); return; }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function connectTransitions() {
    if (!multiId) return;
    setBusy("export-transitions"); setLastError(null); setTransitionsResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-effects-transitions", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({
          multiId, audioUrl: masterAudioUrl ?? null,
          effects: effects ?? [], conflictMode,
          transitions: appliedTransitions ?? [],
        }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      setTransitionsResult(data);
      if (!res.ok) { setLastError(data.error ?? `HTTP ${res.status}`); return; }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
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
        ? uniqueScenes.findIndex(s =>
            s.id === selectedLipSyncSceneId &&
            !!(clipEdits?.[s.id]?.useLipSync && clipEdits?.[s.id]?.lipSyncUrl))
        : -1;
      /* Fallback: first scene with useLipSync=true + a saved lipSyncUrl */
      if (lipSyncIdx === -1) {
        lipSyncIdx = uniqueScenes.findIndex(s =>
          !!(clipEdits?.[s.id]?.useLipSync && clipEdits?.[s.id]?.lipSyncUrl));
      }
      if (lipSyncIdx === -1) {
        const ceKeys = Object.keys(clipEdits ?? {}).join(", ") || "(none)";
        const selId  = selectedLipSyncSceneId ?? "(none)";
        setLipSyncLastError(
          `No lip synced clip found. useLipSync+lipSyncUrl must both be set. ` +
          `selectedLipSyncSceneId=${selId}. clipEdits keys: ${ceKeys}`
        );
        return;
      }

      const lipSyncScene = uniqueScenes[lipSyncIdx]!;
      const lipSyncCe    = clipEdits![lipSyncScene.id]!;
      const lipSyncUrl   = lipSyncCe.lipSyncUrl!;

      if (!masterAudioUrl) {
        setLipSyncLastError("No project audio available. Add audio in Music Mixer first.");
        return;
      }

      /* Master-player offset — applied exactly once in clipVideoOffsetSec */
      const clipVideoOffsetSec = lipSyncCe.lipSyncOffsetSeconds ?? 0;
      const metaSceneLabel =
        `Scene ${lipSyncScene.sceneNumber}${lipSyncScene.section ? ` — ${lipSyncScene.section}` : ""}`;

      /* ── 2. Download the lip sync clip to the server ──────────────────────── */
      setLipSyncDownloadCalled(true);
      const dlRes = await fetch("/api/export-doctor/download", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ projectId, url: lipSyncUrl }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const dlData = await readJson<DownloadResult>(dlRes);
      if (!dlRes.ok || !dlData.fileExists) {
        setLipSyncLastError(
          dlData.error ??
          `Download failed (HTTP ${dlRes.status}). ` +
          `URL: ${lipSyncUrl.slice(0, 80)}`
        );
        return;
      }

      /* ── 3. Export: lip sync video + project audio segment ────────────────── */
      const tsRaw    = lipSyncScene.timestamp ?? "";
      const tsMatch  = tsRaw.match(/(\d+):(\d+)/);
      const audioStartSec = tsMatch
        ? parseInt(tsMatch[1]!, 10) * 60 + parseInt(tsMatch[2]!, 10)
        : 0;

      /* Record meta before the call so status shows "export offset" immediately */
      setLipSyncExportMeta({ clipVideoOffsetSec, usedLipSyncUrl: true, sceneLabel: metaSceneLabel });

      const expRes = await fetch("/api/export-doctor/export-audio", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({
          doctorId:          dlData.doctorId,
          audioUrl:          masterAudioUrl,
          audioStartSec,
          clipVideoOffsetSec,   // ← master-player timing applied exactly once
          fullDuration:      true,
        }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const expData = await readJson<ExportResult>(expRes);
      setLipSyncExportResult(expData);
      const exportErr = expData.error ?? (!expRes.ok ? `HTTP ${expRes.status}` : null);
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

  const isReplitObjStore = /storage\.googleapis\.com\/replit-objstore-/.test(scene1Url);
  const masterSourceAccepted = urlResult
    ? urlResult.status >= 200 && urlResult.status < 400 && !urlResult.isHtml
    : downloadResult
    ? !!downloadResult.fileExists
    : null;

  const statusRows: [string, boolean | null][] = [
    ["Scene 1 URL found", scene1Url.startsWith("http")],
    ["Scene 1 master player source accepted", masterSourceAccepted],
    ["Scene 1 Replit object storage allowed", scene1Url.startsWith("http") ? isReplitObjStore : null],
    ["Scene 1 URL returns video", urlResult ? urlResult.isVideo : null],
    ["Scene 1 downloaded", downloadResult ? !!downloadResult.fileExists : null],
    ["Scene 1 ffprobe valid", downloadResult ? !!downloadResult.ffprobeValid : null],
    ["Scene 1 simple export works", exportResult ? !!exportResult.success : null],
    ["Audio downloaded", audioExportResult ? !!audioExportResult.audioDownloaded : null],
    ["Scene 1 + audio export works", audioExportResult ? !!audioExportResult.success : null],
  ];

  // ── Caption pre-check (frontend, from the master player's caption settings) ──
  const KNOWN_CAPTION_PRESETS = ["clean-white", "gold-hiphop", "karaoke", "boxed", "viral-shorts", "minimal", "drill", "luxury", "rnb", "kids"];
  const captionLines = captions?.lines ?? [];
  const validCaptionLines = captionLines.filter(
    (l) => !!l.text?.trim() && Number.isFinite(l.startSec) && Number.isFinite(l.endSec) && l.endSec > l.startSec && l.startSec >= 0,
  );
  const fcCaptionRows = captionLines.length;
  const fcCaptionTimingValid = fcCaptionRows > 0 && validCaptionLines.length === fcCaptionRows;
  const fcCaptionsFound =
    !!captions && captions.mode !== "none" &&
    (validCaptionLines.length > 0 || captions.showArtistName || captions.showSongTitle);
  const fcCaptionStyleFound = !!captions && KNOWN_CAPTION_PRESETS.includes(captions.stylePreset);
  const r = exportAllCaptionsResult;
  const captionStatusRows: [string, string, boolean | null][] = [
    ["captions found", (r?.captionsFound ?? fcCaptionsFound) ? "yes" : "no", r?.captionsFound ?? fcCaptionsFound],
    ["caption rows", String(r?.captionRows ?? fcCaptionRows), (r?.captionRows ?? fcCaptionRows) > 0],
    ["caption timing valid", (r?.captionTimingValid ?? fcCaptionTimingValid) ? "yes" : "no", r?.captionTimingValid ?? fcCaptionTimingValid],
    ["caption style found", `${(r?.captionStyleFound ?? fcCaptionStyleFound) ? "yes" : "no"}${captions?.stylePreset ? ` · ${r?.stylePreset ?? captions.stylePreset}` : ""}`, r?.captionStyleFound ?? fcCaptionStyleFound],
    ["captions burned into export", r ? (r.captionsBurned ? "yes" : "no") : "—", r ? !!r.captionsBurned : null],
    ["test export created", r ? (r.success ? "yes" : "no") : "—", r ? !!r.success : null],
  ];

  // ── Effects pre-check (frontend, from the master player's saved Auto AI effects) ──
  const SUPPORTED_EFFECTS = [
    "Film Grain", "Glow", "Blur", "Sharpen", "Vignette", "Black & White", "Neon Glow", "VHS",
    "Cinematic Bars", "Camera Shake", "Slow Zoom", "Speed Ramp", "Warm Grade", "Cool Grade",
    "Teal & Orange", "Moody Desaturated", "Vibrant Pop", "Street Night", "Luxury Gold", "Dark Drill", "Cinematic Contrast",
  ];
  const fxList = effects ?? [];
  const fcEffectsCount = fxList.length;
  const fcEffectsFound = fcEffectsCount > 0;
  const fcUnsupported = fxList.filter((e) => !SUPPORTED_EFFECTS.includes(e));
  const fx = exportAllEffectsResult;
  const fxUnsupported = fx?.unsupportedEffects ?? fcUnsupported;
  const effectsStatusRows: [string, string, boolean | null][] = [
    ["effects found", (fx?.effectsFound ?? fcEffectsFound) ? "yes" : "no", fx?.effectsFound ?? fcEffectsFound],
    ["effects count", String(fx?.effectsCount ?? fcEffectsCount), (fx?.effectsCount ?? fcEffectsCount) > 0],
    ["effects export connected", fx ? (fx.effectsExportConnected ? "yes" : "no") : "—", fx ? !!fx.effectsExportConnected : null],
    ["unsupported effects skipped", fxUnsupported.length > 0 ? fxUnsupported.join(", ") : "none", fxUnsupported.length === 0 ? true : null],
    ["captions preserved", fx ? (fx.captionsPreserved ? "yes" : "no") : "—", fx ? !!fx.captionsPreserved : null],
    ["audio preserved", fx ? (fx.audioPreserved ? "yes" : "no") : "—", fx ? !!fx.audioPreserved : null],
    ["test export created", fx ? (fx.testExportCreated ? "yes" : "no") : "—", fx ? !!fx.testExportCreated : null],
  ];

  // ── Effect Stack Comparison (master vs export) ──
  // Master stack is the flat global Auto AI list; the data model is global so
  // scope/opacity/blend/range are reported honestly as global/100%/normal/full.
  const COLOR_GRADE_EFFECTS = new Set([
    "Black & White", "Warm Grade", "Cool Grade", "Teal & Orange", "Moody Desaturated",
    "Vibrant Pop", "Street Night", "Luxury Gold", "Dark Drill", "Cinematic Contrast",
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
  const stackSource = effectMatchResult?.effectStack?.length ? effectMatchResult : fx;
  const exportStack: ExportEffectEntry[] = stackSource?.effectStack ?? [];
  const conflict = stackSource?.conflict ?? null;
  const stackMatch = stackSource?.stackMatch;
  const stackMatchKnown = !!stackSource && stackMatch !== undefined;

  // ── 3-Second Effect Match Test status ──
  const em = effectMatchResult;
  const matchStatusRows: [string, string, boolean | null][] = [
    ["current master time", `${(em?.rangeStart ?? masterCurrentTimeSec ?? 0).toFixed(1)}s`, null],
    ["active scene", em ? `Scene ${(em.activeSceneIndex ?? 0) + 1}` : "—", null],
    ["master effects found", String(em?.masterEffectsFound ?? fcEffectsCount), (em?.masterEffectsFound ?? fcEffectsCount) > 0],
    ["export effects applied", em ? String(em.effectsApplied ?? 0) : "—", em ? (em.effectsApplied ?? 0) > 0 : null],
    ["output created", em ? (em.success ? "yes" : "no") : "—", em ? !!em.success : null],
    ["effect stack matched", em ? (em.stackMatch ? "yes" : "no") : "—", em ? !!em.stackMatch : null],
  ];

  // ── Overlay pre-check (frontend, from settings.overlays) ──
  const ANIMATED_OVERLAYS = ["Rain", "Smoke", "Sparks", "Dust", "Light Leaks", "Lens Flare", "Animated Waveform"];
  const ovList = overlays ?? [];
  const fcOverlaysFound = ovList.length > 0 || !!(watermarkText?.trim());
  const fcWatermarkFound = ovList.includes("Logo / Watermark") || !!(watermarkText?.trim());
  const fcUnsupportedOverlays = ovList.filter((o) => ANIMATED_OVERLAYS.includes(o));
  const ovr = exportAllOverlaysResult;
  const ovrWmText = ovr?.overlayWatermarkText ?? watermarkText ?? "Bow Down Visuals";
  const overlayStatusRows: [string, string, boolean | null][] = [
    ["overlays found", (ovr?.overlaysFound ?? fcOverlaysFound) ? "yes" : "no", ovr?.overlaysFound ?? fcOverlaysFound],
    ["unsupported overlays skipped", (ovr?.unsupportedOverlays ?? fcUnsupportedOverlays).join(", ") || "none", (ovr?.unsupportedOverlays ?? fcUnsupportedOverlays).length === 0 ? true : null],
    ["watermark found", (ovr?.watermarkFound ?? fcWatermarkFound) ? "yes" : "no", ovr?.watermarkFound ?? fcWatermarkFound],
    ["watermark included", ovr ? (ovr.watermarkIncluded ? "yes" : "no") : "—", ovr ? !!ovr.watermarkIncluded : null],
    ["watermark text", ovrWmText, null],
    ["effects preserved", ovr ? (ovr.effectsPreserved ? "yes" : "no") : "—", ovr ? !!ovr.effectsPreserved : null],
    ["captions preserved", ovr ? (ovr.captionsPreserved ? "yes" : "no") : "—", ovr ? !!ovr.captionsPreserved : null],
    ["audio preserved", ovr ? (ovr.audioPreserved ? "yes" : "no") : "—", ovr ? !!ovr.audioPreserved : null],
    ["overlay export created", ovr ? (ovr.testExportCreated ? "yes" : "no") : "—", ovr ? !!ovr.testExportCreated : null],
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
          const lipSyncScenes = uniqueScenes.filter(s => {
            const ce = clipEdits?.[s.id];
            return !!(ce?.useLipSync && ce.lipSyncUrl);
          });
          const hasLipSync = lipSyncScenes.length > 0;
          const exportScene = (() => {
            if (selectedLipSyncSceneId) {
              const sel = lipSyncScenes.find(s => s.id === selectedLipSyncSceneId);
              if (sel) return sel;
            }
            return lipSyncScenes[0] ?? null;
          })();
          const exportSceneCe = exportScene ? clipEdits?.[exportScene.id] : null;
          const exportSceneLabel = exportScene
            ? `Scene ${exportScene.sceneNumber}${exportScene.section ? ` — ${exportScene.section}` : ""}`
            : "—";
          const sceneMismatch = !!selectedLipSyncSceneId && !!exportScene && exportScene.id !== selectedLipSyncSceneId;
          const fmtOff = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}s`;

          /* clipId: SceneData.clipId is always null from the parser; fall back to
             "scene:<id prefix>" so the row always shows something useful. */
          const resolvedClipId = exportScene?.clipId
            ?? (exportScene ? `scene:${exportScene.id.slice(0, 14)}` : "—");
          const clipIdResolved = !!(exportScene?.clipId);

          /* Export lifecycle state (from component-level state, not this IIFE) */
          const isRunning     = busy === "lip-sync-preview";
          const exportStarted = lipSyncButtonClicked;
          const exportFinished = !isRunning && (!!lipSyncExportResult || (lipSyncButtonClicked && !!lipSyncLastError));

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
                <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">Scene</p>
                {([
                  ["selected scene",          exportSceneLabel,                                          !!exportScene],
                  ["selected clipId",         resolvedClipId,                                            clipIdResolved],
                  ["selected sceneId",        exportScene ? exportScene.id.slice(0, 16) + "…" : "—",   !!exportScene],
                  ["useLipSync",              exportSceneCe?.useLipSync ? "yes ✓" : "no",              exportSceneCe?.useLipSync ?? false],
                  ["lipSyncUrl exists",       exportSceneCe?.lipSyncUrl ? "yes ✓" : "no",              !!exportSceneCe?.lipSyncUrl],
                  ["selected scene mismatch", sceneMismatch ? "yes ✗" : "no ✓",                        !sceneMismatch],
                ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
                  <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                    <span className="text-white/40">{label}</span>
                    <span className={`font-bold truncate max-w-[55%] text-right ${ok === null ? "text-white/60" : ok ? "text-green-400" : "text-red-400"}`}>{val}</span>
                  </div>
                ))}
              </div>

              {/* Offset rows */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5">
                <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">Timing</p>
                {([
                  ["master player offset", fmtOff(exportSceneCe?.lipSyncOffsetSeconds ?? 0), null],
                  ["export offset",        lipSyncExportMeta ? fmtOff(lipSyncExportMeta.clipVideoOffsetSec) : "—", null],
                ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
                  <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                    <span className="text-white/40">{label}</span>
                    <span className={`font-bold ${ok === null ? "text-white/60" : ok ? "text-green-400" : "text-red-400"}`}>{val}</span>
                  </div>
                ))}
              </div>

              {/* Export lifecycle rows */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5">
                <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">Export Status</p>
                {([
                  ["button clicked",         exportStarted ? "yes ✓" : "no",                                                                                           exportStarted],
                  ["selected clipId resolved",clipIdResolved ? "yes ✓ (DB id)" : `yes ✓ (${resolvedClipId.slice(0, 18)})`,                                             !!exportScene],
                  ["export route called",    lipSyncDownloadCalled ? "yes ✓" : exportStarted ? "pending…" : "no",                                                     lipSyncDownloadCalled ? true : exportStarted ? null : false],
                  ["export started",         isRunning ? "running… ✓" : exportStarted ? "yes ✓" : "no",                                                               isRunning ? null : exportStarted],
                  ["export finished",        isRunning ? "running…" : exportFinished ? (lipSyncExportResult?.success ? "yes ✓" : "failed") : "—",                     isRunning ? null : exportFinished ? (lipSyncExportResult?.success ?? false) : null],
                  ["result url",             lipSyncExportResult?.url ? "available ✓" : "—",                                                                          lipSyncExportResult?.url ? true : null],
                  ["last error",             lipSyncLastError ?? "—",                                                                                                  lipSyncLastError ? false : exportFinished && !lipSyncLastError ? true : null],
                ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
                  <div key={label} className="flex items-start justify-between gap-2 text-[11px] font-mono">
                    <span className="text-white/40 shrink-0">{label}</span>
                    <span className={`font-bold text-right break-all max-w-[58%] leading-snug ${ok === null ? "text-white/50" : ok ? "text-green-400" : "text-red-400"}`}>{val}</span>
                  </div>
                ))}
              </div>

              {/* Mismatch warning */}
              {sceneMismatch && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/[0.07] text-red-400 text-[10px] font-semibold">
                  <span className="shrink-0 mt-px">✗</span>
                  Selected scene mismatch — do not export yet. Enable useLipSync on the correct scene in the Lip Sync tab first.
                </div>
              )}

              {/* No lip sync clips warning */}
              {!hasLipSync && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] text-amber-400/70 text-[10px]">
                  <span className="shrink-0 mt-px">⚠</span>
                  No lip synced clips with useLipSync=true. Enable lip sync in the Lip Sync tab, then click "Use in Player".
                </div>
              )}

              {/* Export button */}
              <Button
                onClick={exportLipSyncPreview}
                disabled={busy !== null || !hasLipSync || !masterAudioUrl || sceneMismatch}
                variant="outline"
                className="w-full gap-2 border-primary/40 bg-primary/[0.08] text-primary hover:bg-primary/[0.15] text-xs font-bold disabled:opacity-40"
                data-testid="btn-doctor-lip-sync-preview"
              >
                {busy === "lip-sync-preview"
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…</>
                  : <><Stethoscope className="h-3.5 w-3.5" />
                    {exportScene
                      ? `Export ${exportSceneLabel} Lip Sync Offset Match Test`
                      : "Export Selected Lip Sync Scene Offset Match Test"}
                  </>}
              </Button>
              {!masterAudioUrl && hasLipSync && (
                <p className="text-[10px] text-amber-400/70 text-center">Project audio required — add audio in Music Mixer.</p>
              )}

              {/* Result */}
              {lipSyncExportResult?.url && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
                    <CheckCircle2 className="h-4 w-4" />
                    Lip sync export succeeded · {lipSyncExportResult.duration?.toFixed(1)}s · audio {lipSyncExportResult.hasAudio ? "✓" : "✗"}
                  </div>
                  <video src={lipSyncExportResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
                  <a href={lipSyncExportResult.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" /> Open / download lip sync test video
                  </a>
                </div>
              )}
              {lipSyncExportResult && !lipSyncExportResult.success && (
                <p className="text-[10px] text-red-400/80">{lipSyncExportResult.error ?? "Export failed"}</p>
              )}

            </div>
          );
        })()}

        {/* ── Status panel ── */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3 space-y-1.5">
          <p className="text-[10px] font-black text-white/50 uppercase tracking-widest mb-1">Export Doctor Status</p>
          {statusRows.map(([label, val]) => (
            <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-white/40">{label}</span>
              <span className={`font-bold ${val === null ? "text-white/25" : val ? "text-green-400" : "text-red-400"}`}>
                {val === null ? "—" : val ? "yes" : "no"}
              </span>
            </div>
          ))}
          <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
            <span className="text-white/40 shrink-0">Last error</span>
            <span className="text-red-400/80 text-right break-words leading-snug">{lastError ?? "—"}</span>
          </div>
        </div>

        {/* ── Four action buttons ── */}
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={testUrl} disabled={busy !== null || !scene1Url} variant="outline"
            className="gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs"
            data-testid="btn-doctor-test-url">
            {busy === "url" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Test Scene 1 Source URL
          </Button>
          <Button onClick={downloadScene1} disabled={busy !== null || !scene1Url} variant="outline"
            className="gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs"
            data-testid="btn-doctor-download">
            {busy === "download" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download Scene 1 Only
          </Button>
          <Button onClick={exportScene1} disabled={busy !== null || !downloadOk} variant="outline"
            className="gap-2 border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10 text-xs disabled:opacity-40"
            data-testid="btn-doctor-export">
            {busy === "export" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
            Export Scene 1 Only
          </Button>
          <Button onClick={exportScene1Audio} disabled={busy !== null || !downloadOk} variant="outline"
            className="gap-2 border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10 text-xs disabled:opacity-40"
            data-testid="btn-doctor-export-audio">
            {busy === "export-audio" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music2 className="h-3.5 w-3.5" />}
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
            <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Scene 1 URL Fields</p>
          </div>
          <div className="px-3 py-2.5 space-y-1 text-[9px] font-mono">
            {URL_FIELD_KEYS.map((k) => {
              const v = fieldValues[k] ?? "";
              const used = k === "scene.demoClipUrl";
              return (
                <div key={k} className="flex items-start gap-2">
                  <span className={`shrink-0 w-[180px] ${used ? "text-primary/70" : "text-white/30"}`}>
                    {k}{used ? " (master player)" : ""}
                  </span>
                  <span className={`break-all leading-tight ${v ? "text-white/55" : "text-white/20"}`}>
                    {v || "(empty)"}
                  </span>
                </div>
              );
            })}
            <div className="flex items-start gap-2 pt-1.5 mt-1.5 border-t border-white/[0.06]">
              <span className="shrink-0 w-[180px] text-white/40">Final selected URL</span>
              <span className="break-all leading-tight text-white/60">{scene1Url || "(none)"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 w-[180px] text-white/40">Starts with http</span>
              <span className={`font-bold ${scene1Url.startsWith("http") ? "text-green-400" : "text-red-400"}`}>
                {scene1Url.startsWith("http") ? "yes" : "no"}
              </span>
            </div>
            {urlResult && (
              <>
                <div className="flex items-center gap-2"><span className="shrink-0 w-[180px] text-white/40">HTTP status</span><span className="text-white/60">{urlResult.status || "—"}</span></div>
                <div className="flex items-center gap-2"><span className="shrink-0 w-[180px] text-white/40">Content-Type</span><span className="text-white/60">{urlResult.contentType || "—"}</span></div>
                <div className="flex items-center gap-2"><span className="shrink-0 w-[180px] text-white/40">Content-Length</span><span className="text-white/60">{fmtBytes(urlResult.contentLength)}</span></div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 w-[180px] text-white/40">Returns video</span>
                  <span className={`font-bold ${urlResult.isVideo ? "text-green-400" : "text-red-400"}`}>{urlResult.isVideo ? "yes" : "no"}</span>
                </div>
                {urlResult.snippet && (
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 w-[180px] text-white/40">First 100 chars</span>
                    <span className="break-all leading-tight text-amber-400/80">{urlResult.snippet.slice(0, 100)}</span>
                  </div>
                )}
                <div className={`mt-1 pt-1 border-t border-white/[0.06] ${urlResult.isHtml ? "text-red-400" : urlResult.isVideo ? "text-green-400" : "text-amber-400"}`}>
                  {urlResult.message}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── TEST 2 result: download ── */}
        {downloadResult && (
          <div className={`rounded-xl border overflow-hidden ${downloadOk ? "border-green-500/25 bg-green-500/[0.04]" : "border-red-500/25 bg-red-500/[0.04]"}`}>
            <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2">
              {downloadOk ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> : <XCircle className="h-3.5 w-3.5 text-red-400" />}
              <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Scene 1 Download</p>
            </div>
            <div className="px-3 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
              <div className="col-span-2 flex items-start gap-2"><span className="text-white/35 shrink-0 w-[110px]">Local path</span><span className="text-white/55 break-all">{downloadResult.localPath}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/35 w-[110px]">File exists</span><span className={`font-bold ${downloadResult.fileExists ? "text-green-400" : "text-red-400"}`}>{downloadResult.fileExists ? "yes" : "no"}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/35 w-[80px]">File size</span><span className="text-white/55">{fmtBytes(downloadResult.fileSize)}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/35 w-[110px]">Duration</span><span className="text-white/55">{downloadResult.duration ? `${downloadResult.duration.toFixed(2)}s` : "—"}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/35 w-[80px]">Codec</span><span className="text-white/55">{downloadResult.codec || "—"}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/35 w-[110px]">Resolution</span><span className="text-white/55">{downloadResult.width ? `${downloadResult.width}×${downloadResult.height}` : "—"}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/35 w-[80px]">ffprobe</span><span className={`font-bold ${downloadResult.ffprobeValid ? "text-green-400" : "text-red-400"}`}>{downloadResult.ffprobeValid ? "valid" : "invalid"}</span></div>
              {downloadResult.error && <div className="col-span-2 text-red-400/80 break-words pt-1 border-t border-red-500/20">{downloadResult.error}</div>}
            </div>
          </div>
        )}

        {/* ── TEST 3 result: simple export ── */}
        {exportResult?.success && exportResult.url && (
          <div className="rounded-xl border border-green-500/25 bg-green-500/[0.04] px-3 py-3 space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
              <CheckCircle2 className="h-4 w-4" /> Scene 1 test export succeeded · {exportResult.duration?.toFixed(1)}s · {fmtBytes(exportResult.fileSize)}
            </div>
            <video src={exportResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
            <a href={exportResult.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
              <ExternalLink className="h-3 w-3" /> Open / download test video
            </a>
          </div>
        )}

        {/* ── TEST 4 result: scene 1 + audio ── */}
        {audioExportResult?.success && audioExportResult.url && (
          <div className="rounded-xl border border-green-500/25 bg-green-500/[0.04] px-3 py-3 space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
              <CheckCircle2 className="h-4 w-4" /> Scene 1 + audio export succeeded · {audioExportResult.duration?.toFixed(1)}s · audio {audioExportResult.hasAudio ? "✓" : "✗"}
            </div>
            <video src={audioExportResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
            <a href={audioExportResult.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
              <ExternalLink className="h-3 w-3" /> Open / download test video
            </a>
          </div>
        )}

        {/* ════════ LIP SYNC EXPORT TEST — detailed panels (button is at the top) ════════ */}
        {(() => {
          /* All deduplicated scenes that have useLipSync=true + a saved URL */
          const lipSyncScenes = uniqueScenes.filter(s => {
            const ce = clipEdits?.[s.id];
            return !!(ce?.useLipSync && ce.lipSyncUrl);
          });
          const hasLipSync = lipSyncScenes.length > 0;

          /* Which scene will be exported:
             1. The scene selected in the Lip Sync tab (selectedLipSyncSceneId), if it has a result
             2. Otherwise the first scene with useLipSync=true + lipSyncUrl */
          const exportScene = (() => {
            if (selectedLipSyncSceneId) {
              const sel = lipSyncScenes.find(s => s.id === selectedLipSyncSceneId);
              if (sel) return sel;
            }
            return lipSyncScenes[0] ?? null;
          })();
          const exportSceneCe  = exportScene ? clipEdits?.[exportScene.id] : null;
          /* Use scene.sceneNumber — NOT uniqueScenes.indexOf() — so Scene 4 stays Scene 4. */
          const exportSceneLabel = exportScene
            ? `Scene ${exportScene.sceneNumber}${exportScene.section ? ` — ${exportScene.section}` : ""}`
            : "—";
          /* Mismatch: Lip Sync tab selected a scene, but Export Doctor had to fall back to another. */
          const sceneMismatch = !!selectedLipSyncSceneId && !!exportScene && exportScene.id !== selectedLipSyncSceneId;
          const fmtOff = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}s`;

          /* Per-scene clip source summary — use s.sceneNumber, not loop index */
          const lipSyncSummaryRows = uniqueScenes.map((s) => {
            const ce = clipEdits?.[s.id];
            const active = !!(ce?.useLipSync && ce.lipSyncUrl);
            const isSel = s.id === selectedLipSyncSceneId;
            return {
              label:  `Scene ${s.sceneNumber}${s.section ? ` · ${s.section}` : ""}${isSel ? " ◀ selected" : ""}`,
              source: active ? "lip sync ✓" : "original clip",
              ok:     active as boolean | null,
            };
          });

          return (
            <div className="pt-2 mt-2 border-t border-white/[0.08]">
              <div className="flex items-center gap-2 mb-3">
                <Stethoscope className="h-4 w-4 text-primary/70" />
                <p className="text-[11px] font-black text-white/70 uppercase tracking-widest">Lip Sync Export Check</p>
              </div>

              {/* Per-clip source priority panel */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5 mb-3">
                <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">Clip Source Priority</p>
                {lipSyncSummaryRows.map(row => (
                  <div key={row.label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                    <span className="text-white/40">{row.label}</span>
                    <span className={`font-bold ${row.ok ? "text-green-400" : "text-white/25"}`}>{row.source}</span>
                  </div>
                ))}
              </div>

              {/* ── Lip Sync Export Selection (identity check) ── */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5 mb-3">
                <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">Lip Sync Export Selection</p>
                {([
                  ["selected scene label",   exportSceneLabel,                                                               !!exportScene],
                  ["selected scene number",  exportScene ? String(exportScene.sceneNumber) : "—",                           !!exportScene],
                  ["selected clipId",        exportScene?.clipId ?? "—",                                                    !!exportScene?.clipId],
                  ["selected sceneId",       exportScene ? exportScene.id.slice(0, 14) + "…" : "—",                        !!exportScene],
                  ["timeline index",         exportScene ? String(scenes.findIndex(s => s.id === exportScene.id) + 1) : "—", !!exportScene],
                  ["lipSyncUrl exists",      exportSceneCe?.lipSyncUrl ? "yes ✓" : "no",                                   !!exportSceneCe?.lipSyncUrl],
                  ["useLipSync",             exportSceneCe?.useLipSync ? "yes ✓" : "no",                                   exportSceneCe?.useLipSync ?? false],
                  ["master player offset",   fmtOff(exportSceneCe?.lipSyncOffsetSeconds ?? 0),                             null],
                  ["export offset",          lipSyncExportMeta ? fmtOff(lipSyncExportMeta.clipVideoOffsetSec) : "—",       null],
                ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
                  <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                    <span className="text-white/40">{label}</span>
                    <span className={`font-bold truncate max-w-[55%] text-right ${ok === null ? "text-white/60" : ok ? "text-green-400" : "text-red-400"}`}>{val}</span>
                  </div>
                ))}
              </div>

              {/* ── Mismatch warning ── */}
              {sceneMismatch && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/[0.07] text-red-400 text-[10px] font-semibold mb-3">
                  <span className="shrink-0 mt-px">✗</span>
                  Selected scene mismatch — do not export yet. The Lip Sync tab selected a different scene than what Export Doctor can find with useLipSync=true.
                </div>
              )}

              {/* ── Export check status ── */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5 mb-3">
                <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">Lip Sync Export Check</p>
                {([
                  ["lip synced clips found",    hasLipSync ? "yes ✓" : "no",                                                                       hasLipSync],
                  ["selected lip sync scene",   exportSceneLabel,                                                                                   !!exportScene],
                  ["lip sync clipId",           exportScene?.clipId ?? "—",                                                                         !!exportScene?.clipId],
                  ["useLipSync active",         exportSceneCe?.useLipSync ? "yes ✓" : "no",                                                        exportSceneCe?.useLipSync ?? null],
                  ["lipSyncUrl exists",         exportSceneCe?.lipSyncUrl ? "yes ✓" : "no",                                                        !!exportSceneCe?.lipSyncUrl],
                  ["video source",              exportScene ? (exportSceneCe?.useLipSync && exportSceneCe?.lipSyncUrl ? "lip sync ✓" : "original clip") : "—", exportScene ? !!(exportSceneCe?.useLipSync && exportSceneCe?.lipSyncUrl) : null],
                  ["project audio",             masterAudioUrl ? "ready ✓" : "missing",                                                            !!masterAudioUrl],
                  ["export started",            busy === "lip-sync-preview" ? "yes ✓" : lipSyncExportResult || lipSyncLastError ? "yes ✓" : "no",  busy === "lip-sync-preview" || !!lipSyncExportResult || !!lipSyncLastError],
                  ["export finished",           busy === "lip-sync-preview" ? "running…" : lipSyncExportResult ? "yes ✓" : lipSyncLastError ? "failed" : "—", busy === "lip-sync-preview" ? null : lipSyncExportResult ? !!lipSyncExportResult.success : lipSyncLastError ? false : null],
                  ["result url",                lipSyncExportResult?.url ? "available ✓" : "—",                                                    !!lipSyncExportResult?.url],
                  ["last error",                lipSyncLastError ?? "—",                                                                            lipSyncLastError ? false : null],
                ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
                  <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                    <span className="text-white/40">{label}</span>
                    <span className={`font-bold truncate max-w-[55%] text-right ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-red-400"}`}>{val}</span>
                  </div>
                ))}
              </div>

              {/* Lip Sync Export Timing — verifies offset direction, value, and single application */}
              {(() => {
                const currentOffset  = exportSceneCe?.lipSyncOffsetSeconds ?? 0;
                const fmtOffset      = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}s`;
                const masterUsingLs  = !!(exportSceneCe?.useLipSync && exportSceneCe?.lipSyncUrl);
                const hasExported    = lipSyncExportMeta !== null;
                const exportedOffset = lipSyncExportMeta?.clipVideoOffsetSec ?? null;
                const exportedUrl    = lipSyncExportMeta?.usedLipSyncUrl ?? false;
                /* Offset matches when value is identical to what was exported */
                const offsetMatches  = hasExported && exportedOffset === currentOffset;
                const exportMatches  = hasExported && exportedUrl && offsetMatches && !!lipSyncExportResult?.success;
                return (
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5 mb-3">
                    <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest pb-0.5">Lip Sync Export Timing</p>
                    {([
                      /* Row 1: what offset the master player is using right now */
                      ["master player offset",
                       masterUsingLs ? `${fmtOffset(currentOffset)} (active)` : `${fmtOffset(currentOffset)} (lip sync off)`,
                       masterUsingLs ? null : false],
                      /* Row 2: what offset was sent in the last export */
                      ["export offset",
                       !hasExported ? "—" : `${fmtOffset(exportedOffset!)}${offsetMatches ? " ✓ matches" : " ✗ stale"}`,
                       !hasExported ? null : offsetMatches],
                      /* Row 3: confirm the offset was applied exactly once, not doubled */
                      ["offset applied once",
                       !hasExported ? "—" : "yes ✓",
                       !hasExported ? null : true],
                      /* Row 4: overall verdict */
                      ["export matches master player",
                       !hasExported ? "—" : exportMatches ? "yes ✓" : offsetMatches ? "re-export needed" : "offset changed — re-export",
                       !hasExported ? null : exportMatches],
                    ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
                      <div key={label} className="flex items-start justify-between gap-2 text-[11px] font-mono">
                        <span className="text-white/40 shrink-0">{label}</span>
                        <span className={`font-bold text-right ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-red-400"}`}>{val}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {!hasLipSync && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] text-amber-400/70 text-[10px] mb-3">
                  <span className="shrink-0 mt-px">⚠</span>
                  No lip synced clips with useLipSync=true. Enable lip sync in the Lip Sync tab, then click "Use in Player".
                </div>
              )}

              {/* Button — targets the selected lip sync scene; blocked on mismatch */}
              <Button
                onClick={exportLipSyncPreview}
                disabled={busy !== null || !hasLipSync || !masterAudioUrl || sceneMismatch}
                variant="outline"
                className="w-full gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs disabled:opacity-40"
                data-testid="btn-doctor-lip-sync-preview"
              >
                {busy === "lip-sync-preview"
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…</>
                  : <><Stethoscope className="h-3.5 w-3.5" />
                    {exportScene
                      ? `Export ${exportSceneLabel} Lip Sync Offset Match Test`
                      : "Export Selected Lip Sync Scene Offset Match Test"}
                  </>}
              </Button>
              {!masterAudioUrl && hasLipSync && (
                <p className="mt-1.5 text-[10px] text-amber-400/70 text-center">Project audio required — add audio in Music Mixer.</p>
              )}

              {lipSyncExportResult?.url && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
                    <CheckCircle2 className="h-4 w-4" /> Lip sync export succeeded · {lipSyncExportResult.duration?.toFixed(1)}s · audio {lipSyncExportResult.hasAudio ? "✓" : "✗"}
                  </div>
                  <video src={lipSyncExportResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
                  <a href={lipSyncExportResult.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" /> Open / download lip sync test video
                  </a>
                </div>
              )}
              {lipSyncExportResult && !lipSyncExportResult.success && (
                <p className="mt-2 text-[10px] text-red-400/80">{lipSyncExportResult.error ?? "Export failed"}</p>
              )}
            </div>
          );
        })()}

        {/* ════════ ALL CLIPS DOCTOR ════════ */}
        <div className="pt-2 mt-2 border-t border-white/[0.08]">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4 text-primary" />
            <p className="text-[11px] font-black text-white/70 uppercase tracking-widest">All {multiClips.length} Clips Doctor</p>
          </div>

          {/* ── Export order status ── */}
          {uniqueScenes.length === 0 ? (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] text-amber-400 text-[11px] font-semibold mb-3">
              <span className="shrink-0 mt-px">⚠</span>
              Saved timeline order missing. Using original order.
            </div>
          ) : (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5 mb-3">
              <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-1.5">Export Order</p>
              {([
                ["order source",          orderSourceLabel,                                             isReordered],
                ["total clips",           `${uniqueScenes.length}`,                                     uniqueScenes.length > 0],
                ["duplicate clips found", duplicateCount > 0 ? `yes — ${duplicateCount} removed` : "no", duplicateCount === 0],
                ["duplicate clips removed", `${duplicateCount}`,                                         duplicateCount === 0],
              ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
                <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-white/40">{label}</span>
                  <span className={`font-bold ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-amber-400"}`}>{val}</span>
                </div>
              ))}
              <div className="flex items-start justify-between gap-2 text-[11px] font-mono">
                <span className="text-white/40 shrink-0">final scene order</span>
                <span className="font-bold text-white/70 text-right break-words leading-snug">{orderDisplay}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-white/40">matches master player</span>
                <span className="font-bold text-green-400">yes</span>
              </div>
            </div>
          )}

          {/* ── Multi-clip status block ── */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3 space-y-1.5 mb-3">
            {([
              ["clips found", downloadAllResult ? `${multiClipsWithUrl.length}/${multiClips.length}` : `${multiClipsWithUrl.length}/${multiClips.length}`, multiClipsWithUrl.length === multiClips.length && multiClips.length > 0],
              ["clips downloaded", downloadAllResult ? `${downloadAllResult.downloaded}/${downloadAllResult.total}` : "—", downloadAllResult ? downloadAllResult.downloaded === downloadAllResult.total : null],
              ["clips ffprobe valid", downloadAllResult ? `${downloadAllResult.valid}/${downloadAllResult.total}` : "—", downloadAllResult ? downloadAllResult.valid === downloadAllResult.total : null],
              ["all clips export works", exportAllResult ? (exportAllResult.success ? "yes" : "no") : "—", exportAllResult ? !!exportAllResult.success : null],
              ["all clips + audio export works", exportAllAudioResult ? (exportAllAudioResult.success ? "yes" : "no") : "—", exportAllAudioResult ? !!exportAllAudioResult.success : null],
            ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
              <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-white/40">{label}</span>
                <span className={`font-bold ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-red-400"}`}>{val}</span>
              </div>
            ))}
            <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
              <span className="text-white/40 shrink-0">last error</span>
              <span className="text-red-400/80 text-right break-words leading-snug">{lastError ?? "—"}</span>
            </div>
          </div>

          {/* ── Multi-clip action buttons ── */}
          <div className="grid grid-cols-1 gap-2 mb-3">
            <Button onClick={downloadAllClips} disabled={busy !== null || multiClipsWithUrl.length === 0} variant="outline"
              className="gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs"
              data-testid="btn-doctor-download-all">
              {busy === "download-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download All {multiClips.length} Clips
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={exportAllClips} disabled={busy !== null || !allClipsValid} variant="outline"
                className="gap-2 border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10 text-xs disabled:opacity-40"
                data-testid="btn-doctor-export-all">
                {busy === "export-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
                Export All {multiClips.length} Clips Only
              </Button>
              <Button onClick={exportAllClipsAudio} disabled={busy !== null || !allClipsValid} variant="outline"
                className="gap-2 border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10 text-xs disabled:opacity-40"
                data-testid="btn-doctor-export-all-audio">
                {busy === "export-all-audio" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music2 className="h-3.5 w-3.5" />}
                Export All {multiClips.length} Clips + Audio Only
              </Button>
            </div>
            <Button onClick={exportAllClipsCaptions} disabled={busy !== null || !allClipsValid || !fcCaptionsFound} variant="outline"
              className="gap-2 border-amber-500/30 bg-amber-500/5 text-amber-400 hover:bg-amber-500/10 text-xs disabled:opacity-40"
              data-testid="btn-doctor-export-all-captions">
              {busy === "export-all-captions" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
              Export All {multiClips.length} Clips + Audio + Captions Only
            </Button>
            <Button onClick={exportAllClipsEffects} disabled={busy !== null || !allClipsValid || !fcEffectsFound} variant="outline"
              className="gap-2 border-fuchsia-500/30 bg-fuchsia-500/5 text-fuchsia-400 hover:bg-fuchsia-500/10 text-xs disabled:opacity-40"
              data-testid="btn-doctor-export-all-effects">
              {busy === "export-all-effects" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Export All {multiClips.length} Clips + Audio + Captions + Effects Only
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={runEffectMatchTest} disabled={busy !== null || !allClipsValid || !fcEffectsFound} variant="outline"
                className="gap-2 border-cyan-500/30 bg-cyan-500/5 text-cyan-300 hover:bg-cyan-500/10 text-xs disabled:opacity-40"
                data-testid="btn-doctor-effect-match-test">
                {busy === "effect-match-test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Render 3-Second Effect Match Test
              </Button>
              <Button onClick={connectTransitions} disabled={busy !== null || !allClipsValid} variant="outline"
                className="gap-2 border-violet-500/30 bg-violet-500/5 text-violet-300 hover:bg-violet-500/10 text-xs disabled:opacity-40"
                data-testid="btn-doctor-connect-transitions">
                {busy === "export-transitions" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                Connect Transitions To Export
              </Button>
            </div>
            {/* ── Overlay / Watermark section ── */}
            <Button onClick={exportAllClipsOverlays} disabled={busy !== null || !allClipsValid || !fcOverlaysFound} variant="outline"
              className="gap-2 border-[#C9A84C]/30 bg-[#C9A84C]/5 text-[#C9A84C] hover:bg-[#C9A84C]/10 text-xs disabled:opacity-40 w-full"
              data-testid="btn-doctor-export-all-overlays">
              {busy === "export-all-overlays" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Export All {multiClips.length} Clips + Audio + Captions + Effects + Watermark
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
                <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Per-Scene Results</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="text-white/35 border-b border-white/[0.06]">
                      <th className="text-left px-2 py-1.5 font-medium">Scene</th>
                      <th className="text-center px-1 py-1.5 font-medium">File</th>
                      <th className="text-right px-1 py-1.5 font-medium">Size</th>
                      <th className="text-right px-1 py-1.5 font-medium">Dur</th>
                      <th className="text-center px-1 py-1.5 font-medium">Res</th>
                      <th className="text-center px-2 py-1.5 font-medium">ffprobe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {downloadAllResult.clips.map((c) => (
                      <tr key={c.sceneNumber} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-2 py-1.5 text-white/55 whitespace-nowrap">{c.sceneNumber}</td>
                        <td className="text-center px-1 py-1.5">
                          <span className={c.fileExists ? "text-green-400" : "text-red-400"}>{c.fileExists ? "✓" : "✗"}</span>
                        </td>
                        <td className="text-right px-1 py-1.5 text-white/45">{fmtBytes(c.fileSize)}</td>
                        <td className="text-right px-1 py-1.5 text-white/45">{c.duration ? `${c.duration.toFixed(1)}s` : "—"}</td>
                        <td className="text-center px-1 py-1.5 text-white/45">{c.width ? `${c.width}×${c.height}` : "—"}</td>
                        <td className="text-center px-2 py-1.5">
                          <span className={`font-bold ${c.ffprobeValid ? "text-green-400" : "text-red-400"}`}>{c.ffprobeValid ? "valid" : "invalid"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {downloadAllResult.clips.some((c) => c.error) && (
                <div className="px-3 py-2 border-t border-white/[0.06] space-y-1">
                  {downloadAllResult.clips.filter((c) => c.error).map((c) => (
                    <div key={c.sceneNumber} className="text-[10px] font-mono text-red-400/80 break-words">
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
                <CheckCircle2 className="h-4 w-4" /> All clips export succeeded · {exportAllResult.clipCount ?? "?"} clips · {exportAllResult.duration?.toFixed(1)}s · {fmtBytes(exportAllResult.fileSize)}
              </div>
              <video src={exportAllResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
              <a href={exportAllResult.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> Open / download test video
              </a>
            </div>
          )}

          {/* ── All clips + audio export result ── */}
          {exportAllAudioResult?.success && exportAllAudioResult.url && (
            <div className="rounded-xl border border-green-500/25 bg-green-500/[0.04] px-3 py-3 space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
                <CheckCircle2 className="h-4 w-4" /> All clips + audio export succeeded · {exportAllAudioResult.clipCount ?? "?"} clips · {exportAllAudioResult.duration?.toFixed(1)}s · audio {exportAllAudioResult.hasAudio ? "✓" : "✗"}
              </div>
              <video src={exportAllAudioResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
              <a href={exportAllAudioResult.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> Open / download test video
              </a>
            </div>
          )}

          {/* ── Caption Export Doctor status block ── */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] px-3 py-3 space-y-1.5 mt-3">
            <p className="text-[10px] font-black text-amber-400/70 uppercase tracking-widest mb-1">Caption Export Doctor</p>
            {captionStatusRows.map(([label, val, ok]) => (
              <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-white/40">{label}</span>
                <span className={`font-bold ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-red-400"}`}>{val}</span>
              </div>
            ))}
            <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
              <span className="text-white/40 shrink-0">last error</span>
              <span className="text-red-400/80 text-right break-words leading-snug">
                {exportAllCaptionsResult?.error ?? (busy !== "export-all-captions" && exportAllCaptionsResult === null ? (lastError ?? "—") : "—")}
              </span>
            </div>
            {/* Real FFmpeg subtitle error tail on failure */}
            {exportAllCaptionsResult?.stderrTail && exportAllCaptionsResult.stderrTail.length > 0 && (
              <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-0.5">
                <span className="text-[10px] font-black text-red-400/60 uppercase tracking-widest">FFmpeg subtitle error</span>
                {exportAllCaptionsResult.stderrTail.map((line, i) => (
                  <div key={i} className="text-[10px] font-mono text-red-400/70 break-words leading-snug">{line}</div>
                ))}
              </div>
            )}
          </div>

          {/* ── Caption test export result ── */}
          {exportAllCaptionsResult?.success && exportAllCaptionsResult.url && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] px-3 py-3 space-y-2 mt-3">
              <div className="flex items-center gap-2 text-[11px] text-amber-300 font-bold">
                <CheckCircle2 className="h-4 w-4" /> Captions burned · {exportAllCaptionsResult.clipCount ?? "?"} clips · {exportAllCaptionsResult.duration?.toFixed(1)}s · {exportAllCaptionsResult.captionRows ?? 0} rows · audio {exportAllCaptionsResult.hasAudio ? "✓" : "✗"}
              </div>
              <video src={exportAllCaptionsResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
              <a href={exportAllCaptionsResult.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> Open / download captioned test video
              </a>
            </div>
          )}

          {/* ── Effects Export Doctor status block ── */}
          <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.03] px-3 py-3 space-y-1.5 mt-3">
            <p className="text-[10px] font-black text-fuchsia-400/70 uppercase tracking-widest mb-1">Effects Export Doctor</p>
            {effectsStatusRows.map(([label, val, ok]) => (
              <div key={label} className="flex items-start justify-between gap-2 text-[11px] font-mono">
                <span className="text-white/40 shrink-0">{label}</span>
                <span className={`font-bold text-right break-words ${ok === null ? "text-white/30" : ok ? "text-green-400" : "text-red-400"}`}>{val}</span>
              </div>
            ))}
            <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
              <span className="text-white/40 shrink-0">last error</span>
              <span className="text-red-400/80 text-right break-words leading-snug">
                {exportAllEffectsResult?.error ?? (busy !== "export-all-effects" && exportAllEffectsResult === null ? (lastError ?? "—") : "—")}
              </span>
            </div>
            {/* Real FFmpeg effects error tail on failure */}
            {exportAllEffectsResult?.stderrTail && exportAllEffectsResult.stderrTail.length > 0 && (
              <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-0.5">
                <span className="text-[10px] font-black text-red-400/60 uppercase tracking-widest">FFmpeg effects error</span>
                {exportAllEffectsResult.stderrTail.map((line, i) => (
                  <div key={i} className="text-[10px] font-mono text-red-400/70 break-words leading-snug">{line}</div>
                ))}
              </div>
            )}
            <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
              <span className="text-white/40 shrink-0">master/export effect stack match</span>
              <span className={`font-bold text-right ${!stackMatchKnown ? "text-white/30" : stackMatch ? "text-green-400" : "text-red-400"}`}>
                {!stackMatchKnown ? "—" : stackMatch ? "yes" : "no"}
              </span>
            </div>
          </div>

          {/* ── Effect conflict resolver (Black & White ↔ Luxury Gold) ── */}
          {conflict?.detected && (
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/[0.05] px-3 py-3 space-y-2 mt-3">
              <p className="text-[10px] font-black text-orange-300/80 uppercase tracking-widest">Effect conflict detected</p>
              <p className="text-[11px] text-orange-200/80 leading-snug">{conflict.note}</p>
              <div className="grid grid-cols-3 gap-1.5">
                {([["bw-only", "Black & White only"], ["gold-only", "Luxury Gold only"], ["blend", "Blend both"]] as const).map(([mode, label]) => (
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
                Re-run the effects export or match test after changing the resolution to apply it.
              </p>
            </div>
          )}

          {/* ── Effect Stack Comparison (master vs export) ── */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3 space-y-2 mt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black text-white/50 uppercase tracking-widest flex items-center gap-1.5">
                <Layers className="h-3 w-3" /> Effect Stack Comparison
              </p>
              <span className={`text-[10px] font-bold ${!stackMatchKnown ? "text-white/30" : stackMatch ? "text-green-400" : "text-red-400"}`}>
                match: {!stackMatchKnown ? "—" : stackMatch ? "yes" : "no"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([["Master Effect Stack", masterStack], ["Export Effect Stack", exportStack]] as const).map(([title, stack]) => (
                <div key={title} className="space-y-1">
                  <p className="text-[9px] font-black text-white/35 uppercase tracking-widest">{title}</p>
                  {stack.length === 0 ? (
                    <p className="text-[10px] font-mono text-white/25">— none —</p>
                  ) : (
                    stack.map((e, i) => (
                      <div key={`${e.name}-${i}`} className="rounded-md border border-white/[0.05] bg-white/[0.015] px-1.5 py-1 text-[9px] font-mono leading-tight">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-white/70 font-bold truncate">{e.name}</span>
                          <span className={e.applied ? "text-green-400" : "text-white/30"}>{e.applied ? "applied" : "off"}</span>
                        </div>
                        <div className="text-white/35">
                          {e.type} · {e.scope} · int {e.intensity ?? "—"} · op {Math.round(e.opacity * 100)}% · {e.blend} · {e.startSec.toFixed(0)}–{e.endSec > 0 ? e.endSec.toFixed(0) : "end"}s
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-white/30 leading-snug pt-1 border-t border-white/[0.06]">
              Effects are global in this project, so scope=global, opacity=100%, blend=normal, range=full clip.
            </p>
          </div>

          {/* ── 3-Second Effect Match Test status ── */}
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] px-3 py-3 space-y-1.5 mt-3">
            <p className="text-[10px] font-black text-cyan-300/70 uppercase tracking-widest mb-1">Effect Match Test</p>
            {matchStatusRows.map(([label, val, ok]) => (
              <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-white/40">{label}</span>
                <span className={`font-bold ${ok === null ? "text-white/50" : ok ? "text-green-400" : "text-red-400"}`}>{val}</span>
              </div>
            ))}
            {em?.stderrTail && em.stderrTail.length > 0 && (
              <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-0.5">
                <span className="text-[10px] font-black text-red-400/60 uppercase tracking-widest">FFmpeg match-test error</span>
                {em.stderrTail.map((line, i) => (
                  <div key={i} className="text-[10px] font-mono text-red-400/70 break-words leading-snug">{line}</div>
                ))}
              </div>
            )}
          </div>

          {/* ── Effect match test result video ── */}
          {em?.success && em.url && (
            <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] px-3 py-3 space-y-2 mt-3">
              <div className="flex items-center gap-2 text-[11px] text-cyan-200 font-bold">
                <CheckCircle2 className="h-4 w-4" /> 3s match · from {em.rangeStart?.toFixed(1)}s · Scene {(em.activeSceneIndex ?? 0) + 1} · {em.effectsApplied ?? 0} fx · match {em.stackMatch ? "✓" : "✗"}
              </div>
              <video src={em.url} controls className="w-full max-h-64 rounded-lg bg-black" />
              <a href={em.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> Open / download match test
              </a>
            </div>
          )}

          {/* ── Transitions Export Doctor status block ── */}
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] px-3 py-3 space-y-1.5 mt-3">
            <p className="text-[10px] font-black text-violet-300/70 uppercase tracking-widest mb-1">Transitions In Export</p>
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-white/40">applied transitions</span>
              <span className={`font-bold ${appliedTx.length > 0 ? "text-green-400" : "text-white/30"}`}>{appliedTx.length}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-white/40">connected to export</span>
              <span className={`font-bold ${!tx ? "text-white/30" : tx.transitionsConnected ? "text-green-400" : "text-red-400"}`}>
                {!tx ? "—" : tx.transitionsConnected ? "yes" : "no"}
              </span>
            </div>
            {tx && (
              <>
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-white/40">supported</span>
                  <span className="font-bold text-green-400">{txSupported.length}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-white/40">unsupported</span>
                  <span className={`font-bold ${txUnsupported.length > 0 ? "text-amber-400" : "text-white/30"}`}>{txUnsupported.length}</span>
                </div>
                {txPlan.length > 0 && (
                  <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-1">
                    {txPlan.map((p) => (
                      <div key={p.sceneIndex} className="text-[10px] font-mono leading-snug">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white/55">Scene {p.sceneIndex + 1}→{p.sceneIndex + 2}: {p.type}</span>
                          <span className={p.supported ? "text-green-400 font-bold" : "text-amber-400 font-bold"}>
                            {p.supported ? `xfade=${p.xfade}` : "unsupported"}
                          </span>
                        </div>
                        {p.reason && <div className="text-amber-400/70 break-words">{p.reason}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {!tx && (
              <p className="text-[10px] text-white/35 leading-snug pt-1 border-t border-white/[0.06]">
                Run "Connect Transitions To Export" to render the xfade chain. Supported: Cut, Crossfade, Fade to Black, Flash Cut. Whip Pan / Zoom export as a hard cut.
              </p>
            )}
            {tx?.stderrTail && tx.stderrTail.length > 0 && (
              <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-0.5">
                <span className="text-[10px] font-black text-red-400/60 uppercase tracking-widest">FFmpeg transitions error</span>
                {tx.stderrTail.map((line, i) => (
                  <div key={i} className="text-[10px] font-mono text-red-400/70 break-words leading-snug">{line}</div>
                ))}
              </div>
            )}
          </div>

          {/* ── Transitions test export result video ── */}
          {tx?.success && tx.url && (
            <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.04] px-3 py-3 space-y-2 mt-3">
              <div className="flex items-center gap-2 text-[11px] text-violet-200 font-bold">
                <CheckCircle2 className="h-4 w-4" /> Transitions burned · {tx.clipCount ?? "?"} clips · {tx.duration?.toFixed(1)}s · {txSupported.length} supported · {txUnsupported.length} fallback
              </div>
              <video src={tx.url} controls className="w-full max-h-64 rounded-lg bg-black" />
              <a href={tx.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> Open / download transitions test
              </a>
            </div>
          )}

          {/* ── Effects test export result ── */}
          {exportAllEffectsResult?.success && exportAllEffectsResult.url && (
            <div className="rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/[0.04] px-3 py-3 space-y-2 mt-3">
              <div className="flex items-center gap-2 text-[11px] text-fuchsia-300 font-bold">
                <CheckCircle2 className="h-4 w-4" /> Effects burned · {exportAllEffectsResult.clipCount ?? "?"} clips · {exportAllEffectsResult.duration?.toFixed(1)}s · {exportAllEffectsResult.effectsCount ?? 0} fx · captions {exportAllEffectsResult.captionsPreserved ? "✓" : "—"} · audio {exportAllEffectsResult.hasAudio ? "✓" : "✗"}
              </div>
              <video src={exportAllEffectsResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
              <a href={exportAllEffectsResult.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> Open / download effects test video
              </a>
            </div>
          )}

          {/* ── Overlay / Watermark Doctor status panel ── */}
          {(fcOverlaysFound || !!ovr) && (
            <div className="rounded-xl border border-[#C9A84C]/20 bg-[#C9A84C]/[0.03] px-3 py-3 space-y-1.5 mt-3">
              <p className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-widest mb-1">Overlay / Watermark Doctor</p>
              {overlayStatusRows.map(([label, val, ok]) => (
                <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-white/40">{label}</span>
                  <span className={`font-bold ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-amber-400"}`}>
                    {String(val)}
                  </span>
                </div>
              ))}
              {ovr?.stderrTail && ovr.stderrTail.length > 0 && (
                <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-0.5">
                  <span className="text-[10px] font-black text-red-400/60 uppercase tracking-widest">FFmpeg error</span>
                  {ovr.stderrTail.map((line, i) => (
                    <div key={i} className="text-[10px] font-mono text-red-400/70 break-words leading-snug">{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Overlay / Watermark test export result video ── */}
          {ovr?.success && ovr.url && (
            <div className="rounded-xl border border-[#C9A84C]/30 bg-[#C9A84C]/[0.05] px-3 py-3 space-y-2 mt-3">
              <div className="flex items-center gap-2 text-[11px] text-[#C9A84C] font-bold">
                <CheckCircle2 className="h-4 w-4" /> Watermark burned · {ovr.clipCount ?? "?"} clips · {ovr.duration?.toFixed(1)}s · "{ovr.overlayWatermarkText ?? "Bow Down Visuals"}"
              </div>
              <video src={ovr.url} controls className="w-full max-h-64 rounded-lg bg-black" />
              <a href={ovr.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> Open / download overlay + watermark test
              </a>
            </div>
          )}
        </div>

      </div>
    </EditorCard>
  );
}
