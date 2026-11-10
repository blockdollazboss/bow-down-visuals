/**
 * MusicVideoTimeline — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 1). The timeline's network
 * life is job polls, a clip auto-save, and the timeline save — no
 * collection list — and its contract is that every failure lands in
 * a visible error state:
 *
 * - THE GENERATION POLL never leaves a scene hanging or fake-done:
 *   a provider "failed"/"cancelled" status records the provider's
 *   message in the scene error state AND marks the scene's
 *   generationStatus "failed"; a network throw does the same with
 *   the poll error. "succeeded" is the only path that marks a scene
 *   completed.
 * - THE TIMELINE SAVE toasts success only on an ok response; a
 *   non-ok response throws into the destructive failure toast.
 * - CLIP AUTO-SAVE: the save POST toasts "Save failed" with the
 *   server's message on a non-ok response — and, FIXED IN THIS LANE
 *   (the twin of the SceneStudio fix banked in this tranche), the
 *   same toast on a network throw. The catch used to swallow
 *   silently ("Best effort autosave") while its sibling branch told
 *   the creator — the clip sits in the UI either way, but it did
 *   not persist, and the creator deserved to know.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const tl = read("./MusicVideoTimeline.tsx");

describe("the generation poll records failure as failure", () => {
  it("a provider failed/cancelled status records the error and marks the scene failed", () => {
    expect(tl).toContain('} else if (data.status === "failed" || data.status === "cancelled") {');
    expect(tl).toContain('setError(apiErrorMessage(data, "Scene clip generation returned a failure with no message"));');
    expect(tl).toContain('onUpdateRef.current({ generationStatus: "failed" });');
  });

  it("a network throw while polling does the same — never a silent hang", () => {
    expect(tl).toContain('setError(plainErrorText(e, "Network error while polling the scene clip"));');
  });

  it("succeeded is the only poll path that marks a scene completed", () => {
    expect(tl).toContain('if (data.status === "succeeded" && data.url) {');
    expect(tl).toContain('generationStatus: "completed",');
  });
});

describe("the timeline save toasts success only on success", () => {
  it("a non-ok save throws into the destructive failure toast", () => {
    expect(tl).toContain('if (!res.ok) {\n            throw new Error("Failed to save layout configuration.");\n          }');
    expect(tl).toContain('title: "Save failed",');
  });

  it("the success toast fires only after the ok check", () => {
    expect(tl).toContain('title: "Timeline Saved",');
    expect(tl.indexOf('title: "Timeline Saved",')).toBeGreaterThan(
      tl.indexOf('throw new Error("Failed to save layout configuration.");'),
    );
  });
});

describe("clip auto-save tells the creator when the clip did not persist", () => {
  it("a non-ok save toasts destructively with the server's message", () => {
    expect(tl).toContain('description: body.creditMessage ?? "Clip generated but saving failed.",');
  });

  it("a network-thrown save toasts the same failure instead of swallowing it", () => {
    expect(tl).toContain('description: "Clip generated but saving failed.",');
    expect(tl).not.toContain("// Best effort autosave.");
  });
});
