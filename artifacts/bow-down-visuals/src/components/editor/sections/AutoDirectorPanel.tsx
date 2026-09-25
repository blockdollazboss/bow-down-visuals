import { useState } from "react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import {
  Clapperboard, Sparkles, Plus, Trash2, ChevronDown, Pencil, Check, Copy, Loader2, AlertTriangle,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionLine } from "@/lib/editor-settings";
import { computeSceneTimings, formatTimestampRange } from "@/lib/scene-timing";

/* ── Auto Director ────────────────────────────────────────────────
   Turns the song into a shoot-ready video plan — automatic (AI designs
   scenes timed to the music with elite Runway prompts) or manual (build
   the plan by hand). The plan is reviewed/edited here, then applied to
   the timeline with one click. */

export interface PlanScene {
  startSec: number;
  endSec: number;
  section: string;
  title: string;
  lyricCue: string;
  location: string;
  action: string;
  camera: string;
  lighting: string;
  mood: string;
  videoPrompt: string;
  negativePrompt: string;
}

export interface DirectorPlan {
  treatment: string;
  colorPalette: string[];
  visualStyle: string;
  pacingNotes: string;
  suggestedArtist: string;
  scenes: PlanScene[];
}

interface AutoDirectorPanelProps {
  scenes: SceneData[];
  setScenes: (s: SceneData[]) => void;
  captions: CaptionLine[];
  totalDurationSec: number | null;
  songTitle: string;
  artistName: string;
  artistVault: unknown;
  getAccessToken?: () => Promise<string | null>;
  onMutated: () => void;
}

const DEFAULT_NEGATIVE_PROMPT =
  "distorted face, deformed hands, extra fingers, extra limbs, blurry, low quality, watermark, text overlay, cartoon, anime, oversaturated, harsh shadows on face";

