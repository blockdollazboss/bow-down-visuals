/**
 * LiveCopilotDesk (the World live copilot + stage desk) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 2).
 *
 * - PREFS + STREAMS were already the house exemplar, with the
 *   rules written on the code: a failed prefs load is NOT
 *   default switches (the desk shows error + retry, not a
 *   made-up settings state), and a failed streams load is NOT
 *   an empty stream list (the picker shows its error option +
 *   retry instead of "No streams yet").
 *
 * FINDING + FIX (this lane): the DESK load (stage state +
 * highlight proposals + class roster) was the un-repaired twin
 * of the defect tranche 2 batch 1 fixed in LiveStageDesk.
 * loadDesk had NO failure state at all: non-ok reads were
 * silently skipped behind `if (res.ok)` guards and a thrown
 * read rejected unhandled, so a failed highlights read painted
 * "No proposals for this stream yet…" and a failed roster read
 * painted "No tickets sold yet." — failures dressed as empty.
 * The fix mirrors the sibling's exactly: a deskError flag set
 * from any leg's failure (stage, highlights, or roster) or a
 * thrown read; an error line with a retry
 * (world-live-stage-retry-desk, new locale key
 * worldDeskRemainder.copDeskLoadFailed) renders above the desk;
 * the proposals empty copy is gated on no-error, and the roster
 * empty copy renders only when a roster actually loaded (roster
 * non-null). Successful legs still record independently — a
 * failed roster never takes down landed proposals.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./LiveCopilotDesk.tsx");

const loadDesk = desk.slice(desk.indexOf("const loadDesk = useCallback(async () => {"), desk.indexOf("useEffect(() => { void loadPrefs();"));

describe("prefs and streams: the pre-existing exemplar — unchanged", () => {
  it("a failed prefs load is an error state, never default switches", () => {
    expect(desk).toContain("A failed load is NOT default switches — the desk shows its");
    expect(desk).toContain("setPrefsFailed(true);");
    expect(desk).toContain("setPrefs(normalizeLivePrefs(await res.json()));");
  });

  it("a failed streams load is an error option + retry, never 'no streams yet'", () => {
    expect(desk).toContain("A failed load is NOT an empty stream list — the picker");
    expect(desk).toContain("setStreamsError(true);");
    expect(desk).toContain('streamsError ? t("worldDeskRemainder.copStreamsLoadFailed") : t("worldDeskRemainder.copNoStreams")');
    expect(desk).toContain('data-testid="world-live-stage-retry-streams"');
  });
});

describe("FIX: the desk load carries a failure state of its own", () => {
  it("any leg's failure — or a thrown read — lands on deskError", () => {
    expect(loadDesk).toContain("let failed = !stageRes.ok || !hlRes.ok;");
    expect(loadDesk).toContain("else failed = true;");
    expect(loadDesk).toContain("setDeskError(failed);");
    expect(loadDesk).toContain("} catch {");
    expect(loadDesk).toContain("setDeskError(true);");
  });

  it("landed legs still record independently of a failed sibling leg", () => {
    expect(loadDesk).toContain("if (stageRes.ok) setStage(normalizeStageState(await stageRes.json()));");
    expect(loadDesk).toContain("if (hlRes.ok) setProposals(normalizeHighlightProposals(await hlRes.json()));");
    expect(loadDesk).toContain("if (rosterRes.ok) setRoster(normalizeClassRoster(await rosterRes.json()));");
  });

  it("the error line + retry render above the desk", () => {
    expect(desk).toContain("{deskError && (");
    expect(desk).toContain('t("worldDeskRemainder.copDeskLoadFailed")');
    expect(desk).toContain('data-testid="world-live-stage-retry-desk"');
    expect(desk).toContain("onClick={() => void loadDesk()}");
  });

  it("the proposals empty copy is gated on no-error", () => {
    expect(desk).toContain("{proposals.length === 0 && !deskError ? (");
  });

  it("the roster empty copy renders only when a roster actually loaded", () => {
    expect(desk).toContain(") : roster ? (");
    expect(desk).toContain('t("worldDeskRemainder.copRosterEmpty")');
  });
});
