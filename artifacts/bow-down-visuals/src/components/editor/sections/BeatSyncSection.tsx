import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Loader2, Scissors, X, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { EditorSettings, VideoChapter } from "@/lib/editor-settings";
import { EditorCard } from "@/components/editor/controls";
import { PlanNote } from "@/components/editor/sections/shared";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Beat-Sync Cuts ──────────────────────────────────────────────────────
 * Detects beats in the project's audio (server-side, offline onset
 * detection — see /api/wave9b/beats/detect, 150 Visual Bucs), renders the
 * beat timestamps as editable markers on a timeline strip, and applies
 * cuts at the kept markers.
 *
 * DOCK: video-editor.tsx — "timeline" tab area, next to TimelineSection.
 * PROPS: scenes/settings/setSettings/audioUrl/durationSec/onSeek/projectKey.
 *
 * Timeline-model note: EditorSettings has no sub-scene split points, so
 * "Apply cuts" (1) writes kept beat markers as VideoChapter[] into
 * settings.chapters (persisted per project, exported to YouTube), and
 * (2) saves the kept cut plan to localStorage (key below) for the
 * timeline dock + export pipeline. Real split-point export wiring is a
 * documented follow-up — cuts are NOT faked into the export.
 *
 * HANDOFF: kept marker times are reported via onMarkersChange so the
 * Timeline Edit Recipes section can snap jump-cuts to the beat grid.
 */

const CREDIT_COST = 150;
const BEATCUT_PLAN_KEY = (projectKey: string) => `wave9b-beatcuts-${projectKey}`;

export interface BeatMarker {
  id: string;
  time: number;
  keep: boolean;
}

function fmtSecs(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

interface BeatSyncSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  audioUrl?: string | null;
  durationSec?: number | null;
  onSeek?: (sec: number) => void;
  /** Stable project id — scopes the localStorage cut plan. */
  projectKey?: string;
  /** Receives kept marker times (seconds) whenever they change. */
  onMarkersChange?: (times: number[]) => void;
  /** Applies kept cut times as real scene splits in the timeline.
      Returns the number of cuts applied. */
  onApplyCuts?: (cuts: number[]) => number;
}

