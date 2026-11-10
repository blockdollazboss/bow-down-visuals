/**
 * SongSegmentPicker — honest load classification (Stack-400 C-28
 * components residual, deep-pins tranche 1). The picker trims a
 * segment of the creator's OWN audio (a prop URL) inside the song
 * tools. It is NOT a list-load surface: there is no fetched
 * collection and no empty state. Its one load is decoding that audio
 * file into duration + waveform peaks, and its honesty contract is
 * graceful degradation, pinned here:
 *
 * - While decoding, the picker shows its loading line and the
 *   controls stay disabled.
 * - If decoding fails, it falls back to a plain audio element's
 *   metadata read for the REAL duration (the segment math stays
 *   honest); the waveform peaks become a flat placeholder — a noted
 *   display fallback for the user's own file, never invented data
 *   about anyone's content.
 * - If even metadata fails, duration stays 0 and every control
 *   stays disabled (`disabled={loading || !duration}`) — the picker
 *   never presents a trim it cannot back with a real duration.
 *
 * The FE suite runs in node (no DOM), so these tests pin the source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const picker = read("./SongSegmentPicker.tsx");

describe("the decode load degrades honestly", () => {
  it("the load starts in the loading state and resets the prior decode", () => {
    expect(picker).toContain("const [loading, setLoading] = useState(true);");
    expect(picker).toContain("setLoading(true);");
    expect(picker).toContain("setPeaks([]);");
  });

  it("a successful decode records the real duration and computed peaks", () => {
    expect(picker).toContain("const res = await fetch(audioUrl);");
    expect(picker).toContain("const decoded = await ctx.decodeAudioData(buf);");
    expect(picker).toContain("setDuration(dur);");
    expect(picker).toContain("setPeaks(arr);");
  });

  it("a decode failure falls back to the element metadata read for the real duration", () => {
    expect(picker).toContain("/* fall back to plain audio element duration */");
    expect(picker).toContain("a.onloadedmetadata = () => {");
    expect(picker).toContain("setDuration(a.duration || 0);");
  });

  it("loading always clears in the finally", () => {
    expect(picker).toContain("if (!cancelled) setLoading(false);");
  });
});

describe("no usable duration, no working controls — nothing fakes a trim", () => {
  it("the loading line renders while the decode is in flight", () => {
    expect(picker).toContain("Loading waveform…");
  });

  it("the segment controls are disabled while loading or without a duration", () => {
    expect(picker).toContain("disabled={loading || !duration}");
    expect(picker).toContain("if (!audio || !duration) return;");
  });
});
