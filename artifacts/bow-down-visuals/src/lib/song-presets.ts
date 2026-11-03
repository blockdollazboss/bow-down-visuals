/* ─── Song preset registry ──────────────────────────────────────────────────
   The ONE source of truth for Song Maker starter presets (stack1400 org
   wave, item 4). Before this module the desk's entire "preset system" was
   six prompt strings hard-coded inside make-song.tsx's Simple mode — no
   genre / mood / structure organisation, and nothing the Advanced form
   could ride.

   Why not ride lib/hub-templates.ts? The Hub's six song templates are
   PROJECT starters: a long creative brief plus per-workflow-step hints
   (beat / video / promo) consumed by the Hub project creator. They never
   imported into the song desk, carry no genre/mood/length values, and
   their concept text is a whole project brief — not a form prefill.
   This registry is the desk-level companion: every preset maps onto
   fields the EXISTING song form truly accepts, and nothing else.

   Honesty rules (pinned by song-presets.test.ts):
   - A preset sets exactly what its label says. Genre presets set the
     genre select; mood presets set the mood select (or, for Lo-Fi
     Chill, the beat-style text — there is no Lo-Fi genre/mood value in
     the form, so the preset says so by only touching beat style);
     structure presets write their structure into Special Instructions
     (the form has no dedicated structure field, so structure rides the
     real instructions field — never an invented one).
   - Structure / tempo are NOT form fields: no preset claims to set a
     BPM or a structure field that does not exist.
   - Presets NEVER charge and NEVER submit. Applying one only prefills:
     Simple mode gets the preset's description text; Advanced mode gets
     the preset's form patch. Generation (and its duration-tiered price)
     still happens only from the desk's own Generate buttons.
   ────────────────────────────────────────────────────────────────────────── */

/** The genre values the song form's genre select truly accepts. */
export const SONG_PRESET_GENRES = [
  "Hip Hop",
  "Drill",
  "Trap",
  "R&B",
  "Pop",
  "Afrobeats",
  "Dancehall",
  "Gospel",
  "Kids Music",
  "Rock",
  "Country",
  "Other",
] as const;
export type SongPresetGenre = (typeof SONG_PRESET_GENRES)[number];

/** The mood values the song form's mood select truly accepts. */
export const SONG_PRESET_MOODS = [
  "Luxury",
  "Dark",
  "Emotional",
  "Street",
  "Romantic",
  "Energetic",
  "Pain",
  "Victory",
  "Party",
  "Inspirational",
  "Funny",
  "Kid-Friendly",
] as const;
export type SongPresetMood = (typeof SONG_PRESET_MOODS)[number];

/** The length values the song form's length select truly accepts. */
export const SONG_PRESET_LENGTHS = [
  "30 seconds",
  "60 seconds",
  "2 minutes",
  "Full song",
] as const;
export type SongPresetLength = (typeof SONG_PRESET_LENGTHS)[number];

export type SongPresetGroup = "genre" | "mood" | "structure";

export const SONG_PRESET_GROUPS: Array<{ id: SongPresetGroup; label: string }> = [
  { id: "genre", label: "By genre" },
  { id: "mood", label: "By mood & vibe" },
  { id: "structure", label: "By structure" },
];

/**
 * The subset of real SongFormValues fields a preset may prefill.
 * Keys are exactly the Advanced form's field names (make-song.tsx) —
 * a key that is not a real form field must never appear here.
 */
export interface SongPresetFormPatch {
  genre?: SongPresetGenre;
  mood?: SongPresetMood;
  songLength?: SongPresetLength;
  beatStyle?: string;
  specialInstructions?: string;
}

export interface SongPreset {
  id: string;
  label: string;
  emoji: string;
  group: SongPresetGroup;
  /** Simple (Turbo) mode: the description text the preset fills in.
      onSimpleSubmit feeds this to the rail as the song topic. */
  simplePrompt: string;
  /** Advanced mode: the real form fields the preset prefills. */
  form: SongPresetFormPatch;
}

