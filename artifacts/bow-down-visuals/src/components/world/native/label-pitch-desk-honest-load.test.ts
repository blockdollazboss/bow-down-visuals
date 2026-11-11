/**
 * LabelPitchDesk (the Label Pitch desk + the Playlist Pitch
 * desk) — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 2). Every directory/tracker family
 * in the file carries its OWN failed flag, rendered as its own
 * failure state ahead of any list or empty state:
 *
 * - LABEL DIRECTORY: a non-ok read throws, and a response that
 *   fails to parse throws too ("labels shape") — a malformed
 *   payload is a failed load, never an empty directory. The
 *   flag clears at the start of each attempt.
 * - LABEL TRACKER: the same shape (non-ok or unparseable →
 *   trackerFailed); success records + clears it.
 * - PLAYLIST SIDE, mirrored exactly: curators, releases and
 *   deadlines each carry their failed flag, and the playlist
 *   tracker carries its own — six honest families in all.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./LabelPitchDesk.tsx");

describe("the label directory: non-ok and unparseable are both failures", () => {
  it("the read throws on non-ok and on a shape failure before recording", () => {
    expect(desk).toContain('if (!res.ok) throw new Error("labels");');
    expect(desk).toContain('if (!parsed) throw new Error("labels shape");');
    expect(desk).toContain("setLabels(parsed.labels);");
    expect(desk.indexOf('throw new Error("labels shape")')).toBeLessThan(desk.indexOf("setLabels(parsed.labels);"));
  });

  it("failure lands on the flag; the flag renders ahead of the list", () => {
    expect(desk).toContain("catch { if (!cancelled) setLabelsFailed(true); }");
    expect(desk).toContain("setLabelsFailed(false);");
    expect(desk).toContain("{labelsFailed ? (");
  });
});

describe("the label tracker mirrors it", () => {
  it("non-ok or unparseable throws into trackerFailed; success clears it", () => {
    expect(desk).toContain('if (!res.ok) throw new Error("tracker");');
    expect(desk).toContain('if (!parsed) throw new Error("tracker shape");');
    expect(desk).toContain("setSubmissions(parsed);");
    expect(desk).toContain("setTrackerFailed(false);");
    expect(desk).toContain("} catch { setTrackerFailed(true); }");
    expect(desk).toContain("{trackerFailed ? (");
  });
});

describe("the playlist desk carries the same six-flag discipline", () => {
  it("curators, releases, deadlines and the tracker each own a failed flag", () => {
    expect(desk).toContain("const [curatorsFailed, setCuratorsFailed] = useState(false);");
    expect(desk).toContain("const [releasesFailed, setReleasesFailed] = useState(false);");
    expect(desk).toContain("const [deadlinesFailed, setDeadlinesFailed] = useState(false);");
    expect(desk).toContain("{curatorsFailed ? (");
    expect(desk).toContain("{releasesFailed ? (");
    expect(desk).toContain("{deadlinesFailed ? (");
  });
});
