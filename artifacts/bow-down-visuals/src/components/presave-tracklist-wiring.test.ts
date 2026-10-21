import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/* Wiring pins for the presave tracklist preview (wave 3 #15), in the
   house source-pin style: the landing page renders the payload's
   tracklist through the shaping helper, the block is headed by the
   translated "Tracklist" label, and the tracklist block itself
   references no audio field — the preview is metadata only. */

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../pages/presave.tsx"), "utf8");
const en = JSON.parse(readFileSync(join(here, "../locales/en.json"), "utf8")) as {
  presave: Record<string, string>;
};

describe("presave page — tracklist preview wiring", () => {
  it("renders the payload tracklist through the shaping helper", () => {
    expect(page).toContain("presaveTracklistRows(data.tracklist)");
    expect(page).toContain("row.durationLabel");
    expect(page).toContain("tracklist?: PresaveTracklistEntry[]");
  });

  it("heads the block with the translated Tracklist label", () => {
    expect(page).toContain('t("presave.tracklistTitle"');
    expect(en.presave["tracklistTitle"]).toBe("Tracklist");
  });

  it("the tracklist block exposes no audio of any kind", () => {
    const start = page.indexOf("Wave 3 #15: tracklist preview");
    const end = page.indexOf("Stack 11 #2: real account pre-save");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = page.slice(start, end);
    expect(block).not.toContain("audioUrl");
    expect(block).not.toMatch(/<audio|new Audio\(|\.mp3|\.wav/);
    expect(block).toContain("row.title");
  });
});
