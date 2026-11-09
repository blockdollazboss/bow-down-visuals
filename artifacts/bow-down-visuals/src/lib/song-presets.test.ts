import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SONG_PRESETS,
  SONG_PRESET_GROUPS,
  SONG_PRESET_GENRES,
  SONG_PRESET_MOODS,
  SONG_PRESET_LENGTHS,
  songPresetsByGroup,
  songPresetPatch,
  getSongPreset,
  type SongPresetGroup,
} from "./song-presets";

const pageSrc = readFileSync(new URL("../pages/make-song.tsx", import.meta.url), "utf8");
const registrySrc = readFileSync(new URL("./song-presets.ts", import.meta.url), "utf8");

/* The real Advanced form fields (SongFormValues in make-song.tsx).
   A preset patch key outside this set would be an invented field. */
const REAL_FORM_FIELDS = [
  "artistName",
  "songTitle",
  "genre",
  "mood",
  "songTopic",
  "cleanOrExplicit",
  "voiceStyle",
  "beatStyle",
  "songLength",
  "specialInstructions",
];

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const rest = src.slice(start);
  const next = rest.indexOf("\n  function ", 10);
  const nextAsync = rest.indexOf("\n  async function ", 10);
  const ends = [next, nextAsync].filter((n) => n > 0);
  return rest.slice(0, ends.length ? Math.min(...ends) : rest.length);
}

