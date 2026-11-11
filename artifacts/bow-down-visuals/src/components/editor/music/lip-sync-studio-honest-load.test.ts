/**
 * LipSyncStudio (the editor's lip-sync studio) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 2).
 *
 * FINDING + FIX (this lane): the single-clip scene picker read
 * the project's scenes from GET /api/projects/:id, and its
 * catch recorded an EMPTY list (`setClipScenes([])`) — so a
 * failed project read painted "This project has no scene clips
 * yet — generate scene clips in the editor first", a failure
 * dressed as a proven-empty project, sending the member to
 * regenerate clips they may already have. The load now lands
 * failures on clipScenesFailed (the scenes return to unproven
 * null) and the render chain is loading → failed ("couldn't
 * load — reopen the studio to try again") → list → the genuine
 * empty guidance, which now renders only after a successful
 * read proved the project has no clips.
 *
 * - THE SCENE-TEST POLL was already honest: "succeeded" lands
 *   done only WITH a result URL; a failed status lands the
 *   failed phase with the server's message; the 120-tick
 *   deadline lands failed with "the job may still be running"
 *   copy (and a thrown poll at the deadline lands "Could not
 *   check on the lip sync job.") — never an endless spin,
 *   never a fake finish.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const studio = read("./LipSyncStudio.tsx");

describe("FIX: a failed scene read is a failure state, not an empty project", () => {
  it("the catch returns the scenes to unproven and sets the failed flag", () => {
    expect(studio).toContain("const [clipScenesFailed, setClipScenesFailed] = useState(false);");
    expect(studio).toContain("setClipScenes(null);");
    expect(studio).toContain("setClipScenesFailed(true);");
    expect(studio).toContain("A failed read is NOT an empty project — the scenes go");
    expect(studio).not.toContain("setClipScenes([])");
  });

  it("the attempt clears the flag; the render chain is loading → failed → list → genuine empty", () => {
    expect(studio).toContain("setClipScenesFailed(false);");
    const loadingIdx = studio.indexOf("{clipScenesLoading ? (");
    const failedIdx = studio.indexOf(") : clipScenesFailed ? (");
    const listIdx = studio.indexOf(") : clipScenes && clipScenes.length > 0 ? (");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(failedIdx).toBeGreaterThan(loadingIdx);
    expect(listIdx).toBeGreaterThan(failedIdx);
    expect(studio).toContain("This project has no scene clips yet — generate scene clips in");
  });
});

describe("the scene-test poll never fakes a finish — unchanged", () => {
  it("done requires a result URL; failure carries the server's message", () => {
    expect(studio).toContain('if (data.status === "succeeded" && data.resultUrl) {');
    expect(studio).toContain('setClipPhase("done");');
    expect(studio).toContain('if (data.status === "failed") {');
    expect(studio).toContain('setClipError(apiErrorMessage(data, "Lip sync failed."));');
  });

  it("the deadline lands failed with still-running copy, on a read or a throw alike", () => {
    expect(studio).toContain('setClipError("This is taking longer than usual — the job may still be running. Check again in a bit before starting another.");');
    expect(studio).toContain('setClipError("Could not check on the lip sync job.");');
  });
});
