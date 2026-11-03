/* ─── Movie stage truth card ───────────────────────────────────────────────
   The Studio tab's honest stage list (audit §3.7, rank 8): each movie
   stage is a MANUAL per-clip step, and this card says so — with the
   step's real completion counted from the project's own scenes and
   saved settings (lib/movie-stage-truth.ts), never a switch that reads
   OFF, never a percentage that isn't a real done/total, and never copy
   claiming subjects or captions arrive automatically. Subject reframe
   records nothing per clip, so its row carries no count at all — it
   says plainly that it is a manual per-clip render with no automatic
   pass. Styling follows the Studio tab's own cards; the site's light
   theme remaps these same classes, like every neighbouring panel. */

import type { SceneData } from "@/lib/scene-parser";
import type { EditorSettings } from "@/lib/editor-settings";
import { deriveMovieStages, type MovieStageTruth } from "@/lib/movie-stage-truth";

const STATE_WORD: Record<MovieStageTruth["state"], string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  done: "Done",
  manual: "Manual — no count",
};

const STATE_CHIP: Record<MovieStageTruth["state"], string> = {
  "not-started": "bg-white/[0.06] text-white/40 border-white/10",
  "in-progress": "bg-primary/15 text-primary border-primary/30",
  done: "bg-green-500/15 text-green-400 border-green-500/20",
  manual: "bg-white/[0.06] text-white/40 border-white/10",
};

function stageCount(stage: MovieStageTruth): string {
  if (stage.done === null) return "Per clip — no automatic pass";
  if (stage.total === 0) return "No clips yet";
  return `${stage.done} of ${stage.total} clips`;
}

export function MovieStageTruthCard({
  scenes,
  settings,
  audioDuration,
}: {
  scenes: SceneData[];
  settings: EditorSettings;
  audioDuration: number | null;
}) {
  const stages = deriveMovieStages({
    scenes,
    clips: settings.clips,
    captionLines: settings.captions.lines,
    audioDurationSec: audioDuration,
  });

  return (
    <div
      className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
      data-testid="movie-stage-truth"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] font-black text-white/35 uppercase tracking-widest">
          Movie stages — the real state
        </p>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-white/[0.06] text-white/40 border-white/10">
          Every stage is a manual step
        </span>
      </div>
      <div className="space-y-2">
        {stages.map((stage) => (
          <div key={stage.key} data-testid={`movie-stage-${stage.key}`} data-state={stage.state}>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="flex-1 font-bold text-white/60">{stage.label}</span>
              <span className="text-white/30">Manual step</span>
              <span className="font-mono text-white/50">{stageCount(stage)}</span>
              <span
                className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold border ${STATE_CHIP[stage.state]}`}
              >
                {STATE_WORD[stage.state]}
              </span>
            </div>
            <p className="text-[9px] text-white/30 mt-0.5 leading-relaxed">{stage.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
