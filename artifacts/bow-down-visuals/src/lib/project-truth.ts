/* ─── Project truth — the honest state of a saved project ───────────────────
   Audit rank 8 (org tightening, §3.5/§4.12): finished projects must show
   their true state, and Edit must resume the same project. The card this
   seam feeds (My Projects ▸ Projects, the "My Videos" list) used to render
   NO state at all — a project whose final video was exported looked
   exactly like one that had never been touched, and nothing on the card
   said which was which.

   HONESTY RULE: every field below is derived ONLY from data the project
   row already carries (its saved output_data). No percentage is ever
   computed or displayed — a percentage would claim a precision the data
   doesn't support. In-progress video projects report the one progress
   fact that exists: how many of their saved scenes actually have clips
   (the same count the card already derives for its clips badge). */

export interface ProjectTruthScene {
  demoClipUrl?: string | null;
}

export interface ProjectTruthInput {
  project_type?: string | null;
  output_data?: {
    result?: string | null;
    final_video_url?: string | null;
    export_status?: string | null;
    scenes?: readonly ProjectTruthScene[] | null;
  } | null;
}

export type ProjectTruthState = "completed" | "export-failed" | "in-progress";

export interface ProjectTruth {
  state: ProjectTruthState;
  /** Saved scenes on the project (0 when the row carries none). */
  scenesTotal: number;
  /** Of those, the scenes that actually have a clip. */
  scenesWithClips: number;
}

/** Derive a project's true state from its own saved data.
 *
 *  - A final video URL means a finished video exists — completed, even
 *    if a later export attempt recorded a failure against the row (the
 *    finished video is still there; the modal's existing-export shape
 *    makes the same call).
 *  - export_status "completed" (the export rail's own word) is completed
 *    even before a URL is read back.
 *  - export_status "failed" with no finished video is export-failed.
 *  - A non-video project whose generation result was saved is completed:
 *    the row exists because that generation finished. A video project
 *    is NOT completed by its plan/result text — its finished state is
 *    the exported video, so it stays in-progress until one exists.
 *  - Everything else is in-progress, with the real scene counts. */
export function deriveProjectTruth(
  project: ProjectTruthInput,
  isVideo: boolean,
): ProjectTruth {
  const out = project.output_data ?? null;
  const scenes = Array.isArray(out?.scenes) ? out.scenes : [];
  const scenesTotal = scenes.length;
  const scenesWithClips = scenes.filter((s) => !!s?.demoClipUrl).length;

  if (out?.final_video_url || out?.export_status === "completed") {
    return { state: "completed", scenesTotal, scenesWithClips };
  }
  if (out?.export_status === "failed") {
    return { state: "export-failed", scenesTotal, scenesWithClips };
  }
  if (!isVideo && typeof out?.result === "string" && out.result.trim().length > 0) {
    return { state: "completed", scenesTotal, scenesWithClips };
  }
  return { state: "in-progress", scenesTotal, scenesWithClips };
}

/** The ONLY editor href an Edit/Open action for a saved project may
 *  carry: the editor's existing project-load deep link. The editor
 *  reads ?project= (video-editor.tsx), fetches GET /api/projects/:id,
 *  and its persist() PATCHes that same id — so an Edit that carries
 *  this href resumes the project, and an Edit that carries only a
 *  title (or nothing) forks a new one on export. */
export function editorProjectHref(projectId: string): string {
  return `/video-editor?project=${encodeURIComponent(projectId)}`;
}
