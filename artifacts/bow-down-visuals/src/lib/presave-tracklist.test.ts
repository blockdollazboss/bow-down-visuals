import { describe, it, expect } from "vitest";
import { formatTrackDuration, presaveTracklistRows } from "./presave-tracklist";

/* Presave tracklist preview shaping (wave 3 #15). The payload shape
   carries owner-published metadata only; these tests pin that the
   page-side shaping preserves order, shows durations only when the
   release actually carries them, and can never surface an audio
   field — there is no audio field in the shape to begin with. */

describe("formatTrackDuration", () => {
  it("formats m:ss with zero-padded seconds", () => {
    expect(formatTrackDuration(0)).toBe("0:00");
    expect(formatTrackDuration(9)).toBe("0:09");
    expect(formatTrackDuration(65)).toBe("1:05");
    expect(formatTrackDuration(187)).toBe("3:07");
    expect(formatTrackDuration(3600)).toBe("60:00");
    expect(formatTrackDuration(187.4)).toBe("3:07");
  });
});

describe("presaveTracklistRows", () => {
  it("keeps payload order, re-sequences positions, and labels known durations only", () => {
    const rows = presaveTracklistRows([
      { position: 1, title: "Intro", durationSeconds: null },
      { position: 2, title: "Gold Season", durationSeconds: 187 },
      { position: 3, title: "Outro", durationSeconds: 65 },
    ]);
    expect(rows).toEqual([
      { position: 1, title: "Intro", durationSeconds: null, durationLabel: null },
      { position: 2, title: "Gold Season", durationSeconds: 187, durationLabel: "3:07" },
      { position: 3, title: "Outro", durationSeconds: 65, durationLabel: "1:05" },
    ]);
  });

  it("drops unusable entries and refuses non-array payloads", () => {
    expect(presaveTracklistRows(undefined)).toEqual([]);
    expect(presaveTracklistRows(null)).toEqual([]);
    expect(presaveTracklistRows("nope")).toEqual([]);
    expect(
      presaveTracklistRows([
        { title: "  " },
        { title: "Real One" },
        { durationSeconds: 10 },
        null,
      ]),
    ).toEqual([{ position: 1, title: "Real One", durationSeconds: null, durationLabel: null }]);
  });

  it("never carries an audio reference through, even if one is smuggled into the payload", () => {
    const rows = presaveTracklistRows([
      { position: 1, title: "Intro", durationSeconds: null, audioUrl: "https://secret.test/master.wav" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("audioUrl");
    expect(JSON.stringify(rows)).not.toContain("secret.test");
  });
});
