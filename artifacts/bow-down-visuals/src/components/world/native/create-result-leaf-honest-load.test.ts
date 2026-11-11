/**
 * CreateResultLeaf (World native) — honest load standard
 * (deep-pins tranche 5). A leaf library, pinned on its
 * three honesty seams. (1) SongAudioRail is props-driven:
 * the player renders ONLY on state done WITH an audioUrl —
 * a done without audio falls back to the make-audio button,
 * never an empty player — and the failed state shows the
 * error line with a make-again (retry) button. (2) The
 * quest-progress chip is a diff of two server reads: a
 * failed or unparseable snapshot stores null, a failed
 * re-read returns silently, and lines are set only from
 * real advances — no movement or no data means NO chip,
 * never a guessed celebration. (3) Waveform peaks that
 * can't decode resolve null and render the honest
 * "waveform unavailable" strip instead of a fake flat
 * line.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CreateResultLeaf.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("SongAudioRail — the player needs done AND audio", () => {
  it("done + url is the only player branch; failed carries the error and the retry label", () => {
    expect(src).toContain('export type SongAudioState = "idle" | "running" | "done" | "failed";');
    const body = slice(src, "export function SongAudioRail(props: {", "/* ─── THE-GAME");
    expect(body).toContain('if (props.state === "done" && props.audioUrl) {');
    expect(body).toContain("<AudioResult url={props.audioUrl} title={props.title} />");
    expect(body).toContain('props.state === "failed" && props.error ? (');
    expect(body).toContain('data-testid="world-create-audio-error"');
    expect(body).toContain('t("worldCreateDesk.audioMakeAgain")');
    expect(body.indexOf('if (props.state === "done" && props.audioUrl) {')).toBeLessThan(
      body.indexOf('data-testid="world-create-make-audio"'),
    );
  });
});

describe("the quest chip — a celebration only from server truth", () => {
  it("snapshot failure stores null; re-read failure returns; lines set only from real advances", () => {
    const body = slice(src, "export function useQuestProgressChip() {", "export function QuestProgressChip(");
    expect(body).toContain("beforeRef.current = res.ok ? questsOfResponse(await res.json().catch(() => null)) : null;");
    const snapCatch = slice(body, "} catch {", "// eslint-disable-next-line react-hooks/exhaustive-deps");
    expect(snapCatch).toContain("beforeRef.current = null;");
    expect(body).toContain("if (!res.ok) return;");
    expect(body).toContain("const advances = questAdvancesBetween(beforeRef.current, after);");
    expect(body).toContain("if (advances.length > 0) {");
    expect(body).toContain("setLines(advances.map((a) => questChipLine(a, strings)));");
    expect(body.indexOf("if (advances.length > 0) {")).toBeLessThan(
      body.indexOf("setLines(advances.map((a) => questChipLine(a, strings)));"),
    );
    expect(src).toContain("if (lines.length === 0) return null;");
  });
});

describe("peaks — undecodable is unavailable, never a fake line", () => {
  it("computePeaks resolves null on any failure and the bars render the unavailable strip", () => {
    const body = slice(src, "async function computePeaks(", "function WaveformBars(");
    expect(body).toContain("return peaks.length > 0 ? peaks : null;");
    const catchPart = slice(body, "} catch {", "function WaveformBars(");
    expect(catchPart).toContain("return null;");
    expect(src).toContain("if (!peaks) {");
    expect(src).toContain('{t("worldCreateDesk.waveformUnavailable")}');
  });
});
