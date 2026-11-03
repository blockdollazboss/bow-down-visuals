/* W2-L3 — beat handoff with stems: the mix handoff contract gains an
 * OPTIONAL stems list. Old consumers see exactly the old shape (no
 * `stems` key when none were stashed); consumers that know stems get
 * every stem one-shot alongside the mix. */
import { describe, expect, it } from "vitest";
import { stashBeatHandoff, takeBeatHandoff } from "./beat-handoff";

const wav = (s: string) => new Blob([s], { type: "audio/wav" });

describe("beat handoff — stems (W2-L3)", () => {
  it("a mix-only handoff is unchanged: no stems key, one-shot", () => {
    const id = stashBeatHandoff({ blob: wav("mix"), url: "blob:mix", title: "Beat", bpm: 140, durationSec: 10 });
    const beat = takeBeatHandoff(id);
    expect(beat?.title).toBe("Beat");
    expect(beat && "stems" in beat).toBe(false);
    expect(takeBeatHandoff(id)).toBeNull();
  });

  it("stems follow the mix through the same handoff id, one-shot", () => {
    const stems = [
      { blob: wav("kick"), url: "blob:kick", title: "Beat — Kick" },
      { blob: wav("bass"), url: "blob:bass", title: "Beat — 808 Bass" },
    ];
    const id = stashBeatHandoff({
      blob: wav("mix"), url: "blob:mix", title: "Beat", bpm: 140, durationSec: 10, stems,
    });
    const beat = takeBeatHandoff(id);
    expect(beat?.stems?.map((s) => s.title)).toEqual(["Beat — Kick", "Beat — 808 Bass"]);
    expect(beat?.stems?.[0]?.url).toBe("blob:kick");
    // One-shot: a second take gets neither the mix nor the stems.
    expect(takeBeatHandoff(id)).toBeNull();
  });

  it("an empty stems list is treated as no stems", () => {
    const id = stashBeatHandoff({
      blob: wav("mix"), url: "blob:mix", title: "Beat", bpm: 90, durationSec: 5, stems: [],
    });
    const beat = takeBeatHandoff(id);
    expect(beat && "stems" in beat).toBe(false);
  });
});
