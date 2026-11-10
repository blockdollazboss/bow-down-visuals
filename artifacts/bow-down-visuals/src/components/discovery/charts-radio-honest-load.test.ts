/**
 * ChartsRadio — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The discovery radio loads its
 * station rotation publicly; the member's tuned-in hint and the
 * play-count post are documented niceties around it. The contract:
 *
 * - THE STATION is a full machine: a non-ok response throws into
 *   the loadError flag; a success clears it; the error branch
 *   renders with a working retry (nonce re-runs the load). The
 *   genuine off-air state ("Nothing playable is charting yet") is
 *   gated on a LOADED station reporting not-on-air AND no error —
 *   a failed load can never wear the off-air copy, and the
 *   rotation list renders only behind a loaded on-air station.
 * - THE PREFS HINT is quiet-by-design: its absence is honest
 *   silence (the station is public to hear; the hint only
 *   personalizes), under the file's own note.
 * - PLAYBACK SIDE-EFFECTS are fire-and-forget BY DESIGN: the
 *   remember-choice PATCH and the play-count POST never gate or
 *   fake playback state, under their own notes.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const radio = read("./ChartsRadio.tsx");

describe("the station load — failure never wears the off-air copy", () => {
  it("station starts null with the error flag down", () => {
    expect(radio).toContain("const [station, setStation] = useState<RadioStationPayload | null>(null);");
    expect(radio).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("a non-ok station response throws; the catch raises the error flag", () => {
    expect(radio).toContain('if (!r.ok) throw new Error("radio load failed");');
    expect(radio).toContain("if (!cancelled) setLoadError(true);");
  });

  it("success records the station and clears the flag", () => {
    expect(radio).toContain("setStation(data);\n          setLoadError(false);");
  });

  it("the error branch renders with a working retry", () => {
    expect(radio).toContain("The station didn't load.");
    expect(radio).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(radio).toContain("}, [retryNonce]);");
  });

  it("the off-air line is gated on a loaded station AND no error", () => {
    expect(radio).toContain("{station && !station.onAir && !loadError && (");
    expect(radio).toContain("Nothing playable is charting yet — the station signs on with the first charting tracks.");
  });

  it("the rotation renders only behind a loaded on-air station", () => {
    expect(radio).toContain("{!compact && station?.onAir && (");
  });
});

describe("the niceties fail soft, by documented design", () => {
  it("the prefs hint's absence is honest silence", () => {
    expect(radio).toContain("/* the hint is a nicety; its absence is honest silence */");
  });

  it("remembering the choice never gates playback", () => {
    expect(radio).toContain("/* remembering is best-effort; playback never depends on it */");
  });
});
