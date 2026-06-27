import { useState, useRef } from "react";
import {
  Mic2, Play, Save, CheckCircle2, XCircle, Loader2, AlertTriangle,
  SkipForward, Info, Radio, User, Sliders, RefreshCw, X,
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

/* ── Env / provider check ─────────────────────────────────────────────────── */
const LIP_SYNC_API_KEY   = import.meta.env.VITE_LIP_SYNC_API_KEY  as string | undefined;
const LIP_SYNC_PROVIDER  = import.meta.env.VITE_LIP_SYNC_PROVIDER as string | undefined;
const PROVIDER_CONNECTED = !!(LIP_SYNC_API_KEY && LIP_SYNC_API_KEY.length > 0);
const PROVIDER_NAME      = LIP_SYNC_PROVIDER || (PROVIDER_CONNECTED ? "Custom" : null);

/* ── Types ────────────────────────────────────────────────────────────────── */
interface LipSyncSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  /** Raw project audio URL (from project.input_data.audioUrl). */
  audioUrl?: string | null;
  /** Effective master-player audio URL (stem-aware). */
  masterAudioUrl?: string | null;
}

interface ProcessState {
  running: boolean;
  current: number;
  total: number;
  cancelled: boolean;
  lastError: string | null;
}

/* ── Helper ───────────────────────────────────────────────────────────────── */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function Toggle({
  value,
  onChange,
  label,
  sub,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
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
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean | null;
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

  const ls          = settings.lipSync;
  const ms          = settings.musicStudio;

  /* ── Process-all state ── */
  const [processState, setProcessState] = useState<ProcessState | null>(null);
  const cancelRef = useRef(false);

  /* ── Local apply state ── */
  const [applyError, setApplyError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<"single" | "all" | null>(null);

  /* ── Derived: audio source ── */
  const vocalExportUrl = ms.exports.find(r => r.kind === "acapella")?.url ?? null;
  const vocalStemUrl   =
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
  const audioReady = !!effectiveAudioUrl;

  /* ── Derived: selected scene ── */
  const clipsWithFaces = scenes.filter(s => sceneHasClip(s));
  const selectedScene  = scenes.find(s => s.id === ls.selectedSceneId) ?? clipsWithFaces[0] ?? null;
  const selectedClipEdit: ClipEdit | null = selectedScene
    ? getClipEdit(settings, selectedScene.id)
    : null;

  /* ── Derived: face detection (mock — based on whether clip URL exists) ── */
  const faceDetected   = !!selectedScene?.demoClipUrl;
  const faceConfidence = faceDetected ? "high (mock)" : "—";
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

  /* ── Apply to selected ── */
  async function applyToSelected() {
    if (!PROVIDER_CONNECTED) {
      setApplyError("Lip Sync provider not connected yet. Add VITE_LIP_SYNC_API_KEY to connect.");
      return;
    }
    if (!selectedScene) return;
    if (!faceDetected) { setApplyError("No clear face found for lip sync on this clip."); return; }
    if (!audioReady) { setApplyError("No audio source available."); return; }

    setApplyError(null);
    setConfirmOpen(null);

    updateClipEdit(selectedScene.id, { lipSyncStatus: "processing", lipSyncError: null });

    try {
      const result = await callLipSyncProvider({
        clipUrl:     selectedScene.demoClipUrl!,
        audioUrl:    effectiveAudioUrl!,
        strength:    ls.strength,
        preserveFace: ls.preserveFaceIdentity,
        provider:    PROVIDER_NAME ?? "unknown",
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
      updateClipEdit(selectedScene.id, {
        lipSyncStatus: "failed",
        lipSyncError:  msg,
      });
      setApplyError(msg);
    }
  }

  /* ── Apply to all ── */
  async function applyToAll() {
    if (!PROVIDER_CONNECTED) {
      setApplyError("Lip Sync provider not connected yet. Add VITE_LIP_SYNC_API_KEY to connect.");
      return;
    }
    const eligible = clipsWithFaces.filter(s => !!s.demoClipUrl);
    if (eligible.length === 0) { setApplyError("No clips with detectable faces found."); return; }
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
        const result = await callLipSyncProvider({
          clipUrl:      scene.demoClipUrl!,
          audioUrl:     effectiveAudioUrl!,
          strength:     ls.strength,
          preserveFace: ls.preserveFaceIdentity,
          provider:     PROVIDER_NAME ?? "unknown",
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

  function cancelAll() {
    cancelRef.current = true;
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
          lipSyncUrl:       null,
          lipSyncStatus:    null,
          lipSyncProvider:  null,
          lipSyncCreatedAt: null,
          lipSyncError:     null,
          replaceUrl:       existing.replaceUrl === existing.lipSyncUrl ? null : existing.replaceUrl,
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
              {PROVIDER_CONNECTED ? (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-green-500/30 bg-green-500/[0.06] text-green-400 text-[11px] font-semibold">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  Connected · {PROVIDER_NAME}
                </div>
              ) : (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] text-amber-400 text-[11px] font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>Lip Sync provider not connected yet.<br />
                    <span className="font-normal text-amber-400/70">Set <code className="bg-white/5 px-0.5 rounded">VITE_LIP_SYNC_API_KEY</code> and optionally <code className="bg-white/5 px-0.5 rounded">VITE_LIP_SYNC_PROVIDER</code> to connect.</span>
                  </span>
                </div>
              )}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 space-y-1.5">
                <StatusRow label="provider"          value={PROVIDER_NAME ?? "none"} ok={PROVIDER_CONNECTED} />
                <StatusRow label="mode"              value={PROVIDER_CONNECTED ? "live" : "mock / not connected"} ok={PROVIDER_CONNECTED} />
                <StatusRow label="clips lip synced"  value={`${allDoneCount} / ${scenes.length}`} ok={allDoneCount > 0 ? true : null} />
                <StatusRow label="clips processing"  value={allProcessingCount > 0 ? `${allProcessingCount} running` : "none"} ok={allProcessingCount > 0 ? null : undefined} />
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
                <StatusRow label="project audio found" value={projectAudioFound ? "yes" : "no"}       ok={projectAudioFound} />
                <StatusRow label="vocal stem found"    value={vocalStemFound    ? "yes" : "no"}       ok={vocalStemFound} />
                <StatusRow label="using full audio"    value={!vocalStemFound || ls.audioSource === "full" ? "yes" : "no"} ok={null} />
                <StatusRow label="audio ready"         value={audioReady ? "yes ✓" : "no"}            ok={audioReady} />
                <StatusRow label="effective source"    value={effectiveAudioUrl ? "loaded ✓" : "none"} ok={!!effectiveAudioUrl} />
              </div>
              {ls.audioSource === "vocals" && !vocalStemFound && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] text-amber-400/80 text-[10px]">
                  <Info className="h-3 w-3 shrink-0 mt-0.5" />
                  No vocal stem found. Export an acapella from the Music Mixer or upload a vocal stem to use isolated vocals.
                </div>
              )}
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
                    const ce       = getClipEdit(settings, scene.id);
                    const isSel    = scene.id === (ls.selectedSceneId ?? clipsWithFaces[0]?.id);
                    const status   = ce.lipSyncStatus;
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
                  <StatusRow label="scene selected"    value={`Scene ${selectedScene.sceneNumber}`}    ok={null} />
                  <StatusRow label="face found"        value={faceDetected ? "yes" : "no"}             ok={faceDetected} />
                  <StatusRow label="face confidence"   value={faceConfidence}                          ok={faceDetected ? true : false} />
                  <StatusRow label="clip source ready" value={clipSourceReady ? "yes ✓" : "no"}        ok={clipSourceReady} />
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
              {confirmOpen && (
                <div className="rounded-xl border border-primary/30 bg-primary/[0.06] px-3 py-3 space-y-2">
                  <p className="text-[11px] text-white/70 font-semibold">
                    {confirmOpen === "single"
                      ? `Apply lip sync to Scene ${selectedScene?.sceneNumber ?? "—"}?`
                      : `Apply lip sync to all ${clipsWithFaces.length} clips with faces?`}
                  </p>
                  {!PROVIDER_CONNECTED && (
                    <p className="text-[10px] text-amber-400/80">
                      ⚠ No credits will be charged — provider not yet connected.
                    </p>
                  )}
                  {PROVIDER_CONNECTED && (
                    <p className="text-[10px] text-white/40">
                      Processing will begin immediately. Charges apply only on successful results.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={confirmOpen === "single" ? applyToSelected : applyToAll}
                      className="flex-1 py-1.5 rounded-lg bg-primary text-black text-[11px] font-bold hover:bg-primary/90 transition-colors"
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
              )}

              {/* Apply to selected */}
              {!confirmOpen && selectedScene && (
                <button
                  type="button"
                  disabled={!faceDetected || !audioReady || selectedClipEdit?.lipSyncStatus === "processing"}
                  onClick={() => { setApplyError(null); setConfirmOpen("single"); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-primary/40 bg-primary/[0.08] text-primary text-[11px] font-bold hover:bg-primary/[0.15] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="btn-lip-sync-apply-selected"
                >
                  {selectedClipEdit?.lipSyncStatus === "processing"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Mic2 className="h-3.5 w-3.5" />}
                  Apply to Scene {selectedScene.sceneNumber}
                </button>
              )}

              {/* Apply to all */}
              {!confirmOpen && !processState?.running && (
                <button
                  type="button"
                  disabled={clipsWithFaces.length === 0 || !audioReady}
                  onClick={() => { setApplyError(null); setConfirmOpen("all"); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-white/60 text-[11px] font-bold hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="btn-lip-sync-apply-all"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  Apply to All {clipsWithFaces.length} Clips
                </button>
              )}

              {/* Progress bar */}
              {processState?.running && (
                <div className="rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-primary">
                      Lip Sync {processState.current} of {processState.total}
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
                    : "border-green-500/30 bg-green-500/[0.06] text-green-400"
                }`}>
                  {processState.cancelled
                    ? <><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Cancelled at {processState.current} of {processState.total}</>
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

                {selectedClipEdit.lipSyncStatus === "done" && selectedClipEdit.lipSyncUrl && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-green-500/30 bg-green-500/[0.06] text-green-400 text-[11px] font-semibold">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Lip sync result active — master player uses lip synced clip
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const url = selectedClipEdit.lipSyncUrl!;
                          window.open(url, "_blank");
                        }}
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
                const ce = getClipEdit(settings, scene.id);
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
   Lip Sync Provider Wrapper
   Swap this function body when a real API key is available.
   Current: always throws "provider not connected".
══════════════════════════════════════════════════════════════════════════ */
interface LipSyncRequest {
  clipUrl:      string;
  audioUrl:     string;
  strength:     LipSyncStrength;
  preserveFace: boolean;
  provider:     string;
}

interface LipSyncResult {
  url:      string;
  provider: string;
}

async function callLipSyncProvider(_req: LipSyncRequest): Promise<LipSyncResult> {
  if (!PROVIDER_CONNECTED) {
    throw new Error("Lip Sync provider not connected yet. Set VITE_LIP_SYNC_API_KEY to enable.");
  }

  /* ── Real implementation goes here ── */
  /* Example (pseudo-code):
  const res = await fetch("https://api.your-provider.com/lip-sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${LIP_SYNC_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ video_url: req.clipUrl, audio_url: req.audioUrl, strength: req.strength }),
  });
  if (!res.ok) throw new Error(`Provider error: HTTP ${res.status}`);
  const data = await res.json();
  return { url: data.result_url, provider: req.provider };
  */

  throw new Error("Lip Sync provider not connected yet.");
}
