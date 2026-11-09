/**
 * song-starters — org wave #4: the Song Desk's starter shelf.
 *
 * The shelf rides the make-song page's ONE registry (lib/song-presets)
 * — the same module the page imports — and applies a starter with the
 * page's own semantics through applySongStarter (lib/world/create-desks):
 * the prompt takes the preset's Simple-mode description text, the
 * Advanced fields take songPresetPatch (only the keys the preset
 * defines). A starter is a PREFILL ONLY: these pins prove the applied
 * state is exactly the registry's data, that no field outside the
 * desk's real form is ever invented, that untouched fields keep the
 * creator's own values, and that the component's apply path performs
 * no fetch, no spend confirmation and no generation call.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applySongStarter,
  buildSongPayloadAdvanced,
  EMPTY_SONG_ADVANCED,
  type SongAdvanced,
} from "./create-desks";
import {
  SONG_PRESETS,
  SONG_PRESET_GROUPS,
  SONG_PRESET_GENRES,
  SONG_PRESET_LENGTHS,
  SONG_PRESET_MOODS,
  getSongPreset,
  songPresetPatch,
  songPresetsByGroup,
  type SongPreset,
} from "../song-presets";

const desksSrc = readFileSync(
  new URL("../../components/world/native/CreateDesks.tsx", import.meta.url),
  "utf8",
);

const ADV_KEYS = Object.keys(EMPTY_SONG_ADVANCED).sort();

function seededAdv(): SongAdvanced {
  return {
    artistName: "My Stage Name",
    songTitle: "Untitled",
    genre: "Country",
    mood: "Funny",
    cleanOrExplicit: "Clean",
    voiceStyle: "Gravelly",
    beatStyle: "My own beat note",
    songLength: "2 minutes",
    specialInstructions: "My own note",
  };
}

describe("the shelf's data is the page registry, whole", () => {
  it("carries all 37 presets across the three page groups", () => {
    expect(SONG_PRESETS).toHaveLength(37);
    expect(SONG_PRESET_GROUPS.map((g) => g.id)).toEqual(["genre", "mood", "structure"]);
    for (const group of SONG_PRESET_GROUPS) {
      expect(songPresetsByGroup(group.id).length).toBeGreaterThan(0);
    }
    const grouped = SONG_PRESET_GROUPS.flatMap((g) => songPresetsByGroup(g.id).map((p) => p.id));
    expect(grouped.sort()).toEqual(SONG_PRESETS.map((p) => p.id).sort());
  });
});

describe("applySongStarter — prefill semantics, mirroring the page", () => {
  it("a genre preset fills the prompt and only its own patch keys", () => {
    const preset = getSongPreset("pop-hit")!;
    const before = { prompt: "old idea", adv: seededAdv() };
    const next = applySongStarter(preset, before);
    expect(next.prompt).toBe(preset.simplePrompt);
    expect(next.adv.genre).toBe("Pop");
    /* Keys the preset does not define keep the creator's values. */
    expect(next.adv.mood).toBe("Funny");
    expect(next.adv.beatStyle).toBe("My own beat note");
    expect(next.adv.songLength).toBe("2 minutes");
    expect(next.adv.specialInstructions).toBe("My own note");
    expect(next.adv.artistName).toBe("My Stage Name");
    /* The input state is never mutated. */
    expect(before.adv.genre).toBe("Country");
    expect(before.prompt).toBe("old idea");
  });

  it("a beat-style genre preset sets genre AND beat style (Trap Banger)", () => {
    const next = applySongStarter(getSongPreset("trap-banger")!, { prompt: "", adv: seededAdv() });
    expect(next.adv.genre).toBe("Trap");
    expect(next.adv.beatStyle).toBe(getSongPreset("trap-banger")!.form.beatStyle);
    expect(next.adv.mood).toBe("Funny");
  });

  it("Lo-Fi Chill touches beat style only — it never invents a genre or mood value", () => {
    const next = applySongStarter(getSongPreset("lo-fi-chill")!, { prompt: "", adv: seededAdv() });
    expect(next.adv.genre).toBe("Country");
    expect(next.adv.mood).toBe("Funny");
    expect(next.adv.beatStyle).toContain("Lo-fi");
  });

  it("a structure preset rides Special Instructions, and only the 60-second one sets a length", () => {
    const hook = applySongStarter(getSongPreset("hook-first")!, { prompt: "", adv: seededAdv() });
    expect(hook.adv.specialInstructions).toBe(getSongPreset("hook-first")!.form.specialInstructions);
    expect(hook.adv.songLength).toBe("2 minutes");
    const sixty = applySongStarter(getSongPreset("sixty-second-hook")!, { prompt: "", adv: seededAdv() });
    expect(sixty.adv.songLength).toBe("60 seconds");
  });

  it("every preset: prompt is its simple text, adv keys stay the desk's real fields, patched values are registry values", () => {
    for (const preset of SONG_PRESETS as SongPreset[]) {
      const next = applySongStarter(preset, { prompt: "x", adv: seededAdv() });
      expect(next.prompt).toBe(preset.simplePrompt);
      expect(Object.keys(next.adv).sort()).toEqual(ADV_KEYS);
      const patch = songPresetPatch(preset);
      if (patch.genre) {
        expect(next.adv.genre).toBe(patch.genre);
        expect(SONG_PRESET_GENRES).toContain(patch.genre);
      }
      if (patch.mood) {
        expect(next.adv.mood).toBe(patch.mood);
        expect(SONG_PRESET_MOODS).toContain(patch.mood);
      }
      if (patch.songLength) {
        expect(next.adv.songLength).toBe(patch.songLength);
        expect(SONG_PRESET_LENGTHS).toContain(patch.songLength);
      }
      if (patch.beatStyle) expect(next.adv.beatStyle).toBe(patch.beatStyle);
      if (patch.specialInstructions) expect(next.adv.specialInstructions).toBe(patch.specialInstructions);
    }
  });

  it("the prefilled state rides the desk's real payload path unchanged", () => {
    const next = applySongStarter(getSongPreset("trap-banger")!, { prompt: "", adv: { ...EMPTY_SONG_ADVANCED } });
    const payload = buildSongPayloadAdvanced(next.prompt, next.adv);
    expect(payload["songTopic"]).toBe(getSongPreset("trap-banger")!.simplePrompt);
    expect(payload["genre"]).toBe("Trap");
    expect(payload["beatStyle"]).toBe(getSongPreset("trap-banger")!.form.beatStyle);
  });
});

