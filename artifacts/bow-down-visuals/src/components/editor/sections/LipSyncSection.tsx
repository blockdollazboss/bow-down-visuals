import { useState, useRef, useEffect, useCallback } from "react";
import {
  Mic2, Play, Save, CheckCircle2, XCircle, Loader2, AlertTriangle,
  SkipForward, Info, Radio, User, Sliders, RefreshCw, X, Upload, Music,
  KeyRound, FlaskConical,
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

  /* ── Derived: selected scene ── */
  const clipsWithFaces  = scenes.filter(s => sceneHasClip(s));
  const selectedScene   = scenes.find(s => s.id === ls.selectedSceneId) ?? clipsWithFaces[0] ?? null;
  const selectedClipEdit: ClipEdit | null = selectedScene
    ? getClipEdit(settings, selectedScene.id)
    : null;

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

  /* ── Apply to selected ── */
  async function applyToSelected() {
    if (!selectedScene) return;
    if (!faceDetected)  { setApplyError("No clear face found for lip sync on this clip."); return; }

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

    setApplyError(null);
    setConfirmOpen(null);
    updateClipEdit(selectedScene.id, { lipSyncStatus: "processing", lipSyncError: null });

    try {
      const timing = parseSceneTiming(selectedScene, scenes);
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
      });

      updateClipEdit(selectedScene.id, {
        lipSyncUrl:       result.url,
        lipSyncStatus:    "done",
        lipSyncProvider:  result.provider,
        lipSyncCreatedAt: new Date().toISOString(),
        lipSyncError:     null,
        replaceUrl:       result.url,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateClipEdit(selectedScene.id, { lipSyncStatus: "failed", lipSyncError: msg });
      setApplyError(msg);
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

      try {
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
        });
        updateClipEdit(scene.id, {
          lipSyncUrl:       result.url,
          lipSyncStatus:    "done",
          lipSyncProvider:  result.provider,
          lipSyncCreatedAt: new Date().toISOString(),
          lipSyncError:     null,
          replaceUrl:       result.url,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateClipEdit(scene.id, { lipSyncStatus: "failed", lipSyncError: msg });
        setProcessState(p => p ? { ...p, lastError: `Scene ${scene.sceneNumber}: ${msg}` } : null);
      }
    }

    setProcessState(p => p ? { ...p, running: false } : null);
  }

  function cancelAll() { cancelRef.current = true; }

  /* ── Clear result ── */
  function clearLipSync(sceneId: string) {
    const existing = getClipEdit(settings, sceneId);
    setSettings({
      ...settings,
      clips: {
        ...settings.clips,
        [sceneId]: {
          ...existing,
          lipSyncUrl:       null,
          lipSyncStatus:    null,
          lipSyncProvider:  null,
          lipSyncCreatedAt: null,
          lipSyncError:     null,
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
              <button
                type="button"
                onClick={() => void fetchProviderStatus()}
                disabled={providerLoading}
                className="flex items-center gap-1.5 text-[10px] text-white/30 hover:text-white/60 transition-colors disabled:opacity-40"
              >
                <RefreshCw className="h-3 w-3" /> Refresh status
              </button>
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
                const timing = (confirmOpen === "single" && selectedScene)
                  ? parseSceneTiming(selectedScene, scenes)
                  : null;
                const segmentDuration = timing?.durationSec ?? 0;
                const safeToSubmit    = !timing || !providerConnected || demoMode || segmentDuration <= PROVIDER_LIMIT_SEC;

                return (
                  <div className="rounded-xl border border-primary/30 bg-primary/[0.06] px-3 py-3 space-y-2">
                    <p className="text-[11px] text-white/70 font-semibold">
                      {demoMode
                        ? confirmOpen === "single"
                          ? `Run Demo simulation on Scene ${selectedScene?.sceneNumber ?? "—"}?`
                          : `Run Demo simulation on all ${clipsWithFaces.length} clips?`
                        : confirmOpen === "single"
                          ? `Apply lip sync to Scene ${selectedScene?.sceneNumber ?? "—"}?`
                          : `Apply lip sync to all ${clipsWithFaces.length} clips with faces?`}
                    </p>

                    {/* Submit Preview — single scene only, real mode */}
                    {confirmOpen === "single" && selectedScene && !demoMode && timing && (
                      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 space-y-1.5">
                        <p className="text-[10px] font-bold text-white/35 uppercase tracking-widest pb-0.5">
                          Lip Sync Submit Preview
                        </p>
                        <StatusRow label="selected scene"      value={`Scene ${selectedScene.sceneNumber}`}                 ok={null} />
                        <StatusRow label="scene start"         value={fmtSec(timing.startSec)}                              ok={null} />
                        <StatusRow label="scene end"           value={`${fmtSec(timing.endSec)}${timing.hasExplicitEnd ? "" : " (estimated)"}`} ok={null} />
                        <StatusRow label="audio segment"       value={`${timing.durationSec.toFixed(1)}s`}                  ok={safeToSubmit ? true : false} />
                        <StatusRow label="provider limit"      value={`${PROVIDER_LIMIT_SEC}s`}                             ok={null} />
                        <StatusRow label="safe to submit"      value={safeToSubmit ? "yes" : "no"}                          ok={safeToSubmit ? true : false} />
                      </div>
                    )}

                    {/* Over-limit warning */}
                    {!safeToSubmit && (
                      <div className="flex items-start gap-1.5 text-[10px] text-red-400/90 font-semibold">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                        Selected scene audio is longer than your Sync Labs plan limit ({PROVIDER_LIMIT_SEC}s). Trim the scene or upgrade your plan.
                      </div>
                    )}

                    {demoMode ? (
                      <div className="flex items-center gap-1.5 text-[10px] text-blue-400/80">
                        <FlaskConical className="h-3 w-3 shrink-0" />
                        Demo mode — no real API call will be made. No credits charged.
                      </div>
                    ) : !providerConnected ? (
                      <p className="text-[10px] text-amber-400/80">
                        ⚠ Provider not connected — add <code className="bg-white/5 px-0.5 rounded">LIP_SYNC_API_KEY</code> in Replit Secrets.
                      </p>
                    ) : safeToSubmit ? (
                      <p className="text-[10px] text-white/40">
                        Only the scene audio segment will be sent to Sync Labs — not the full song.
                      </p>
                    ) : null}

                    {!demoMode && usingFullMix && ls.audioSource === "vocals" && (
                      <p className="text-[10px] text-amber-400/70">
                        ⚠ No vocal stem found — using full mix. Accuracy may be lower.
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!safeToSubmit}
                        onClick={confirmOpen === "single" ? () => void applyToSelected() : () => void applyToAll()}
                        className="flex-1 py-1.5 rounded-lg bg-primary text-black text-[11px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmOpen(null)}
                        className="flex-1 py-1.5 rounded-lg border border-white/10 text-white/50 text-[11px] font-semibold hover:bg-white/[0.04] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Apply to selected */}
              {!confirmOpen && selectedScene && (
                <button
                  type="button"
                  disabled={!faceDetected || (!demoMode && !audioReady) || selectedClipEdit?.lipSyncStatus === "processing"}
                  onClick={() => { setApplyError(null); setConfirmOpen("single"); }}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    demoMode
                      ? "border-blue-500/30 bg-blue-500/[0.06] text-blue-400 hover:bg-blue-500/[0.12]"
                      : "border-primary/40 bg-primary/[0.08] text-primary hover:bg-primary/[0.15]"
                  }`}
                  data-testid="btn-lip-sync-apply-selected"
                >
                  {selectedClipEdit?.lipSyncStatus === "processing"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : demoMode ? <FlaskConical className="h-3.5 w-3.5" /> : <Mic2 className="h-3.5 w-3.5" />}
                  {demoMode ? "Simulate" : "Apply to"} Scene {selectedScene.sceneNumber}
                </button>
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
              <div className="space-y-2">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                  <StatusRow label="status"    value={selectedClipEdit.lipSyncStatus ?? "none"}    ok={selectedClipEdit.lipSyncStatus === "done" ? true : selectedClipEdit.lipSyncStatus === "failed" ? false : null} />
                  <StatusRow label="provider"  value={selectedClipEdit.lipSyncProvider ?? "—"}     ok={null} />
                  <StatusRow label="created"   value={fmtDate(selectedClipEdit.lipSyncCreatedAt)}  ok={null} />
                  <StatusRow label="result url" value={selectedClipEdit.lipSyncUrl ? "saved ✓" : "none"} ok={!!selectedClipEdit.lipSyncUrl} />
                  {selectedClipEdit.lipSyncError && (
                    <StatusRow label="last error" value={selectedClipEdit.lipSyncError.slice(0, 60)} ok={false} />
                  )}
                </div>

                {/* Demo run result */}
                {demoRunSet.has(selectedScene.id) && !selectedClipEdit.lipSyncUrl && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-blue-500/30 bg-blue-500/[0.06] text-blue-400 text-[11px] font-semibold">
                    <FlaskConical className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>Demo simulation complete.<br />
                      <span className="font-normal text-blue-400/70">No real API call was made. Connect a provider to run real lip sync.</span>
                    </span>
                  </div>
                )}

                {selectedClipEdit.lipSyncStatus === "done" && selectedClipEdit.lipSyncUrl && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-green-500/30 bg-green-500/[0.06] text-green-400 text-[11px] font-semibold">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Lip sync result active — master player uses lip synced clip
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => window.open(selectedClipEdit.lipSyncUrl!, "_blank")}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/60 text-[11px] font-semibold hover:bg-white/[0.06] transition-colors"
                      >
                        <Play className="h-3 w-3" /> Preview Result
                      </button>
                      <button
                        type="button"
                        onClick={() => clearLipSync(selectedScene.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-500/20 bg-red-500/[0.04] text-red-400/70 text-[11px] font-semibold hover:bg-red-500/[0.08] transition-colors"
                      >
                        <RefreshCw className="h-3 w-3" /> Clear Result
                      </button>
                    </div>
                  </div>
                )}
              </div>
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
}

interface LipSyncResult {
  url:      string;
  provider: string;
}

async function callLipSyncBackend(req: LipSyncBackendRequest): Promise<LipSyncResult> {
  const token = await req.getAccessToken();
  const res = await fetch("/api/lip-sync/preview", {
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
    signal: AbortSignal.timeout(480_000),
  });

  const data = await res.json() as { url?: string; provider?: string; error?: string; code?: string };

  if (!res.ok || !data.url) {
    throw new Error(data.error ?? `Lip sync failed: HTTP ${res.status}`);
  }

  return {
    url:      data.url,
    provider: data.provider ?? "connected",
  };
}