describe("song preset registry — exists and is organised", () => {
  it("carries 37 presets: 13 by genre, 14 by mood & vibe, 10 by structure", () => {
    expect(SONG_PRESETS).toHaveLength(37);
    expect(SONG_PRESET_GROUPS.map((g) => g.id)).toEqual(["genre", "mood", "structure"]);
    const counts: Record<SongPresetGroup, number> = { genre: 13, mood: 14, structure: 10 };
    for (const group of SONG_PRESET_GROUPS) {
      expect(songPresetsByGroup(group.id as SongPresetGroup)).toHaveLength(counts[group.id as SongPresetGroup]);
    }
  });

  it("the Stack 200 U2 presets set exactly the form values their labels name", () => {
    /* Gospel + Country were always real genre-select values with no
       preset reaching for them; build-and-drop is the dance structure
       the structure group lacked. */
    const gospel = getSongPreset("gospel-choir")!;
    expect(gospel.group).toBe("genre");
    expect(gospel.form.genre).toBe("Gospel");
    const country = getSongPreset("country-story")!;
    expect(country.group).toBe("genre");
    expect(country.form.genre).toBe("Country");
    const drop = getSongPreset("build-and-drop")!;
    expect(drop.group).toBe("structure");
    expect(drop.form.specialInstructions).toContain("Structure:");
    expect(drop.form.specialInstructions!.toLowerCase()).toContain("drop");
    expect(drop.form.genre).toBeUndefined();
    expect(drop.form.songLength).toBeUndefined();
  });

  it("the Stack 300 presets close the genre/mood axes and add the two missing shapes", () => {
    /* Genre axis: Drill, Dancehall and Kids Music were the last
       select values no preset patched ("Other" is the catch-all and
       honestly gets none). Each sets exactly its genre; the kids'
       entry also names its mood, the registry's family-audience
       pairing. */
    expect(getSongPreset("drill-serious")!.form.genre).toBe("Drill");
    expect(getSongPreset("dancehall-heat")!.form.genre).toBe("Dancehall");
    const kids = getSongPreset("kids-singalong")!;
    expect(kids.group).toBe("genre");
    expect(kids.form.genre).toBe("Kids Music");
    expect(kids.form.mood).toBe("Kid-Friendly");
    for (const genre of SONG_PRESET_GENRES) {
      if (genre === "Other") continue;
      expect(
        SONG_PRESETS.some((p) => p.form.genre === genre),
        `genre covered: ${genre}`,
      ).toBe(true);
    }
    /* Mood axis: all twelve values the select sells now have a
       preset (the seven Stack 300 entries join the original five;
       Lo-Fi Chill stays beat-style only by design). */
    const moodIds: Array<[string, string]> = [
      ["luxury-life", "Luxury"],
      ["romantic-serenade", "Romantic"],
      ["street-anthem", "Street"],
      ["pain-song", "Pain"],
      ["inspirational-rise", "Inspirational"],
      ["funny-banger", "Funny"],
      ["kid-friendly-pop", "Kid-Friendly"],
    ];
    for (const [id, mood] of moodIds) {
      const preset = getSongPreset(id)!;
      expect(preset.group, id).toBe("mood");
      expect(songPresetPatch(preset), id).toEqual({ mood });
    }
    for (const mood of SONG_PRESET_MOODS) {
      expect(
        SONG_PRESETS.some((p) => p.form.mood === mood),
        `mood covered: ${mood}`,
      ).toBe(true);
    }
    /* Structure axis: the continuous no-chorus shape and the first
       two-voice shape, both riding Special Instructions only. */
    const freestyle = getSongPreset("no-hook-freestyle")!;
    expect(freestyle.group).toBe("structure");
    expect(freestyle.form.specialInstructions).toContain("no hook and no chorus");
    expect(Object.keys(songPresetPatch(freestyle))).toEqual(["specialInstructions"]);
    const duet = getSongPreset("duet-trade-off")!;
    expect(duet.group).toBe("structure");
    expect(duet.form.specialInstructions).toContain("both voices join on the hook");
    expect(Object.keys(songPresetPatch(duet))).toEqual(["specialInstructions"]);
  });

  it("the Stack 400 presets add the two unsold genre families, the warm mood and the bridge shape", () => {
    /* Genre axis: amapiano and reggaetón are real families the genre
       select does not sell by name. Each preset sets the nearest
       family the form truly sells and lets its beat-style recipe
       carry the real identity — the Lo-Fi honesty shape, one group
       over — instead of inventing a select value the form lacks. */
    const amapiano = getSongPreset("amapiano-groove")!;
    expect(amapiano.group).toBe("genre");
    expect(amapiano.form.genre).toBe("Afrobeats");
    expect(amapiano.form.beatStyle).toContain("Amapiano");
    expect(amapiano.form.beatStyle).toContain("log-drum");
    const reggaeton = getSongPreset("reggaeton-nights")!;
    expect(reggaeton.group).toBe("genre");
    expect(reggaeton.form.genre).toBe("Dancehall");
    expect(reggaeton.form.beatStyle).toContain("Reggaetón");
    expect(reggaeton.form.beatStyle).toContain("dembow");
    /* Mood axis: the warm daylight mood the shelf lacked rides the
       nearest value the select sells, its recipe carrying the
       golden-hour identity. */
    const golden = getSongPreset("golden-hour-glow")!;
    expect(golden.group).toBe("mood");
    expect(golden.form.mood).toBe("Inspirational");
    expect(golden.form.beatStyle).toContain("Golden-hour");
    /* Structure axis: the bridge is the event — a breakdown to one
       instrument and a raw vocal before the final hook returns. */
    const bridge = getSongPreset("bridge-breakdown")!;
    expect(bridge.group).toBe("structure");
    expect(bridge.form.specialInstructions).toContain("Structure:");
    expect(bridge.form.specialInstructions).toContain("bridge that breaks the song down");
    expect(bridge.form.specialInstructions).toContain("final hook returns at full size");
    expect(Object.keys(songPresetPatch(bridge))).toEqual(["specialInstructions"]);
  });

  it("ids and labels are unique; every preset has an emoji and a Simple prompt", () => {
    expect(new Set(SONG_PRESETS.map((p) => p.id)).size).toBe(SONG_PRESETS.length);
    expect(new Set(SONG_PRESETS.map((p) => p.label)).size).toBe(SONG_PRESETS.length);
    for (const preset of SONG_PRESETS) {
      expect(preset.emoji.length).toBeGreaterThan(0);
      expect(preset.simplePrompt.trim().length).toBeGreaterThan(10);
      expect(getSongPreset(preset.id)).toBe(preset);
    }
    expect(getSongPreset("no-such-preset")).toBeUndefined();
    expect(getSongPreset(null)).toBeUndefined();
  });

  it("keeps all six original hard-coded chips as registry presets", () => {
    const prompts = SONG_PRESETS.map((p) => p.simplePrompt);
    expect(prompts).toContain("catchy pop song with memorable chorus");
    expect(prompts).toContain("hard-hitting hip hop track with confident flow");
    expect(prompts).toContain("powerful rock anthem with epic guitars");
    expect(prompts).toContain("high-energy dance track with infectious beat");
    expect(prompts).toContain("emotional ballad with heartfelt lyrics");
    expect(prompts).toContain("chill lo-fi track with mellow vibes");
  });
});

