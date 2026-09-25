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
        <ConceptPill label="Scene Clips" desc="Silent visual scenes from Runway" />
        <ConceptPill label="Song Audio" desc="Your uploaded music track" />
        <ConceptPill label="Lip Sync" desc="Artist mouth synced to song" highlight />
        <ConceptPill label="Captions" desc="Lyric text overlaid on screen" />
      </div>

      {/* Explanation */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-2">
        <p className="text-xs font-black text-white/90">What is Lip Sync?</p>
        <p className="text-[11px] text-white/55 leading-relaxed">
          Normal Runway scene clips are{" "}
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
              Select an artist from the Artist Vault to enable lip sync
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
                    5 site credits
                  </span>{" "}
                  for the final export (charged only if the export succeeds).
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            disabled
            data-testid="btn-lipsync-from-image"
            className="h-11 flex items-center justify-start gap-2 px-4 rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm font-bold text-white/30 cursor-not-allowed"
          >
            <Mic2 className="h-4 w-4 shrink-0" />
            Create Lip Sync From Artist Image
          </button>

          <button
            type="button"
            disabled
            data-testid="btn-lipsync-from-clip"
            className="h-11 flex items-center justify-start gap-2 px-4 rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm font-bold text-white/30 cursor-not-allowed"
          >
            <Mic2 className="h-4 w-4 shrink-0" />
            Lip Sync Selected Video Clip
          </button>
        </div>

        {/* Not connected notice */}
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5">
          <Info className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-xs font-black text-amber-300">Lip Sync not connected yet</p>
            <p className="text-[11px] text-amber-200/70 leading-relaxed">
              {songReady && lyricsReady
                ? "Your uploaded song and lyrics are ready. Connect a lip sync service (Hedra, Sync.so, D-ID, or HeyGen) to animate the artist's mouth to the song."
                : "Upload your song and extract lyrics first — then connect a lip sync service to animate the artist's performance."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