export const SONG_PRESETS: SongPreset[] = [
  /* ── By genre — every one sets the genre select to its label ── */
  {
    id: "pop-hit",
    label: "Pop Hit",
    emoji: "🎵",
    group: "genre",
    simplePrompt: "catchy pop song with memorable chorus",
    form: { genre: "Pop" },
  },
  {
    id: "hip-hop",
    label: "Hip Hop",
    emoji: "🎤",
    group: "genre",
    simplePrompt: "hard-hitting hip hop track with confident flow",
    form: { genre: "Hip Hop" },
  },
  {
    id: "trap-banger",
    label: "Trap Banger",
    emoji: "🔥",
    group: "genre",
    simplePrompt: "dark trap anthem about coming up from nothing, chant-ready hook",
    form: {
      genre: "Trap",
      beatStyle: "Dark piano loop, sliding 808s, rolling hi-hats",
    },
  },
  {
    id: "rnb-slow-jam",
    label: "R&B Slow Jam",
    emoji: "🌙",
    group: "genre",
    simplePrompt: "silky late-night R&B slow jam with stacked harmonies on the hook",
    form: {
      genre: "R&B",
      beatStyle: "Warm Rhodes chords, soft kick, roomy snare",
    },
  },
  {
    id: "afrobeats-party",
    label: "Afrobeats Party",
    emoji: "☀️",
    group: "genre",
    simplePrompt: "feel-good Afrobeats party song with a call-and-response hook",
    form: {
      genre: "Afrobeats",
      beatStyle: "Log drums, shakers, melodic guitar plucks",
    },
  },
  {
    id: "rock-anthem",
    label: "Rock Anthem",
    emoji: "🎸",
    group: "genre",
    simplePrompt: "powerful rock anthem with epic guitars",
    form: { genre: "Rock" },
  },

  /* ── By mood & vibe — sets the mood select (Lo-Fi: beat style only,
        because the form has no Lo-Fi genre or mood value) ── */
  {
    id: "emotional-ballad",
    label: "Emotional Ballad",
    emoji: "😢",
    group: "mood",
    simplePrompt: "emotional ballad with heartfelt lyrics",
    form: { mood: "Emotional" },
  },
  {
    id: "dance-energy",
    label: "Dance Energy",
    emoji: "💃",
    group: "mood",
    simplePrompt: "high-energy dance track with infectious beat",
    form: { mood: "Energetic" },
  },
  {
    id: "dark-moody",
    label: "Dark & Moody",
    emoji: "🌑",
    group: "mood",
    simplePrompt: "dark, moody song with a haunting melody",
    form: { mood: "Dark" },
  },
  {
    id: "party-starter",
    label: "Party Starter",
    emoji: "🎉",
    group: "mood",
    simplePrompt: "party starter song everyone can sing along to from the first hook",
    form: { mood: "Party" },
  },
  {
    id: "victory-anthem",
    label: "Victory Anthem",
    emoji: "🏆",
    group: "mood",
    simplePrompt: "victory anthem about winning after everyone counted you out",
    form: { mood: "Victory" },
  },
  {
    id: "lo-fi-chill",
    label: "Lo-Fi Chill",
    emoji: "🌧️",
    group: "mood",
    simplePrompt: "chill lo-fi track with mellow vibes",
    form: { beatStyle: "Lo-fi chill beat — mellow chords, soft drums, vinyl crackle" },
  },

  /* ── By structure — structure rides Special Instructions, the real
        free-text field the form sends as generation instructions ── */
  {
    id: "hook-first",
    label: "Hook First",
    emoji: "🪝",
    group: "structure",
    simplePrompt: "hook-first song — open with a catchy hook, then verse, hook, verse, hook",
    form: {
      specialInstructions: "Structure: open with the hook, then verse, hook, verse, hook again.",
    },
  },
  {
    id: "verse-hook-verse",
    label: "Verse–Hook–Verse",
    emoji: "🔁",
    group: "structure",
    simplePrompt: "verse, pre-chorus lift, big chorus, second verse, final chorus",
    form: {
      specialInstructions:
        "Structure: verse, pre-chorus lift, big chorus, second verse, final chorus.",
    },
  },
  {
    id: "three-verse-story",
    label: "Three-Verse Story",
    emoji: "📖",
    group: "structure",
    simplePrompt: "storytelling song — three verses telling one vivid story in order",
    form: {
      specialInstructions:
        "Structure: three verses telling one story in order, vivid scene-setting bars, no hook gimmicks — the verses carry it.",
    },
  },
  {
    id: "call-and-response",
    label: "Call & Response",
    emoji: "📣",
    group: "structure",
    simplePrompt: "call-and-response song with a hook the crowd can answer back",
    form: {
      specialInstructions: "Structure: call-and-response hook the crowd can answer back.",
    },
  },
  {
    id: "sixty-second-hook",
    label: "60-Second Hook Song",
    emoji: "⏱️",
    group: "structure",
    simplePrompt: "tight 60-second hook song — the hook lands in the first five seconds",
    form: {
      songLength: "60 seconds",
      specialInstructions:
        "Structure: one tight hook built for a 60-second clip — hook in the first five seconds.",
    },
  },
  {
    id: "full-song-anthem",
    label: "Full Song Build",
    emoji: "💿",
    group: "structure",
    simplePrompt: "full song — intro, two verses, big chorus, bridge, final chorus",
    form: {
      songLength: "Full song",
      specialInstructions:
        "Structure: full song — intro, two verses, big chorus, bridge, final chorus.",
    },
  },
];

export function songPresetsByGroup(group: SongPresetGroup): SongPreset[] {
  return SONG_PRESETS.filter((p) => p.group === group);
}

export function getSongPreset(id: string | null | undefined): SongPreset | undefined {
  if (!id) return undefined;
  return SONG_PRESETS.find((p) => p.id === id);
}

/**
 * The Advanced-form prefill for a preset: a plain partial patch of real
 * form fields, nothing else. Pure — no submit, no charge, no fetch.
 */
export function songPresetPatch(preset: SongPreset): SongPresetFormPatch {
  return { ...preset.form };
}