describe("chips render FROM the registry — no hard-coded literals left in the component", () => {
  it("make-song imports the registry and renders groups from it in both modes", () => {
    expect(pageSrc).toContain('from "@/lib/song-presets"');
    expect(pageSrc).toContain("songPresetsByGroup(group.id)");
    expect(pageSrc).toContain("renderPresetGroups(applySimplePreset)");
    expect(pageSrc).toContain("renderPresetGroups(applyFormPreset)");
    expect(pageSrc).toContain('data-testid="song-presets-simple"');
    expect(pageSrc).toContain('data-testid="song-presets-advanced"');
  });

  it("no preset prompt or label literal remains hard-coded in make-song.tsx", () => {
    for (const preset of SONG_PRESETS) {
      expect(pageSrc, `prompt leaked: ${preset.id}`).not.toContain(preset.simplePrompt);
      /* The old chip array's shape — an inline { label: "… <label>" } —
         must be gone. (Genre names like "Hip Hop" legitimately remain
         as keys of the i18n label-key map for the canonical values.) */
      expect(pageSrc, `chip literal leaked: ${preset.id}`).not.toContain(
        `{ label: "${preset.emoji} ${preset.label}"`,
      );
    }
    expect(pageSrc).not.toContain("Quick styles");
    expect(pageSrc).not.toMatch(/\{\s*label:\s*"🎵/);
  });
});

describe("every preset field maps to a real song-form field", () => {
  it("patch keys are only real form fields, and select values are canonical", () => {
    for (const preset of SONG_PRESETS) {
      const patch = songPresetPatch(preset);
      expect(Object.keys(patch).length).toBeGreaterThan(0);
      for (const key of Object.keys(patch)) {
        expect(REAL_FORM_FIELDS, `${preset.id}.${key}`).toContain(key);
      }
      if (patch.genre) expect(SONG_PRESET_GENRES).toContain(patch.genre);
      if (patch.mood) expect(SONG_PRESET_MOODS).toContain(patch.mood);
      if (patch.songLength) expect(SONG_PRESET_LENGTHS).toContain(patch.songLength);
      /* The form has no tempo/BPM or structure field — a preset must
         never claim one. Structure rides specialInstructions only. */
      expect(patch).not.toHaveProperty("tempo");
      expect(patch).not.toHaveProperty("bpm");
      expect(patch).not.toHaveProperty("structure");
    }
  });

  it("the form's select options derive from the same canonical lists (source)", () => {
    expect(pageSrc).toContain("SONG_PRESET_GENRES.map");
    expect(pageSrc).toContain("SONG_PRESET_MOODS.map");
    expect(pageSrc).toContain("SONG_PRESET_LENGTHS.map");
    /* …and the page registers exactly the real form fields the patches use. */
    for (const field of ["genre", "mood", "songLength", "beatStyle", "specialInstructions"]) {
      expect(pageSrc).toContain(field);
    }
  });

  it("a preset sets exactly what its label says, group by group", () => {
    for (const preset of songPresetsByGroup("genre")) {
      expect(preset.form.genre, preset.id).toBeDefined();
    }
    for (const preset of songPresetsByGroup("mood")) {
      /* Mood presets set the mood select — except Lo-Fi Chill, which the
         registry documents as beat-style only (no Lo-Fi mood exists). */
      if (preset.id === "lo-fi-chill") {
        expect(preset.form.mood).toBeUndefined();
        expect(preset.form.beatStyle).toContain("Lo-fi");
      } else {
        expect(preset.form.mood, preset.id).toBeDefined();
      }
    }
    for (const preset of songPresetsByGroup("structure")) {
      expect(preset.form.specialInstructions, preset.id).toContain("Structure:");
    }
    expect(songPresetPatch(getSongPreset("pop-hit")!)).toEqual({ genre: "Pop" });
    expect(songPresetPatch(getSongPreset("sixty-second-hook")!)).toEqual({
      songLength: "60 seconds",
      specialInstructions:
        "Structure: one tight hook built for a 60-second clip — hook in the first five seconds.",
    });
  });
});

describe("applying a preset prefills — it never submits and never charges", () => {
  it("the registry itself contains no generation, fetch, or charging code", () => {
    expect(registrySrc).not.toMatch(/callGenerateApi|generateSong|chargeCredits|confirmedFetch|fetch\(/);
  });

  it("the Simple apply path only fills the description box (source)", () => {
    const body = functionBody(pageSrc, "applySimplePreset");
    expect(body).toContain("setSimplePrompt(preset.simplePrompt)");
    expect(body).not.toMatch(/generateSong|onSimpleSubmit|handleSubmit|callGenerateApi/);
  });

  it("the Advanced apply path only setValue()s the patch fields (source)", () => {
    const body = functionBody(pageSrc, "applyFormPreset");
    expect(body).toContain("songPresetPatch(preset)");
    for (const field of ["genre", "mood", "songLength", "beatStyle", "specialInstructions"]) {
      expect(body).toContain(`setValue("${field}"`);
    }
    expect(body).not.toMatch(/generateSong|onSubmit|handleSubmit|callGenerateApi/);
  });

  it("preset buttons are type=button inside the Advanced form, so a tap cannot submit it", () => {
    const renderBody = functionBody(pageSrc, "renderPresetGroups");
    expect(renderBody).toContain('type="button"');
    expect(renderBody).toContain("onClick={() => onPick(preset)}");
  });
});
