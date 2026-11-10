/**
 * LiveStageDesk — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 2). The desk under Stream Copilot
 * carries four load families:
 *
 * - STREAMS (loadStreams) was already the family exemplar: a failed
 *   read throws into streamsError, the picker option itself says
 *   "Couldn't load your streams" (never "No streams yet") and a
 *   retry rides next to it; a success clears the flag.
 * - PREFS (loadPrefs) is a single-record config read: it records
 *   only on ok and the whole settings panel is gated on the proven
 *   payload ({prefs && …}), so a failed read renders no claim at
 *   all — classification pin.
 * - THE DESK READS (loadDesk: stage state, highlight proposals,
 *   class roster) record each payload only on its own ok.
 * - THE CUT POLL re-reads proposals only on ok, keeping the last
 *   truthful list while a cut renders.
 *
 * FINDING + FIX IN THIS LANE: loadDesk had no failure state at
 * all — a non-ok (or thrown) highlights read left proposals empty
 * and the render painted the genuine empty copy ("No proposals
 * for this stream yet — they land when the stream's recording
 * does…"), and a failed class-roster read painted "No tickets
 * sold yet" over a roster that may well have buyers. The load now
 * tracks any failed leg (or a throw) into deskError; an error line
 * with a retry (btn-retry-desk) renders above the desk; the
 * proposals empty copy is gated on !deskError; and the roster
 * empty copy renders only once a roster load has actually landed
 * (roster non-null).
 *
 * The actions were already honest and are pinned unchanged:
 * savePrefs narrates both outcomes, mute/unpin apply local state
 * only on ok, and decide() narrates cancel / 402 / failure /
 * dismiss-failure distinctly.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./LiveStageDesk.tsx");

const loadStreams = desk.slice(
  desk.indexOf("const loadStreams = useCallback"),
  desk.indexOf("const stream = streams.find"),
);
const loadDesk = desk.slice(
  desk.indexOf("const loadDesk = useCallback"),
  desk.indexOf("useEffect(() => { void loadPrefs();"),
);
const poll = desk.slice(
  desk.indexOf("pollRef.current = setInterval"),
  desk.indexOf("}, [anyCutting, streamId, proposals, authed]);"),
);

describe("the streams load was already the exemplar — unchanged", () => {
  it("a non-ok read throws and a success records the list + clears the flag", () => {
    expect(loadStreams).toContain('const res = await fetch("/api/live-streams/mine", { headers: await authed() });');
    expect(loadStreams).toContain("if (!res.ok) throw new Error();");
    expect(loadStreams).toContain("setStreams(data.streams);");
    expect(loadStreams).toContain("setStreamsError(false);");
  });

  it("failure lands in the error flag with the desk's own reasoning on record", () => {
    expect(loadStreams).toContain("setStreamsError(true);");
    expect(loadStreams).toContain("A failed load is NOT an empty stream list");
  });

  it("the picker option tells the truth and the retry rides beside a failed empty picker", () => {
    expect(desk).toContain('streamsError ? "Couldn\'t load your streams" : "No streams yet"');
    expect(desk).toContain("{streamsError && streams.length === 0 && (");
    expect(desk).toContain('data-testid="btn-retry-streams"');
    expect(desk).toContain("onClick={() => void loadStreams()}");
  });
});

describe("prefs: a single-record read that renders no claim on failure", () => {
  it("prefs record only on an ok response", () => {
    expect(desk).toContain('const res = await fetch("/api/live-prefs", { headers: await authed() });');
    expect(desk).toContain("if (res.ok) setPrefs((await res.json()) as LivePrefs);");
  });

  it("the settings panel is gated on the proven payload", () => {
    expect(desk).toContain("{prefs && (");
  });
});

describe("the desk reads: every leg's failure is a failed desk, never an empty one (fixed in this lane)", () => {
  it("stage, proposals and roster each record only on their own ok", () => {
    expect(loadDesk).toContain("if (stageRes.ok) setStage((await stageRes.json()) as StageState);");
    expect(loadDesk).toContain("if (hlRes.ok) setProposals(((await hlRes.json()) as { proposals: Proposal[] }).proposals);");
    expect(loadDesk).toContain("if (rosterRes.ok) setRoster(((await rosterRes.json()) as { roster: RosterEntry[] }).roster);");
  });

  it("any failed leg — or a thrown load — sets the desk error flag", () => {
    expect(loadDesk).toContain("let failed = !stageRes.ok || !hlRes.ok;");
    expect(loadDesk).toContain("else failed = true;");
    expect(loadDesk).toContain("setDeskError(failed);");
    expect(loadDesk).toContain("setDeskError(true);");
    expect(loadDesk).toContain("A failed desk read is NOT an empty desk");
  });

  it("the error line renders with a retry wired to the real loader", () => {
    expect(desk).toContain("{deskError && (");
    expect(desk).toContain("Some of this desk didn&rsquo;t load.");
    expect(desk).toContain('data-testid="btn-retry-desk"');
    expect(desk).toContain("onClick={() => void loadDesk()}");
    expect(desk.indexOf("{deskError && (")).toBeLessThan(desk.indexOf("Highlight proposals"));
  });

  it("the proposals empty copy is gated on no desk error", () => {
    expect(desk).toContain("{proposals.length === 0 && !deskError ? (");
    expect(desk).toContain("No proposals for this stream yet");
  });

  it("the roster empty copy renders only after a roster load actually landed", () => {
    expect(desk).toContain(") : roster ? (");
    expect(desk).toContain("No tickets sold yet — every buyer lands on this roster automatically.");
  });
});

describe("the cut poll keeps the last truthful proposals", () => {
  it("the poll re-read records only on ok", () => {
    expect(poll).toContain("if (res.ok) setProposals(((await res.json()) as { proposals: Proposal[] }).proposals);");
  });
});

describe("the actions narrate their own outcomes — unchanged", () => {
  it("savePrefs says saved only on ok and says so when it didn't", () => {
    const save = desk.slice(desk.indexOf("async function savePrefs()"), desk.indexOf("async function toggleMute()"));
    expect(save).toContain('if (res.ok) { setPrefs((await res.json()) as LivePrefs); setPrefsDirty(false); setNote("Co-host settings saved."); }');
    expect(save).toContain('else setNote("Those settings didn\'t save');
  });

  it("mute and unpin apply local state only on ok", () => {
    expect(desk).toContain("if (res.ok) setStage({ ...stage, muted: !stage.muted });");
    expect(desk).toContain("if (res.ok) setStage((s) => (s ? { ...s, stagePinned: null } : s));");
  });

  it("decide() narrates cancel, 402, failure and dismiss-failure distinctly", () => {
    expect(desk).toContain('setNote("Cut cancelled — nothing was charged.");');
    expect(desk).toContain('setNote("Not enough Visual Bucs for that cut — the proposal stays right here.");');
    expect(desk).toContain('setNote("That cut didn\'t start. Try again in a moment.");');
    expect(desk).toContain('setNote("That proposal didn\'t dismiss. Try again.");');
  });
});
