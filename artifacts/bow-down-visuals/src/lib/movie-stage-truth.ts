/* ─── Movie stage truth — the honest state of the movie editor's stages ────
   Audit §3.7 (org/design tightening, rank 8): "Movie Studio's stages are
   manual toggles that read as broken — every stage shows 0% with its switch
   OFF despite copy claiming auto-bring ('auto subjects ON / caption in
   video' are read-only labels; subjects/captions are manual per-clip
   steps)."

   Verification at base 34fdb87aa (git ls-files / git grep / direct reads
   only — see movie-stage-truth.test.ts): no literal stage list with a
   0% + OFF switch exists anywhere in the tree, and no "auto subjects"
   copy exists either — the same shape as §3.5, where the My Videos
   stepper the audit described also did not exist in code. What DOES
   exist is the substance underneath the claim:

   - The movie editor's production steps are manual, per-clip steps:
     generate/attach a clip per scene (Clips), lip-sync per clip
     (Lip Sync), caption lines timed over scenes (Captions), and the
     subject-reframe render, one clip at a time (Export ▸ Smart
     Reframe). Nothing runs any of them automatically.
   - No surface reported any of those steps' real state at all — so a
     creator had no truthful stage display, only the scattered panels
     themselves (and export-side labels that read as if subjects and
     captions simply arrive in the video).

   HONESTY RULES (the project-truth seam's rules, applied to stages):
   - Every count below is derived ONLY from data the project already
     carries (its scenes + saved editor settings). Nothing is invented.
   - A stage whose per-clip data does not exist to compute a state
     (subject reframe — its render replaces a clip URL and records
     nothing per clip) reports done = null: the display must say it is
     a manual per-clip step with no automatic pass, never a fake count
     or percentage.
   - With no clips at all, percent is null — never 0%. A percentage is
     only ever a real done/total.
   - Every stage is labelled manual. No stage claims automation:
     subject reframe runs only when the creator renders one clip, and
     captions reach the exported video only through the Caption Export
     choice — both say so plainly in their notes. */

import { computeSceneTimings } from "@/lib/scene-timing";

export interface MovieStageScene {
  id: string;
  timestamp?: string | null;
  demoClipUrl?: string | null;
}

export interface MovieStageClipEdit {
  lipSyncStatus?: string | null;
  lipSyncUrl?: string | null;
}

export interface MovieStageCaptionLine {
  startSec: number;
  endSec: number;
}

export interface MovieStageInput {
  scenes: readonly MovieStageScene[];
  /** Per-clip edits, keyed by scene id (settings.clips). */
  clips?: Record<string, MovieStageClipEdit | undefined> | null;
  /** The project's caption lines (settings.captions.lines). */
  captionLines?: readonly MovieStageCaptionLine[] | null;
  /** Song duration, when known — the shared timing engine's input. */
  audioDurationSec?: number | null;
}

export type MovieStageState = "not-started" | "in-progress" | "done" | "manual";

export interface MovieStageTruth {
  key: "clips" | "lip-sync" | "captions" | "subjects";
  /** Plain stage name. */
  label: string;
  /** Every stage here is a manual step — the display must say so. */
  manual: true;
  /** Clips the step is actually done for; null when no per-clip record
   *  exists to count from (subject reframe) — never an invented count. */
  done: number | null;
  /** Total clips the count is over (0 when the project has no scenes). */
  total: number;
  /** Real done/total as a percentage; null when it cannot be derived
   *  (no clips, or no per-clip record) — never a displayed 0% lie. */
  percent: number | null;
  state: MovieStageState;
  /** Plain words for what actually happens — no automation claims. */
  note: string;
}

function stageState(done: number | null, total: number): MovieStageState {
  if (done === null) return "manual";
  if (total === 0 || done === 0) return "not-started";
  if (done >= total) return "done";
  return "in-progress";
}

function stagePercent(done: number | null, total: number): number | null {
  if (done === null || total === 0) return null;
  return Math.round((done / total) * 100);
}

function makeStage(
  key: MovieStageTruth["key"],
  label: string,
  done: number | null,
  total: number,
  note: string,
): MovieStageTruth {
  return {
    key,
    label,
    manual: true,
    done,
    total,
    percent: stagePercent(done, total),
    state: stageState(done, total),
    note,
  };
}

/** Derive every movie stage's true state from the project's own data. */
export function deriveMovieStages(input: MovieStageInput): MovieStageTruth[] {
  const scenes = Array.isArray(input.scenes) ? input.scenes : [];
  const total = scenes.length;
  const clips = input.clips ?? {};
  const captionLines = Array.isArray(input.captionLines) ? input.captionLines : [];

  /* Clips — a scene is done when it carries a usable (http) clip URL,
     the same test sceneHasClip applies in the editor. */
  const clipsDone = scenes.filter(
    (s) => !!s?.demoClipUrl && s.demoClipUrl.startsWith("http"),
  ).length;

  /* Lip sync — a per-clip manual render; done only when that clip's own
     saved edit says the job finished AND carries its result URL (the
     same pair StudioEditorSection treats as a usable lip-synced clip). */
  const lipSyncDone = scenes.filter((s) => {
    const ce = clips[s.id];
    return ce?.lipSyncStatus === "done" && !!ce.lipSyncUrl;
  }).length;

  /* Captions — caption lines are timed over the timeline, so a scene is
     captioned when at least one line overlaps the scene's own window
     (the shared computeSceneTimings windows the player itself uses).
     Lines with no positive length cover nothing. */
  let captionsDone = 0;
  if (total > 0 && captionLines.length > 0) {
    const timings = computeSceneTimings(
      scenes as never,
      input.audioDurationSec ?? null,
    );
    captionsDone = scenes.filter((_, i) => {
      const win = timings[i];
      if (!win) return false;
      return captionLines.some(
        (l) => l.endSec > l.startSec && l.startSec < win.endSec && l.endSec > win.startSec,
      );
    }).length;
  }

  return [
    makeStage(
      "clips",
      "Clips",
      clipsDone,
      total,
      "Manual step — generate or upload a clip for each scene in the Clips tab. Nothing generates them for you.",
    ),
    makeStage(
      "lip-sync",
      "Lip sync",
      lipSyncDone,
      total,
      "Manual step — run lip sync clip by clip in the Lip Sync tab. A clip counts only when its own job has finished.",
    ),
    makeStage(
      "captions",
      "Captions",
      captionsDone,
      total,
      "Manual step — caption lines are written in the Captions tab, scene by scene. They reach the exported video only when Caption Export is set to burn captions in — they are not in the video automatically.",
    ),
    makeStage(
      "subjects",
      "Subject reframe",
      null,
      total,
      "Manual step — Smart Reframe renders one clip at a time in Export, and records nothing per clip, so there is no honest count. Subjects are not brought in automatically.",
    ),
  ];
}
