import { useEffect, useState } from "react";
import {
  Mic2,
  ImageIcon,
  Music4,
  Captions,
  Info,
  User,
  Film,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  Play,
} from "lucide-react";
import type { ArtistVault } from "@/components/ArtistVaultSelector";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { computeSceneTimings } from "@/lib/scene-timing";
import type { SceneData } from "@/lib/scene-parser";

interface LipSyncStudioProps {
  audioUrl: string | null;
  transcriptText: string | null;
  activeArtist: ArtistVault | null;
  /** Project ID — required for the one-click run-all flow */
  projectId?: string | null;
  /** Auth token getter for API calls */
  getAccessToken?: () => Promise<string | null>;
}

type RunAllSceneState = "queued" | "syncing" | "done" | "skipped" | "failed";

interface RunAllSceneStatus {
  index: number;
  sceneId: string | null;
  state: RunAllSceneState;
  lipSyncUrl?: string;
  error?: string;
}

interface RunAllStatus {
  runId: string;
  state: "running" | "done" | "failed";
  sceneCount: number;
  scenes: RunAllSceneStatus[];
  exportState: "pending" | "running" | "done" | "failed" | "skipped";
  exportJobId: string | null;
  videoUrl: string | null;
  error: string | null;
}

const SCENE_STATE_STYLE: Record<RunAllSceneState, string> = {
  queued: "bg-white/15 text-white/40",
  syncing: "bg-blue-500/20 text-blue-300",
  done: "bg-green-500/20 text-green-300",
  skipped: "bg-amber-500/20 text-amber-300",
  failed: "bg-red-500/20 text-red-300",
};

interface ConceptPillProps {
  label: string;
  desc: string;
  highlight?: boolean;
}

function ConceptPill({ label, desc, highlight }: ConceptPillProps) {
  return (
    <div
      className={`flex-1 min-w-[120px] rounded-xl border p-3 text-center ${
        highlight
          ? "border-primary/25 bg-primary/[0.05]"
          : "border-white/[0.08] bg-white/[0.02]"
      }`}
    >
      <p className={`text-xs font-black ${highlight ? "text-primary" : "text-white/75"}`}>
        {label}
      </p>
      <p className="text-[10px] text-white/40 mt-0.5 leading-relaxed">{desc}</p>
    </div>
  );
}

interface ReadyRowProps {
  icon: React.ReactNode;
  label: string;
  ready: boolean;
  value?: string;
  hint: string;
}

