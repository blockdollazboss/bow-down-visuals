/**
 * CoverInMotionPanel (cover art → animated video) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with no mount load, the create-family
 * standard shape: the animate call gates the result on ok +
 * the produced video URL (`!res.ok || !data.videoUrl`) —
 * the player and the library save happen only from a proven
 * artifact (the addAsset save is itself wrapped non-fatal:
 * a library hiccup never un-makes a proven generation);
 * every other outcome lands on the error line, and the busy
 * flag clears in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CoverInMotionPanel.tsx");

describe("the animation applies only from an ok response carrying the video", () => {
  it("the gate and the busy release are pinned", () => {
    expect(src).toContain('if (!res.ok || !data.videoUrl) throw new Error(apiErrorMessage(data, "Animation failed."));');
    expect(src).toContain('setError(plainErrorText(e, "Animation failed."));');
    expect(src).toContain("setLoading(false);");
  });
});