export function BeatSyncSection({
  scenes,
  settings,
  setSettings,
  audioUrl = null,
  durationSec = null,
  onSeek,
  projectKey = "default",
  onMarkersChange,
  onApplyCuts,
}: BeatSyncSectionProps) {
  const { t } = useTranslation();
  const ns = "wave9.beatSync";
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  const [markers, setMarkers] = useState<BeatMarker[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "detecting" | "review">("idle");
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [applied, setApplied] = useState(false);

  const totalDuration = durationSec && durationSec > 0 ? durationSec : null;

  useEffect(() => {
    onMarkersChange?.(markers.filter((m) => m.keep).map((m) => m.time).sort((a, b) => a - b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);

  async function detectBeats() {
    if (!audioUrl || phase === "detecting") return;
    setError(null);
    setOutOfCredits(false);
    setApplied(false);
    try {
      const res = await confirmedFetch("/api/wave9b/beats/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: audioUrl }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (res.status === 503) {
        throw new Error(
          typeof data.message === "string" ? data.message : t(`${ns}.errorUnavailable`)
        );
      }
      if (!res.ok || !Array.isArray(data.beats)) {
        throw new Error(
          typeof data.error === "string" ? data.error : t(`${ns}.errorGeneric`)
        );
      }
      const list: BeatMarker[] = (data.beats as number[])
        .filter((t) => typeof t === "number" && isFinite(t) && t >= 0)
        .slice(0, 400)
        .map((t, i) => ({ id: `beat-${i}`, time: Math.round(t * 100) / 100, keep: true }));
      setMarkers(list);
      setBpm(typeof data.bpm === "number" ? data.bpm : null);
      setMethod(typeof data.method === "string" ? data.method : null);
      setPhase("review");
      toast({
        title: t(`${ns}.detectedTitle`),
        description: t(`${ns}.detectedToast`, {
          n: list.length,
          desc: typeof data.bpm === "number" ? ` at ~${data.bpm} BPM` : "",
        }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t(`${ns}.errorGeneric`));
    }
  }

  function nudgeMarker(id: string, delta: number) {
    setMarkers((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, time: Math.max(0, Math.round((m.time + delta) * 100) / 100) }
          : m
      )
    );
    setApplied(false);
  }

  function dismissMarker(id: string) {
    setMarkers((prev) => prev.filter((m) => m.id !== id));
    setApplied(false);
  }

  function toggleKeep(id: string) {
    setMarkers((prev) => prev.map((m) => (m.id === id ? { ...m, keep: !m.keep } : m)));
    setApplied(false);
  }

  function setAllKeep(keep: boolean) {
    setMarkers((prev) => prev.map((m) => ({ ...m, keep })));
    setApplied(false);
  }

  const keptMarkers = markers.filter((m) => m.keep).sort((a, b) => a.time - b.time);

  /** Apply cuts at kept markers:
   *  1) chapters — persisted in the project, exported to YouTube.
   *  2) beatCutPlan in localStorage — the export pipeline consumes cut
   *     points from here.
   *  3) real scene splits — via onApplyCuts, clips are actually divided
   *     in the timeline model (same semantics as the S split tool). */
  function applyCuts() {
    if (keptMarkers.length === 0) return;
    const chapters: VideoChapter[] = keptMarkers.map((m, i) => ({
      title: t(`${ns}.chapterTitle`, { n: i + 1 }),
      startSec: m.time,
      endSec: m.time,
    }));
    // Keep any non-beat chapters the user already had.
    const existing = (settings.chapters ?? []).filter((c) => !c.title.startsWith(t(`${ns}.chapterPrefix`)));
    setSettings({ ...settings, chapters: [...existing, ...chapters].sort((a, b) => a.startSec - b.startSec) });

    try {
      localStorage.setItem(
        BEATCUT_PLAN_KEY(projectKey),
        JSON.stringify({
          cuts: keptMarkers.map((m) => m.time),
          bpm,
          createdAt: new Date().toISOString(),
        })
      );
    } catch {
      /* storage full/blocked — chapters still carry the markers */
    }

    // Real splits in the timeline model (no-op when the host doesn't wire onApplyCuts).
    const splitCount = onApplyCuts ? onApplyCuts(keptMarkers.map((m) => m.time)) : 0;

    // Mark the plan visible in the review strip; chapters carry the persisted markers.
    setApplied(true);
    toast({
      title: "Beat cuts applied",
      description:
        splitCount > 0
          ? `${splitCount} cut${splitCount === 1 ? "" : "s"} sliced into clips on the timeline.`
          : `${keptMarkers.length} cut points saved as chapter markers.`,
    });
  }

  const keptCount = keptMarkers.length;

  return (
    <EditorCard
      title="Beat-Sync Cuts"
      subtitle={`Cut on the beat — ${CREDIT_COST} Visual Bucs per detection`}
      icon={<Activity className="h-4 w-4" />}
      data-testid="wave9b-beatsync"
    >
      <div className="space-y-4">
        {outOfCredits && <OutOfCredits />}

        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200/80">{error}</p>
          </div>
        )}

        {phase === "idle" && (
          <div className="space-y-3">
            <p className="text-sm text-white/60 leading-relaxed">
              Finds the beats in your track and drops cut markers on the timeline, so every
              clip change lands on the downbeat. Markers are editable — keep, nudge, or
              dismiss each one before cutting.
            </p>
            {!audioUrl && (
              <p className="text-xs text-white/40">
                Add project audio first — beat detection needs a track to listen to.
              </p>
            )}
            <button
              type="button"
              onClick={detectBeats}
              disabled={!audioUrl}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
                bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20
                disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="wave9b-beats-detect"
            >
              <Activity className="h-4 w-4" />
              Detect beats ({CREDIT_COST} VB)
            </button>
          </div>
        )}

        {phase === "detecting" && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">Listening for beats…</p>
            <p className="text-sm text-white/40 mt-1">Offline analysis — safe to wait, nothing is rendered yet.</p>
          </div>
        )}

        {phase === "review" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-bold text-white/80">
                {markers.length} markers
                {bpm != null && <span className="text-white/40 font-normal"> · ~{bpm} BPM</span>}
                {method && <span className="text-white/25 font-normal"> · {method}</span>}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAllKeep(true)}
                  className="text-[11px] font-bold text-white/40 hover:text-white/70 transition-colors"
                >
                  Keep all
                </button>
                <button
                  type="button"
                  onClick={() => setAllKeep(false)}
                  className="text-[11px] font-bold text-white/40 hover:text-white/70 transition-colors"
                >
                  Dismiss all
                </button>
                <button
                  type="button"
                  onClick={() => { setPhase("idle"); setMarkers([]); setApplied(false); }}
                  className="text-[11px] font-bold text-white/40 hover:text-white/70 transition-colors"
                >
                  Start over
                </button>
              </div>
            </div>

            {/* ── Marker strip ── */}
            <div
              className="relative h-14 rounded-xl border border-white/[0.08] bg-black/40 overflow-hidden"
              data-testid="wave9b-beat-strip"
              title={totalDuration ? "Beat markers — click one to seek" : "Beat markers"}
            >
              {totalDuration &&
                keptMarkers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSeek?.(m.time)}
                    className="absolute top-1 bottom-1 w-[3px] -translate-x-1/2 rounded-full bg-[#C9A84C] hover:bg-[#e8c96a] transition-colors"
                    style={{ left: `${Math.min(100, (m.time / totalDuration) * 100)}%` }}
                    title={`${fmtSecs(m.time)} — seek`}
                  />
                ))}
              {totalDuration == null && (
                <p className="absolute inset-0 flex items-center justify-center text-[11px] text-white/30">
                  {markers.length} markers found — playhead mapping needs the track duration.
                </p>
              )}
            </div>

            {/* ── Marker list (editable) ── */}
            <div className="max-h-56 overflow-y-auto rounded-xl border border-white/[0.08] divide-y divide-white/[0.05]">
              {markers.map((m) => (
                <div
                  key={m.id}
                  className={`flex items-center gap-2 px-3 py-1.5 transition-colors ${m.keep ? "" : "opacity-40"}`}
                  data-testid={`wave9b-marker-${m.id}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleKeep(m.id)}
                    title={m.keep ? "Dismiss this marker" : "Keep this marker"}
                    className={`h-4 w-4 rounded-full border shrink-0 transition-colors ${
                      m.keep ? "bg-[#C9A84C] border-[#C9A84C]" : "border-white/25 bg-transparent"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => onSeek?.(m.time)}
                    className="text-[11px] font-mono text-white/60 hover:text-white w-14 text-left shrink-0"
                    title="Seek to this beat"
                  >
                    {fmtSecs(m.time)}
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => nudgeMarker(m.id, -0.05)}
                      title="Nudge 0.05s earlier"
                      className="h-6 w-6 rounded-md border border-white/10 text-white/50 hover:text-white hover:bg-white/10 flex items-center justify-center"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => nudgeMarker(m.id, 0.05)}
                      title="Nudge 0.05s later"
                      className="h-6 w-6 rounded-md border border-white/10 text-white/50 hover:text-white hover:bg-white/10 flex items-center justify-center"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => dismissMarker(m.id)}
                    title="Remove marker"
                    className="h-6 w-6 rounded-md text-white/30 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={applyCuts}
              disabled={keptCount === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
                bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20
                disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="wave9b-beats-apply"
            >
              <Scissors className="h-4 w-4" />
              Apply cuts ({keptCount})
            </button>

            {applied && (
              <div className="flex items-start gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
                <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                <p className="text-sm text-green-200/80">
                  {keptCount} cut points saved as chapter markers. They also feed the Timeline
                  Edit Recipes — jump-cuts can snap to this beat grid.
                </p>
              </div>
            )}

            <PlanNote text="Beat cuts are saved as an edit plan — chapter markers now, clip splits on export when the beat-cut export step ships." />
          </div>
        )}
      </div>
    </EditorCard>
  );
}