function ReadyRow({ icon, label, ready, value, hint }: ReadyRowProps) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${
          ready ? "bg-green-500/15 text-green-400" : "bg-white/[0.04] text-white/25"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-bold ${ready ? "text-white/80" : "text-white/40"}`}>
          {label}
          {value ? `: ${value}` : ""}
        </p>
        {!ready && <p className="text-[10px] text-white/30">{hint}</p>}
      </div>
      <div
        className={`h-2 w-2 rounded-full shrink-0 ${ready ? "bg-green-400" : "bg-white/15"}`}
      />
    </div>
  );
}

export function LipSyncStudio({
  audioUrl,
  transcriptText,
  activeArtist,
  projectId,
  getAccessToken,
}: LipSyncStudioProps) {
  const songReady = !!audioUrl;
  const lyricsReady = !!transcriptText;
  const artistReady = !!activeArtist;

  /* ── One-click run-all state ── */
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunAllStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storageKey = projectId ? `lipsync-run-all:${projectId}` : null;
  const canRun = !!projectId && !!getAccessToken;

  /* Resume watching a run that was started earlier (survives navigation). */
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setRunId(saved);
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [storageKey]);

  /* Poll the run status until it reaches a terminal state. */
  useEffect(() => {
    if (!runId || !getAccessToken) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(
          `/api/lip-sync/run/${encodeURIComponent(runId)}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!res.ok) {
          if (res.status === 404) {
            if (!cancelled) {
              setError("This run expired or was not found.");
              setRunId(null);
              setStatus(null);
            }
            if (timer) clearInterval(timer);
            return;
          }
          throw new Error(`Status check failed (HTTP ${res.status})`);
        }
        const st = (await res.json()) as RunAllStatus;
        if (cancelled) return;
        setStatus(st);
        setError(st.state === "failed" ? st.error ?? "The run failed." : null);
        if (st.state === "done" || st.state === "failed") {
          if (timer) clearInterval(timer);
          try {
            if (storageKey) localStorage.removeItem(storageKey);
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Status check failed");
      }
    };
    void poll();
    timer = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [runId, getAccessToken, storageKey]);

  const startRun = async () => {
    if (!projectId || !getAccessToken) return;
    setStarting(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/lip-sync/run-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ projectId }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        runId?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !body.runId) {
        throw new Error(
          body.message ?? body.error ?? `Failed to start (HTTP ${res.status})`,
        );
      }
      setRunId(body.runId);
      setStatus(null);
      setConfirming(false);
      try {
        if (storageKey) localStorage.setItem(storageKey, body.runId);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start the run");
    } finally {
      setStarting(false);
    }
  };

  const resetRun = () => {
    setRunId(null);
    setStatus(null);
    setError(null);
    setConfirming(false);
    try {
      if (storageKey) localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };

  /* ── Single-clip lip sync (Stack-100 #3, Lane D D-02) ──────────────────
   * The Stack-28 #43 note below kept this disabled because no per-clip rail
   * existed and the component had no clip input. Both facts changed: the
   * per-scene rail POST /api/lip-sync/scene-test (+ GET poll) is live — the
   * editor's LipSyncSection drives it — and this component can now load the
   * project's own scenes via projectId and compute their song windows with
   * the editor's own computeSceneTimings, the same source the section uses.
   * The single-IMAGE action stays disabled: no still→clip rail exists. */
  const { confirmedFetch } = useConfirmedApi();

  interface ClipSceneOption {
    index: number;
    clipUrl: string;
    startSec: number;
    endSec: number;
  }

  const [clipScenes, setClipScenes] = useState<ClipSceneOption[] | null>(null);
  const [clipScenesLoading, setClipScenesLoading] = useState(false);
  const [clipSceneIdx, setClipSceneIdx] = useState(0);
  const [clipPhase, setClipPhase] = useState<
    "idle" | "starting" | "running" | "done" | "failed"
  >("idle");
  const [clipStep, setClipStep] = useState("");
  const [clipResultUrl, setClipResultUrl] = useState<string | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const [clipJobId, setClipJobId] = useState<string | null>(null);

  const canSingleClip = Boolean(projectId && audioUrl && getAccessToken);

  useEffect(() => {
    if (!canSingleClip || !projectId || !audioUrl || !getAccessToken) return;
    let cancelled = false;
    setClipScenesLoading(true);
    void (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/projects/${projectId}`, {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          project?: {
            output_data?: { scenes?: SceneData[] };
            scenes?: SceneData[];
          };
        };
        const scenes: SceneData[] =
          data.project?.output_data?.scenes ?? data.project?.scenes ?? [];
        // Song length drives the windows — probe the audio, editor-style.
        const duration = await new Promise<number>((resolve) => {
          const a = new Audio();
          a.preload = "metadata";
          a.onloadedmetadata = () =>
            resolve(Number.isFinite(a.duration) ? a.duration : 0);
          a.onerror = () => resolve(0);
          a.src = audioUrl;
        });
        const timings = computeSceneTimings(
          scenes,
          duration > 0 ? duration : null,
        );
        const opts: ClipSceneOption[] = [];
        scenes.forEach((s, i) => {
          const url = (s as { demoClipUrl?: string }).demoClipUrl;
          const t = timings[i];
          if (url && t) {
            opts.push({
              index: i,
              clipUrl: url,
              startSec: t.startSec,
              endSec: t.endSec,
            });
          }
        });
        if (!cancelled) setClipScenes(opts);
      } catch {
        if (!cancelled) setClipScenes([]);
      } finally {
        if (!cancelled) setClipScenesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Load when the project/song pair changes; getAccessToken is a stable
    // context getter read at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, audioUrl]);

  useEffect(() => {
    if (!clipJobId || !getAccessToken) return;
    let cancelled = false;
    let ticks = 0;
    const tick = async () => {
      ticks++;
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/lip-sync/scene-test/${clipJobId}`, {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        const data = (await res.json().catch(() => ({}))) as {
          status?: string;
          step?: string;
          resultUrl?: string;
          error?: string;
        };
        if (cancelled) return;
        if (data.status === "succeeded" && data.resultUrl) {
          setClipPhase("done");
          setClipResultUrl(data.resultUrl);
          setClipJobId(null);
          return;
        }
        if (data.status === "failed") {
          setClipPhase("failed");
          setClipError(data.error ?? "Lip sync failed.");
          setClipJobId(null);
          return;
        }
        setClipStep(data.step ?? "Working…");
        if (ticks >= 120) {
          setClipPhase("failed");
          setClipError("Timed out. Check your connection and try again.");
          setClipJobId(null);
        }
      } catch {
        if (!cancelled && ticks >= 120) {
          setClipPhase("failed");
          setClipError("Could not check on the lip sync job.");
          setClipJobId(null);
        }
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [clipJobId, getAccessToken]);

  const startSingleClip = async () => {
    const scene = clipScenes?.[clipSceneIdx];
    if (
      !scene ||
      !audioUrl ||
      clipPhase === "starting" ||
      clipPhase === "running"
    )
      return;
    setClipPhase("starting");
    setClipError(null);
    setClipResultUrl(null);
    setClipStep("");
    try {
      const res = await confirmedFetch("/api/lip-sync/scene-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipUrl: scene.clipUrl,
          audioUrl,
          sceneStartSec: scene.startSec,
          sceneEndSec: scene.endSec,
          videoOffsetSec: 0,
        }),
      });
      if (res === null) {
        // User cancelled the credit confirmation.
        setClipPhase("idle");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.jobId) {
        throw new Error(
          data.message ?? data.error ?? `Could not start (HTTP ${res.status})`,
        );
      }
      setClipPhase("running");
      setClipJobId(data.jobId);
    } catch (e) {
      setClipPhase("failed");
      setClipError(
        e instanceof Error ? e.message : "Could not start lip sync.",
      );
    }
  };

  const mmss = (sec: number) => {
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const renderSceneRow = (s: RunAllSceneStatus) => (
    <div key={s.index} className="flex items-center gap-2.5 py-1">
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${SCENE_STATE_STYLE[s.state]}`}
      >
        {s.state}
      </span>
      <p className="text-xs text-white/70 flex-1">Scene {s.index + 1}</p>
      {s.state === "syncing" && (
        <Loader2 className="h-3.5 w-3.5 text-blue-300 animate-spin shrink-0" />
      )}
      {s.state === "done" && (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
      )}
      {(s.state === "failed" || s.state === "skipped") && (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Concept glossary */}
      <div className="flex flex-wrap gap-2">
        <ConceptPill label="Scene Clips" desc="Silent visual scenes, generated for you" />
        <ConceptPill label="Song Audio" desc="Your uploaded music track" />
        <ConceptPill label="Lip Sync" desc="Artist mouth synced to song" highlight />
        <ConceptPill label="Captions" desc="Lyric text overlaid on screen" />
      </div>

      {/* Explanation */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-2">
        <p className="text-xs font-black text-white/90">What is Lip Sync?</p>
        <p className="text-[11px] text-white/55 leading-relaxed">
          Normal scene clips are{" "}
          <span className="text-white/75 font-semibold">silent visual clips</span> — the artist
          looks great but doesn't perform the song. Lip Sync is a separate step that uses your
          uploaded song audio to{" "}
          <span className="text-white/75 font-semibold">
            animate the artist's mouth in sync with the lyrics
          </span>
          , creating a performance clip where the artist appears to sing the song.
        </p>
      </div>

      {/* Readiness checklist */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
        <p className="text-[10px] font-black text-white/40 uppercase tracking-wide">
          Lip Sync Readiness
        </p>
        <div className="space-y-2.5">
          <ReadyRow
            icon={<ImageIcon className="h-3 w-3" />}
            label="Artist image"
            ready={artistReady}
            value={artistReady ? activeArtist!.artist_name : undefined}
            hint="Set an Active Artist with a reference photo"
          />
          <ReadyRow
            icon={<Music4 className="h-3 w-3" />}
            label="Song audio"
            ready={songReady}
            hint="Upload a song — it appears in Music Mixer"
          />
          <ReadyRow
            icon={<Captions className="h-3 w-3" />}
            label="Song lyrics"
            ready={lyricsReady}
            hint='Click "Get Lyrics From Song" in the Song Ready card above'
          />
        </div>
      </div>

      {/* Active artist card */}
      {activeArtist ? (
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
          {activeArtist.reference_image_url ? (
            <img
              src={activeArtist.reference_image_url}
              alt={activeArtist.artist_name}
              className="h-12 w-12 rounded-lg object-cover shrink-0 border border-white/10"
            />
          ) : (
            <div className="h-12 w-12 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <User className="h-5 w-5 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-black text-white/90 truncate">{activeArtist.artist_name}</p>
            {(activeArtist.artist_type || activeArtist.genre) && (
              <p className="text-[10px] text-white/40">
                {[activeArtist.artist_type, activeArtist.genre].filter(Boolean).join(" · ")}
              </p>
            )}
            <p className="text-[10px] text-green-400/80 mt-0.5">
              Will be used as the performing artist
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
          <div className="h-8 w-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
            <User className="h-4 w-4 text-white/25" />
          </div>
          <div>
            <p className="text-xs font-bold text-white/40">No active artist</p>
            <p className="text-[10px] text-white/25">
              Select an artist from the Creator Vault to enable lip sync
            </p>
          </div>
        </div>
      )}

      {/* Lip sync actions */}
      <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Mic2 className="h-4 w-4 text-primary" />
          <p className="text-sm font-black text-white/90">Create Lip Sync Clip</p>
        </div>

        {/* ── One-click: sync all scenes & export ── */}
        <div className="rounded-xl border border-primary/30 bg-primary/[0.06] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Film className="h-4 w-4 text-primary" />
            <p className="text-sm font-black text-white/90">
              One-Click: Sync All Scenes & Export
            </p>
          </div>
          <p className="text-[11px] text-white/55 leading-relaxed">
            Lip-syncs every scene to its exact song window, saves the clips
            into your project, then runs the final export with captions and
            watermark. The run continues on the server even if you leave this
            tab — come back anytime to watch it finish.
          </p>

          {!runId && !confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!canRun}
              data-testid="btn-lipsync-run-all"
              className="h-11 w-full flex items-center justify-center gap-2 px-4 rounded-lg bg-primary text-black text-sm font-black hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play className="h-4 w-4 shrink-0" />
              Sync all scenes & export
            </button>
          )}
          {!canRun && !runId && (
            <p className="text-[10px] text-white/30">
              Open this from a saved project to enable the one-click run.
            </p>
          )}

          {confirming && !runId && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3 space-y-2.5">
              <p className="text-xs font-black text-amber-200">
                Confirm — this will cost money
              </p>
              <ul className="text-[11px] text-amber-100/75 leading-relaxed list-disc pl-4 space-y-1">
                <li>
                  <span className="font-bold text-amber-100">
                    300 Visual Bucs per scene
                  </span>{" "}
                  for lip sync — the same per-clip price as a single-clip
                  preview, charged for each scene before it runs. Scenes
                  longer than the provider limit are skipped and never
                  charged.
                </li>
                <li>
                  The final export is{" "}
                  <span className="font-bold text-amber-100">free</span>{" "}
                  when it carries the watermark. A clean export costs{" "}
                  <span className="font-bold text-amber-100">
                    400 Visual Bucs
                  </span>
                  , reserved when the export starts and charged only when
                  it succeeds.
                </li>
                <li>
                  <span className="font-bold text-amber-100">
                    Sync Labs per-second fees
                  </span>{" "}
                  (~$0.05/sec of video) billed to the connected Sync Labs
                  account for each lip-synced scene.
                </li>
              </ul>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void startRun()}
                  disabled={starting}
                  data-testid="btn-lipsync-run-all-confirm"
                  className="h-10 flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary text-black text-sm font-black hover:brightness-110 disabled:opacity-50"
                >
                  {starting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {starting ? "Starting…" : "Start the run"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={starting}
                  className="h-10 px-4 rounded-lg border border-white/15 text-sm font-bold text-white/60 hover:bg-white/5 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2.5">
              <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-200/80 leading-relaxed">{error}</p>
            </div>
          )}

          {runId && (
            <div className="rounded-lg border border-white/[0.08] bg-black/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-white/40 uppercase tracking-wide">
                  Run progress
                </p>
                {(status?.state === "done" || status?.state === "failed") && (
                  <button
                    type="button"
                    onClick={resetRun}
                    className="text-[10px] font-bold text-white/40 hover:text-white/70 underline"
                  >
                    Start a new run
                  </button>
                )}
              </div>

              {status ? (
                <>
                  <div className="divide-y divide-white/[0.05]">
                    {status.scenes.map(renderSceneRow)}
                  </div>
                  <div className="flex items-center gap-2.5 pt-1">
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                        status.exportState === "done"
                          ? "bg-green-500/20 text-green-300"
                          : status.exportState === "running"
                            ? "bg-blue-500/20 text-blue-300"
                            : status.exportState === "failed"
                              ? "bg-red-500/20 text-red-300"
                              : "bg-white/15 text-white/40"
                      }`}
                    >
                      {status.exportState === "pending"
                        ? "export queued"
                        : `export ${status.exportState}`}
                    </span>
                    <p className="text-xs text-white/70 flex-1">Final export</p>
                    {status.exportState === "running" && (
                      <Loader2 className="h-3.5 w-3.5 text-blue-300 animate-spin shrink-0" />
                    )}
                    {status.exportState === "done" && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                    )}
                  </div>

                  {status.state === "done" && status.videoUrl && (
                    <div className="rounded-lg border border-green-500/30 bg-green-500/[0.07] p-3 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                        <p className="text-xs font-black text-green-200">
                          Your lip-synced video is ready
                        </p>
                      </div>
                      <a
                        href={status.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-[11px] text-primary hover:underline"
                      >
                        {status.videoUrl}
                      </a>
                      <a
                        href={status.videoUrl}
                        download="bow-down-visuals-lip-sync.mp4"
                        data-testid="btn-lipsync-download"
                        className="h-10 w-full flex items-center justify-center gap-2 rounded-lg bg-primary text-black text-sm font-black hover:brightness-110"
                      >
                        <Download className="h-4 w-4" />
                        Download video
                      </a>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  <p className="text-xs text-white/50">Connecting to run…</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Stack-28 #43 kept both single-source actions disabled because no
            per-clip rail existed and this component had no clip input.
            Stack-100 #3 (Lane D, D-02): the per-scene rail
            (POST /api/lip-sync/scene-test) is live and the project's scenes
            are loaded above by projectId, so single-clip sync is WIRED
            below. The single-IMAGE action stays disabled + honestly
            labelled — there is still no still-image→clip rail. */}
        {canSingleClip && (
          <div
            className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 space-y-2.5"
            data-testid="lipsync-single-clip"
          >
            <p className="text-[11px] font-black text-white/70 flex items-center gap-1.5">
              <Film className="h-3.5 w-3.5 text-primary" />
              Sync one scene clip
            </p>
            {clipScenesLoading ? (
              <p className="text-[11px] text-white/40 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading this project's scene clips…
              </p>
            ) : clipScenes && clipScenes.length > 0 ? (
              <>
                <select
                  value={clipSceneIdx}
                  onChange={(e) => {
                    setClipSceneIdx(Number(e.target.value));
                    setClipPhase("idle");
                    setClipError(null);
                    setClipResultUrl(null);
                  }}
                  disabled={clipPhase === "running" || clipPhase === "starting"}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white/85"
                  data-testid="lipsync-clip-scene-select"
                  aria-label="Scene clip to lip sync"
                >
                  {clipScenes.map((s, i) => (
                    <option key={s.index} value={i}>
                      Scene {s.index + 1} · {mmss(s.startSec)}–{mmss(s.endSec)}{" "}
                      of the song
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void startSingleClip()}
                  disabled={clipPhase === "starting" || clipPhase === "running"}
                  data-testid="btn-lipsync-from-clip"
                  className="h-11 w-full flex items-center justify-center gap-2 px-4 rounded-lg bg-primary text-black text-sm font-black hover:brightness-110 disabled:opacity-50"
                >
                  {clipPhase === "starting" || clipPhase === "running" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Lip Sync Selected Video Clip
                </button>
                {clipPhase === "running" && (
                  <p className="text-[11px] text-blue-300">
                    {clipStep || "Syncing the clip to the song…"}
                  </p>
                )}
                {clipPhase === "failed" && clipError && (
                  <p className="text-[11px] text-red-300">{clipError}</p>
                )}
                {clipPhase === "done" && clipResultUrl && (
                  <div className="space-y-2">
                    <video
                      src={clipResultUrl}
                      controls
                      className="w-full rounded-lg border border-white/10"
                      data-testid="lipsync-clip-result"
                    />
                    <a
                      href={clipResultUrl}
                      download="bow-down-visuals-lip-sync-clip.mp4"
                      data-testid="btn-lipsync-clip-download"
                      className="h-10 w-full flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm font-black hover:bg-primary/20"
                    >
                      <Download className="h-4 w-4" />
                      Download synced clip
                    </a>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[11px] text-white/40 leading-relaxed">
                This project has no scene clips yet — generate scene clips in
                the editor first, then sync a single clip here.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          disabled
          title="Coming soon — turning a still artist image into a moving, lip-synced clip is not built yet. Use Sync All Scenes & Export above, or sync a single scene clip."
          data-testid="btn-lipsync-from-image"
          className="h-11 w-full flex items-center justify-start gap-2 px-4 rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm font-bold text-white/30 cursor-not-allowed"
        >
          <Mic2 className="h-4 w-4 shrink-0" />
          Create Lip Sync From Artist Image
          <span className="ml-auto shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] font-bold text-white/40">
            Coming soon
          </span>
        </button>

        {/* How it works — Stack-100 #3 (D-03): the old banner here claimed
            lip sync was not connected and told users to connect a rival
            service. Lip sync IS connected (run-all + single-clip above);
            the banner now tells the truth. */}
        <div className="flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
          <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-xs font-black text-white/80">Lip Sync is connected</p>
            <p className="text-[11px] text-white/45 leading-relaxed">
              {songReady && lyricsReady
                ? "Your song and lyrics are ready. Sync every scene with the run-all above, or sync a single scene clip on its own. Turning a still artist image into a lip-synced clip is still on the way."
                : "Add your song and lyrics above to unlock lip sync — every scene at once, or a single scene clip."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
