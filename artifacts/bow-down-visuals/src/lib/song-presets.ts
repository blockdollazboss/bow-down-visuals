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
  /* ── Stack 200 upgrade wave (Lane U2): Gospel and Country were
     always values the genre select accepts, but no preset reached
     for them. Both set exactly their genre (plus the beat-style
     recipe words the census specified) — nothing else. ── */
  {
    id: "gospel-choir",
    label: "Gospel Choir",
    emoji: "🙏",
    group: "genre",
    simplePrompt: "uplifting gospel song led by a big choir — call-and-response verses, organ swells, handclaps",
    form: {
      genre: "Gospel",
      beatStyle: "Choir-led — organ and piano, handclaps, call-and-response dynamics",
    },
  },
  {
    id: "country-story",
    label: "Country Story",
    emoji: "🤠",
    group: "genre",
    simplePrompt: "story-first country song — one small-town story told verse by verse, fiddle and steel over acoustic strum",
    form: {
      genre: "Country",
      beatStyle: "Fiddle and pedal steel, acoustic strum, story-first verses",
    },
  },
  /* ── Stack 300 upgrade wave (song-presets lane): Drill, Dancehall
     and Kids Music were the last three genre values the select sells
     with no preset reaching for them ("Other" is the catch-all and
     honestly gets none). Each sets exactly its genre, plus the
     beat-style recipe words its sound is made of. ── */
  {
    id: "drill-serious",
    label: "Serious Drill",
    emoji: "🥶",
    group: "genre",
    simplePrompt: "dark drill track — sliding 808s, urgent strings, cold confident delivery",
    form: {
      genre: "Drill",
      beatStyle: "Sliding 808s, dark piano and strings, drill hi-hat rolls",
    },
  },
  {
    id: "dancehall-heat",
    label: "Dancehall Heat",
    emoji: "🌴",
    group: "genre",
    simplePrompt: "feel-good dancehall song with a waistline groove and a hook built for the dancefloor",
    form: {
      genre: "Dancehall",
      beatStyle: "Dancehall riddim — 3+3+2 groove, warm bass, melodic keys",
    },
  },
  {
    id: "kids-singalong",
    label: "Kids Singalong",
    emoji: "🎈",
    group: "genre",
    simplePrompt: "bright singalong song for kids — simple words, a counting-and-clapping hook, every line easy to shout back",
    form: {
      genre: "Kids Music",
      mood: "Kid-Friendly",
      beatStyle: "Bouncy piano, claps, ukulele strum — nothing scary, everything smiling",
    },
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
  /* ── Stack 300 upgrade wave (song-presets lane): the seven mood
     values the select sells that no preset patched — Luxury, Street,
     Romantic, Pain, Inspirational, Funny, Kid-Friendly. Each sets
     exactly its mood select value, the same one-value-one-preset
     shape as the original five. With these, every mood the form
     sells has a preset. ── */
  {
    id: "luxury-life",
    label: "Luxury Life",
    emoji: "💎",
    group: "mood",
    simplePrompt: "luxury song about the finer things — smooth, expensive-sounding, champagne-room calm",
    form: { mood: "Luxury" },
  },
  {
    id: "romantic-serenade",
    label: "Romantic Serenade",
    emoji: "🌹",
    group: "mood",
    simplePrompt: "romantic love song — warm verses, a hook that says the thing plainly",
    form: { mood: "Romantic" },
  },
  {
    id: "street-anthem",
    label: "Street Anthem",
    emoji: "🏙️",
    group: "mood",
    simplePrompt: "street anthem — block stories, loyalty bars, a hook the whole neighborhood can chant",
    form: { mood: "Street" },
  },
  {
    id: "pain-song",
    label: "Pain Song",
    emoji: "💔",
    group: "mood",
    simplePrompt: "pain song — melodic and honest about the losses, hook that aches",
    form: { mood: "Pain" },
  },
  {
    id: "inspirational-rise",
    label: "Inspirational Rise",
    emoji: "🌅",
    group: "mood",
    simplePrompt: "inspirational song that lifts people up — keep-going verses, a rising hopeful hook",
    form: { mood: "Inspirational" },
  },
  {
    id: "funny-banger",
    label: "Funny Banger",
    emoji: "😂",
    group: "mood",
    simplePrompt: "funny song with joke-dense verses and a hook that lands the punchline every time",
    form: { mood: "Funny" },
  },
  {
    id: "kid-friendly-pop",
    label: "Kid-Friendly Pop",
    emoji: "🧸",
    group: "mood",
    simplePrompt: "kid-friendly song — clean, kind and silly in the right places, safe for the whole family",
    form: { mood: "Kid-Friendly" },
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
  /* ── Stack 200 upgrade wave (Lane U2): the dance-record structure
     none of the six carried — tension first, release second. Like
     every structure preset it rides Special Instructions only. ── */
  {
    id: "build-and-drop",
    label: "Build & Drop",
    emoji: "🔊",
    group: "structure",
    simplePrompt: "dance record built on tension — long rising build, then the drop hits hard",
    form: {
      specialInstructions:
        "Structure: build tension through the verse — rising drums, filtered synths, everything climbing — then a full drop; the second build climbs higher and the final drop lands biggest.",
    },
  },
  /* ── Stack 300 upgrade wave (song-presets lane): the two shapes
     the structure group still lacked — a continuous no-chorus
     freestyle (every earlier entry returns to a hook) and the
     first two-voice shape. Like every structure preset, both ride
     Special Instructions only; no new form field is claimed. ── */
  {
    id: "no-hook-freestyle",
    label: "No-Hook Freestyle",
    emoji: "🎙️",
    group: "structure",
    simplePrompt: "one continuous freestyle verse — no hook, no chorus, the bars never let up",
    form: {
      specialInstructions:
        "Structure: one continuous verse with no hook and no chorus — keep the flow running start to finish, internal rhymes and beat switches carry it.",
    },
  },
  {
    id: "duet-trade-off",
    label: "Duet Trade-Off",
    emoji: "👥",
    group: "structure",
    simplePrompt: "duet — two singers trade verses and come together on the hook",
    form: {
      specialInstructions:
        "Structure: duet — singer one takes verse one, singer two takes verse two, both voices join on the hook; leave a short call-and-response break before the final hook.",
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
