/**
 * project-truth — audit rank 8 pins (§3.5/§4.12).
 *
 * Verification notes (against origin/staging 34fdb87aa, git grep /
 * git ls-files only):
 *  - No literal "0%" progress stepper exists anywhere in the My
 *    Projects / My Clips surfaces at this base — the defect as it
 *    stands in current code is that ProjectCard renders NO project
 *    state at all: a finished (exported) project is indistinguishable
 *    from an untouched one. deriveProjectTruth is the fix's seam.
 *  - The editor's project-load path already exists and is pinned
 *    below: video-editor.tsx reads ?project=, GETs /api/projects/:id,
 *    and persist() PATCHes that same id. Edit must carry the id into
 *    that path — editorProjectHref is the one builder for it, and
 *    OpenVideoEditorButton (the card's + modal's editor button) must
 *    use it.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { deriveProjectTruth, editorProjectHref } from "./project-truth";

const videoProject = (output_data: Record<string, unknown> | null) => ({
  project_type: "Make a Music Video",
  output_data,
});

describe("deriveProjectTruth — a finished project reads completed, never in-progress/0%", () => {
  it("a project with a final exported video is completed", () => {
    const truth = deriveProjectTruth(
      videoProject({ final_video_url: "https://cdn.example/final.mp4", export_status: "completed" }),
      true,
    );
    expect(truth.state).toBe("completed");
  });

  it("export_status completed alone is completed", () => {
    expect(deriveProjectTruth(videoProject({ export_status: "completed" }), true).state).toBe("completed");
  });

  it("a finished video still counts as completed when a later export attempt failed", () => {
    expect(
      deriveProjectTruth(
        videoProject({ final_video_url: "https://cdn.example/final.mp4", export_status: "failed" }),
        true,
      ).state,
    ).toBe("completed");
  });

  it("a failed export with no finished video is export-failed, not completed", () => {
    expect(deriveProjectTruth(videoProject({ export_status: "failed" }), true).state).toBe("export-failed");
  });

  it("a non-video project with a saved generation result is completed", () => {
    expect(
      deriveProjectTruth({ project_type: "Make a Song", output_data: { result: "## FULL LYRICS\n…" } }, false).state,
    ).toBe("completed");
  });
});

describe("deriveProjectTruth — in-progress shows only the progress that exists", () => {
  it("a video project with a plan but no export is in-progress (a plan is not a finished video)", () => {
    const truth = deriveProjectTruth(videoProject({ result: "## VIDEO PLAN\n…" }), true);
    expect(truth.state).toBe("in-progress");
    expect(truth.scenesTotal).toBe(0);
    expect(truth.scenesWithClips).toBe(0);
  });

  it("scene progress counts only scenes that actually have clips", () => {
    const truth = deriveProjectTruth(
      videoProject({
        scenes: [
          { demoClipUrl: "https://cdn.example/1.mp4" },
          { demoClipUrl: null },
          { demoClipUrl: "https://cdn.example/3.mp4" },
          {},
        ],
      }),
      true,
    );
    expect(truth.state).toBe("in-progress");
    expect(truth.scenesTotal).toBe(4);
    expect(truth.scenesWithClips).toBe(2);
  });

  it("a project with no output data at all is honestly in-progress with zero counts", () => {
    expect(deriveProjectTruth(videoProject(null), true)).toEqual({
      state: "in-progress",
      scenesTotal: 0,
      scenesWithClips: 0,
    });
    expect(deriveProjectTruth({ project_type: "Make a Song", output_data: null }, false).state).toBe("in-progress");
  });
});

describe("editorProjectHref — Edit carries the project id into the editor load path", () => {
  it("builds the editor's ?project= deep link for the exact id", () => {
    expect(editorProjectHref("proj-123")).toBe("/video-editor?project=proj-123");
  });

  it("encodes ids so the param survives the URL intact", () => {
    expect(editorProjectHref("a b/c")).toBe("/video-editor?project=a%20b%2Fc");
  });

  it("never builds a title-only or bare editor link", () => {
    const href = editorProjectHref("proj-123");
    expect(href).toContain("project=proj-123");
    expect(href).not.toContain("title=");
  });
});

describe("wiring — the card renders the truth and Edit uses the id-carrying href", () => {
  const page = readFileSync(new URL("../pages/my-projects.tsx", import.meta.url), "utf8");
  const button = readFileSync(
    new URL("../components/OpenVideoEditorButton.tsx", import.meta.url),
    "utf8",
  );
  const editor = readFileSync(new URL("../pages/video-editor.tsx", import.meta.url), "utf8");

  it("ProjectCard derives and renders the project truth state", () => {
    expect(page).toContain("deriveProjectTruth");
    expect(page).toContain("data-testid={`project-truth-${project.id}`}");
    expect(page).toContain('data-state={truth.state}');
  });

  it("the card's editor button is built from editorProjectHref", () => {
    expect(button).toContain("editorProjectHref(projectId)");
    expect(button).not.toContain("`/video-editor?project=${projectId}`");
  });

  it("the editor load path the href lands on loads and re-saves the SAME project id", () => {
    expect(editor).toContain('new URLSearchParams(search).get("project")');
    expect(editor).toContain("fetch(`/api/projects/${projectId}`");
    expect(editor).toContain("fetch(`/api/projects/${project.id}`");
    expect(editor).toContain('method: "PATCH"');
  });
});