function blankPlanScene(startSec: number, endSec: number): PlanScene {
  return {
    startSec, endSec,
    section: "", title: "", lyricCue: "", location: "", action: "",
    camera: "", lighting: "", mood: "", videoPrompt: "", negativePrompt: DEFAULT_NEGATIVE_PROMPT,
  };
}

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AutoDirectorPanel({
  scenes, setScenes, captions, totalDurationSec,
  songTitle, artistName, artistVault, getAccessToken, onMutated,
}: AutoDirectorPanelProps) {
  const { confirmedFetch } = useConfirmedApi();
  const [expanded, setExpanded] = useState(true);
  const [videoStyle, setVideoStyle] = useState("Cinematic");
  const [directorNotes, setDirectorNotes] = useState("");
  const [plan, setPlan] = useState<DirectorPlan | null>(null);
  const [drafts, setDrafts] = useState<PlanScene[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [copiedArtist, setCopiedArtist] = useState(false);
  const [openSceneIdx, setOpenSceneIdx] = useState<number | null>(0);

  const durationSec = totalDurationSec ?? 0;
  const canGenerate = durationSec > 0 && !generating;

  function updateDraft(i: number, patch: Partial<PlanScene>) {
    setDrafts((d) => d.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    setApplyMsg(null);
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setApplyMsg(null);
    try {
      const token = await getAccessToken?.();
      if (!token) throw new Error("Not signed in — please refresh and sign in.");
      if (!(durationSec > 0)) throw new Error("No song duration found — add audio first.");

      const timings = computeSceneTimings(scenes, durationSec);
      const sections = scenes.map((s, i) => ({
        name: s.section || `Scene ${i + 1}`,
        startSec: timings[i]?.startSec ?? 0,
        endSec: timings[i]?.endSec ?? 0,
      }));

      const res = await confirmedFetch("/api/auto-video-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          songTitle: songTitle || "Untitled",
          artistName: artistName || "Unknown Artist",
          videoStyle,
          durationSec,
          transcript: captions.map((l) => ({ start: l.startSec, end: l.endSec, text: l.text })),
          sections,
          instructions: directorNotes.trim() || undefined,
          artistVault: (artistVault as Record<string, unknown> | null) ?? undefined,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as {
        plan?: DirectorPlan; error?: string; message?: string;
      };
      if (!res.ok) throw new Error(data.error || data.message || `Plan failed (${res.status})`);
      if (!data.plan || !Array.isArray(data.plan.scenes) || data.plan.scenes.length === 0) {
        throw new Error("The director returned an empty plan — try again.");
      }
      setPlan(data.plan);
      setDrafts(data.plan.scenes);
      setOpenSceneIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Plan generation failed");
    } finally {
      setGenerating(false);
    }
  }

  function startBlankPlan() {
    setError(null);
    setApplyMsg(null);
    const end = durationSec > 0 ? Math.min(30, durationSec) : 30;
    const blank: DirectorPlan = {
      treatment: "", colorPalette: [], visualStyle: "", pacingNotes: "",
      suggestedArtist: "", scenes: [],
    };
    setPlan(blank);
    setDrafts([blankPlanScene(0, end)]);
    setOpenSceneIdx(0);
  }

  function addDraftScene() {
    setDrafts((d) => {
      const last = d[d.length - 1];
      const start = last ? last.endSec : 0;
      const end = Math.min(start + 15, durationSec > 0 ? durationSec : start + 15);
      return [...d, blankPlanScene(start, Math.max(end, start + 1))];
    });
    setOpenSceneIdx(drafts.length);
  }

  function removeDraftScene(i: number) {
    setDrafts((d) => d.filter((_, j) => j !== i));
  }

  function applyToTimeline() {
    const list = [...drafts]
      .sort((a, b) => a.startSec - b.startSec)
      .filter((s) => s.endSec > s.startSec && s.videoPrompt.trim().length > 0);
    if (list.length === 0) {
      setError("Add at least one scene with a video prompt before applying.");
      return;
    }
    const clipsAttached = scenes.filter((s) => s.demoClipUrl).length;
    if (clipsAttached > 0) {
      const ok = window.confirm(
        `Replace the timeline with this ${list.length}-scene plan?\n\n${clipsAttached} existing scene(s) already have clips — those clips will be detached (not deleted).`,
      );
      if (!ok) return;
    }
    const mapped: SceneData[] = list.map((p, i) => ({
      id: crypto.randomUUID(),
      sceneNumber: i + 1,
      timestamp: formatTimestampRange(p.startSec, p.endSec),
      section: p.section.trim() || `Scene ${i + 1}`,
      lyricLine: p.lyricCue,
      location: p.location,
      action: p.action,
      cameraMovement: p.camera,
      lighting: p.lighting,
      mood: p.mood,
      aiVideoPrompt: p.videoPrompt.trim(),
      negativePrompt: p.negativePrompt.trim() || DEFAULT_NEGATIVE_PROMPT,
      approved: false,
      demoClipUrl: null,
      thumbnailUrl: null,
      clipId: null,
      runwayJobId: null,
      provider: null,
      generationStatus: null,
      promptUsed: null,
      generatedAt: null,
    }));
    setScenes(mapped);
    onMutated();
    setError(null);
    setApplyMsg(`Applied ${mapped.length} scene${mapped.length === 1 ? "" : "s"} to the timeline — prompts are loaded and ready to generate.`);
  }

  function copyArtist() {
    if (!plan?.suggestedArtist) return;
    void navigator.clipboard.writeText(plan.suggestedArtist).then(() => {
      setCopiedArtist(true);
      setTimeout(() => setCopiedArtist(false), 2000);
    });
  }

  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.07] to-transparent overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 shrink-0">
          <Clapperboard className="h-4.5 w-4.5 text-primary" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-white">Auto Director</span>
          <span className="block text-xs text-white/45 truncate">
            Song → shoot-ready video plan with elite prompts. Automatic or build it by hand.
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 text-white/40 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Controls */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Video style</span>
              <input
                value={videoStyle}
                onChange={(e) => setVideoStyle(e.target.value)}
                placeholder="Cinematic"
                className="mt-1 w-full rounded-lg bg-white/[0.04] border border-white/10 px-2.5 py-1.5 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50"
              />
            </label>
            <div className="flex items-end">
              <span className="text-[10px] text-white/35 pb-2">
                {durationSec > 0 ? `Song: ${fmtClock(durationSec)}` : "Add audio to set duration"}
                {captions.length > 0 ? ` · ${captions.length} lyric lines` : ""}
              </span>
            </div>
          </div>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Director notes (optional)</span>
            <textarea
              value={directorNotes}
              onChange={(e) => setDirectorNotes(e.target.value)}
              placeholder="e.g. The artist wears a crown the whole time. Dark, royal, triumphant. No nightclubs."
              rows={2}
              className="mt-1 w-full rounded-lg bg-white/[0.04] border border-white/10 px-2.5 py-1.5 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 resize-none"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-black disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? "Directing…" : "Generate plan from song · 2 credits"}
            </button>
            <button
              type="button"
              onClick={startBlankPlan}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/[0.06]"
            >
              <Pencil className="h-3.5 w-3.5" />
              Manual plan
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}
          {applyMsg && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-green-500/10 border border-green-500/20">
              <Check className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" />
              <p className="text-xs text-green-300">{applyMsg}</p>
            </div>
          )}

          {/* Plan treatment */}
          {plan && (plan.treatment || plan.visualStyle || plan.colorPalette.length > 0) && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-1.5">
              {plan.treatment && <p className="text-xs text-white/60 leading-relaxed"><span className="font-bold text-white/80">Vision — </span>{plan.treatment}</p>}
              {plan.visualStyle && <p className="text-xs text-white/45"><span className="font-semibold text-white/65">Style — </span>{plan.visualStyle}</p>}
              {plan.colorPalette.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-white/40 font-semibold">Palette:</span>
                  {plan.colorPalette.map((c, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/10 text-white/55">{c}</span>
                  ))}
                </div>
              )}
              {plan.suggestedArtist && (
                <div className="pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-white/40 font-semibold uppercase tracking-wider">Suggested artist look — save to your Artist Vault</span>
                    <button type="button" onClick={copyArtist} className="inline-flex items-center gap-1 text-[10px] text-primary hover:brightness-110">
                      {copiedArtist ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copiedArtist ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="text-xs text-white/60 leading-relaxed mt-1">{plan.suggestedArtist}</p>
                </div>
              )}
            </div>
          )}

          {/* Draft scenes */}
          {drafts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white/70">
                  {drafts.length} scene{drafts.length === 1 ? "" : "s"} — review & edit, then apply
                </span>
                <button type="button" onClick={addDraftScene} className="inline-flex items-center gap-1 text-[11px] text-primary hover:brightness-110 font-semibold">
                  <Plus className="h-3 w-3" /> Add scene
                </button>
              </div>

              {drafts.map((s, i) => {
                const open = openSceneIdx === i;
                return (
                  <div key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenSceneIdx(open ? null : i)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                    >
                      <span className="text-[10px] font-mono font-bold text-primary shrink-0 w-20">
                        {fmtClock(s.startSec)}–{fmtClock(s.endSec)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-semibold text-white truncate">
                          {i + 1}. {s.title || <span className="text-white/30">Untitled scene</span>}
                        </span>
                        {s.section && <span className="block text-[10px] text-white/35">{s.section}</span>}
                      </span>
                      <ChevronDown className={`h-3.5 w-3.5 text-white/40 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>

                    {open && (
                      <div className="px-3 pb-3 space-y-2 border-t border-white/[0.06] pt-2.5">
                        <div className="grid grid-cols-4 gap-1.5">
                          <label className="block">
                            <span className="text-[9px] uppercase text-white/35 font-semibold">Start (s)</span>
                            <input type="number" min={0} step={0.1} value={s.startSec}
                              onChange={(e) => updateDraft(i, { startSec: Math.max(0, Number(e.target.value) || 0) })}
                              className="mt-0.5 w-full rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-[11px] text-white" />
                          </label>
                          <label className="block">
                            <span className="text-[9px] uppercase text-white/35 font-semibold">End (s)</span>
                            <input type="number" min={0} step={0.1} value={s.endSec}
                              onChange={(e) => updateDraft(i, { endSec: Math.max(0, Number(e.target.value) || 0) })}
                              className="mt-0.5 w-full rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-[11px] text-white" />
                          </label>
                          <label className="block col-span-2">
                            <span className="text-[9px] uppercase text-white/35 font-semibold">Section</span>
                            <input value={s.section} onChange={(e) => updateDraft(i, { section: e.target.value })} placeholder="Hook"
                              className="mt-0.5 w-full rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-[11px] text-white placeholder:text-white/25" />
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <label className="block">
                            <span className="text-[9px] uppercase text-white/35 font-semibold">Title</span>
                            <input value={s.title} onChange={(e) => updateDraft(i, { title: e.target.value })} placeholder="Crown reveal"
                              className="mt-0.5 w-full rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-[11px] text-white placeholder:text-white/25" />
                          </label>
                          <label className="block">
                            <span className="text-[9px] uppercase text-white/35 font-semibold">Lyric cue</span>
                            <input value={s.lyricCue} onChange={(e) => updateDraft(i, { lyricCue: e.target.value })} placeholder="Lyric or moment"
                              className="mt-0.5 w-full rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-[11px] text-white placeholder:text-white/25" />
                          </label>
                          <label className="block">
                            <span className="text-[9px] uppercase text-white/35 font-semibold">Location</span>
                            <input value={s.location} onChange={(e) => updateDraft(i, { location: e.target.value })} placeholder="Rooftop at night"
                              className="mt-0.5 w-full rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-[11px] text-white placeholder:text-white/25" />
                          </label>
                          <label className="block">
                            <span className="text-[9px] uppercase text-white/35 font-semibold">Action</span>
                            <input value={s.action} onChange={(e) => updateDraft(i, { action: e.target.value })} placeholder="Artist raises the crown"
                              className="mt-0.5 w-full rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-[11px] text-white placeholder:text-white/25" />
                          </label>
                          <label className="block">
                            <span className="text-[9px] uppercase text-white/35 font-semibold">Camera</span>
                            <input value={s.camera} onChange={(e) => updateDraft(i, { camera: e.target.value })} placeholder="Slow dolly push-in, 35mm"
                              className="mt-0.5 w-full rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-[11px] text-white placeholder:text-white/25" />
                          </label>
                          <label className="block">
                            <span className="text-[9px] uppercase text-white/35 font-semibold">Lighting / mood</span>
                            <input value={`${s.lighting}${s.mood ? ` · ${s.mood}` : ""}`}
                              onChange={(e) => updateDraft(i, { lighting: e.target.value })}
                              placeholder="Neon glow · triumphant"
                              className="mt-0.5 w-full rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-[11px] text-white placeholder:text-white/25" />
                          </label>
                        </div>
                        <label className="block">
                          <span className="text-[9px] uppercase text-primary/80 font-bold">Video prompt — the money shot</span>
                          <textarea value={s.videoPrompt} onChange={(e) => updateDraft(i, { videoPrompt: e.target.value })}
                            rows={4} placeholder="The elite Runway prompt for this scene…"
                            className="mt-0.5 w-full rounded-md bg-white/[0.04] border border-primary/25 px-2 py-1.5 text-[11px] text-white placeholder:text-white/25 focus:outline-none focus:border-primary/60 resize-y leading-relaxed" />
                        </label>
                        <label className="block">
                          <span className="text-[9px] uppercase text-white/35 font-semibold">Negative prompt</span>
                          <input value={s.negativePrompt} onChange={(e) => updateDraft(i, { negativePrompt: e.target.value })}
                            className="mt-0.5 w-full rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-[11px] text-white/70" />
                        </label>
                        <div className="flex justify-end">
                          <button type="button" onClick={() => removeDraftScene(i)}
                            className="inline-flex items-center gap-1 text-[11px] text-red-400/80 hover:text-red-300">
                            <Trash2 className="h-3 w-3" /> Remove scene
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={applyToTimeline}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-black hover:brightness-110"
              >
                <Check className="h-4 w-4" />
                Apply {drafts.length} scene{drafts.length === 1 ? "" : "s"} to timeline
              </button>
              <p className="text-[10px] text-white/35 text-center">
                Applying sets scene timings and loads each prompt into the clip generator — nothing generates until you say so.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