describe("SongDesk wiring — the shelf renders FROM the registry and only prefills", () => {
  it("imports the shared registry and maps its groups (no copied list)", () => {
    expect(desksSrc).toContain('from "@/lib/song-presets"');
    expect(desksSrc).toContain("SONG_PRESET_GROUPS.map(");
    expect(desksSrc).toContain("songPresetsByGroup(group.id).map(");
    expect(desksSrc).toContain('data-testid="world-song-starters"');
    expect(desksSrc).toContain("data-testid={`world-song-starter-${preset.id}`}");
    /* A copied second list would carry the registry's literal texts. */
    expect(desksSrc).not.toContain("dark trap anthem about coming up from nothing");
    expect(desksSrc).not.toContain("Lo-fi chill beat — mellow chords");
  });

  it("the apply tap goes through applySongStarter and performs no run, charge or fetch", () => {
    const a = desksSrc.indexOf("const applyStarter = (preset: SongPreset)");
    const b = desksSrc.indexOf("const editPrompt", a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    const body = desksSrc.slice(a, b);
    expect(body).toContain("applySongStarter(preset, { prompt, adv })");
    expect(body).not.toContain("fetch(");
    expect(body).not.toContain("confirmSpend");
    expect(body).not.toContain("callGenerateApi");
  });

  it("the active marker is honest: manual prompt/field edits clear it", () => {
    expect(desksSrc).toContain("const editPrompt = (v: string) => { setActiveStarterId(null); setPrompt(v); };");
    expect(desksSrc).toContain("onPromptChange={editPrompt}");
    expect(desksSrc).toContain("setActiveStarterId(null); setAdv(");
    expect(desksSrc).toContain("aria-pressed={activeStarterId === preset.id}");
  });
});
