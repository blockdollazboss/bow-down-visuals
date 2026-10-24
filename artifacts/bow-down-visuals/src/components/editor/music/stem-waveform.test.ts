import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-100 #3 Lane D (D-05) — the stem waveform was a static placeholder
 * ("real rendering coming soon") although every stem carries a real audio
 * URL and lib/audio-peaks already decodes true peaks. It is now wired:
 * Waveform takes the stem's url, renders getAudioPeaks peaks, and keeps
 * the decorative bars only as the loading/failure fallback.
 */
const src = readFileSync(new URL("./StemList.tsx", import.meta.url), "utf8");

describe("StemList waveform renders the stem's real peaks", () => {
  it("imports and calls the shared peaks decoder", () => {
    expect(src).toContain('from "@/lib/audio-peaks"');
    expect(src).toContain("getAudioPeaks(url, 96)");
  });

  it("the row passes the stem's own url and real peaks are marked", () => {
    expect(src).toContain("<Waveform url={stem.url} />");
    expect(src).toContain('data-real={peaks ? "true" : "false"}');
  });

  it("no longer claims to be a static placeholder", () => {
    expect(src).not.toContain("Static visual placeholder");
    expect(src).not.toContain("real rendering coming soon");
  });
});
