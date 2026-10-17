/**
 * create-desks-followons.ts — the Create Desks PARITY FOLLOW-ON LOG
 * (NATIVE-PLAN §3.6, Lane 6 deliverable).
 *
 * Everything a Create Wing desk's website page can do that the
 * in-world v1 bench deliberately does NOT — named here as
 * NATIVE FOLLOW-ON items so the gap is a tracked list, not a silent
 * shortfall. Until a follow-on ships, the desk's standard transfer
 * footer ("Open on the website ↗") reaches the full page. This is a
 * data log only: nothing here renders or fetches.
 */

export interface NativeFollowOn {
  desk: string;
  item: string;
  /** Where it lives today (the page the transfer footer opens). */
  todayVia: string;
}

export const CREATE_DESK_NATIVE_FOLLOWONS: readonly NativeFollowOn[] = [
  /* ── The Audio Studio deep end — the hub's whole workbench ────── */
  {
    desk: "audio-desk",
    item: "The full multi-tool audio workbench: mix & master, stem splitting, arrangement studio, vocal polish / harmony / singing-voice benches, LUFS normalize, vocal tune, rate-my-mix, podcast + voiceover + hum-to-song benches docked in the Audio Studio hub",
    todayVia: "/audio-studio (the desk's transfer footer)",
  },
  {
    desk: "audio-desk",
    item: "Cleanup/deverb before-and-after A/B player with waveform peaks (the quick bench plays the finished audio only)",
    todayVia: "/audio-studio cleanup + deverb panels",
  },
  {
    desk: "audio-desk",
    item: "Beat bench's remaining Advanced fields: BPM, musical key, length and beat title (v1 exposes genre in Advanced and posts the page's own defaults for the rest — 140 BPM, key C, 60 seconds)",
    todayVia: "/ai-audio beat maker (docked in /audio-studio)",
  },

  /* ── Song Desk ─────────────────────────────────────────────────── */
  {
    desk: "song-desk",
    item: "Inspo mode (playlist vibe → style DNA → song), Song Mashup, and Hum-to-Song tabs",
    todayVia: "/create?panel=song (the desk's transfer footer)",
  },
  {
    desk: "song-desk",
    item: "Artist Vault preset loading, uploaded-song + transcription intake, and the rest of the finished-song action row (song cover, vocal polish, harmony, singing voice, synced-lyrics .lrc export) — publish-to-profile SHIPPED in-world (Ring 2, 2.1: make the audio, then POST /api/publish/track, the /publish page's own rail)",
    todayVia: "/create?panel=song",
  },
  {
    desk: "song-desk",
    item: "Hearing a desk-published song on the jukebox FROM the Create Wing: the chip lights the moment the publish lands (Ring 2, 2.2) and fires jukebox.add like every other surface, but the room authority only runs a jukebox in the Music Hall — an add sent from another room never lands. Palace-wide queueing (or carrying the pick across the doorway) is the remaining rail; today the song plays when the creator taps the chip in the Music Hall itself",
    todayVia: "The Jukebox panel in the Music Hall",
  },

  /* ── Video Desk ────────────────────────────────────────────────── */
  {
    desk: "video-desk",
    item: "The full storyboard flow: song-section analysis, scenes-from-audio, per-scene clip generation with storyboard approval, and project scene autosave (v1 makes one clip from the prompt, plus the optional plan)",
    todayVia: "/create?panel=video",
  },

  /* ── Song + Video Desk ─────────────────────────────────────────── */
  {
    desk: "song-video-desk",
    item: "The guided wizard's later steps: audio-upload + auto-transcribe intake, scene review, and the auto-edit plan application (v1 posts the page's own Turbo defaults / Advanced form to the same endpoint and lands the package in-world)",
    todayVia: "/create?panel=song-video",
  },

  /* ── Cover Art Desk ────────────────────────────────────────────── */
  {
    desk: "cover-art-desk",
    item: "Full preset panels: the one-tap vibe preset grid, the attribution (Made-with) toggle, share menu, publish-to-showcase, and the session history strip (v1 carries style / format / tier in Advanced and the artist-image bench alongside)",
    todayVia: "/create?panel=coverart",
  },

  /* ── Thumbnail Desk ────────────────────────────────────────────── */
  {
    desk: "thumbnail-desk",
    item: "The 4-variation Thumbnail Maker mode (200 VB) and the A/B thumbnail test benches (v1 is the single-shot Artwork generator the station's endpoint names, up to 300 VB, with the library strip)",
    todayVia: "/thumbnail-studio (the desk's transfer footer)",
  },
  {
    desk: "thumbnail-desk",
    item: "Deep Advanced benches: face/asset uploads into the maker, text-overlay editor, and CTR prediction",
    todayVia: "/thumbnail-studio",
  },
];
