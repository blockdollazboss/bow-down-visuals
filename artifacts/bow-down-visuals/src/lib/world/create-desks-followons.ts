/**
 * create-desks-followons.ts — the Create Desks PARITY FOLLOW-ON LOG
 * (NATIVE-PLAN §3.6, Lane 6 deliverable).
 *
 * Everything a Create Wing desk's website page can do that the
 * in-world benches deliberately do NOT — named here as NATIVE
 * FOLLOW-ON items so the gap is a tracked list, not a silent
 * shortfall. Until a follow-on ships, the desk's standard transfer
 * footer ("Open on the website ↗") reaches the full page. This is a
 * data log only: nothing here renders or fetches.
 *
 * Ring 2 retirement pass (Lane G): items 2.3–2.11 shipped in-world
 * and their entries were retired — the storyboard flow (2.3), the
 * Song+Video wizard steps (2.4), the Song Desk Inspo/Mashup/Hum
 * tabs + vault presets + upload/transcribe intake (2.5), the full
 * audio workbench (2.6), the cleanup/deverb A/B player (2.7), the
 * beat bench fields (2.8), the thumbnail 4-variation maker + A/B
 * benches (2.9), thumbnail face/asset uploads + text-overlay
 * editor + CTR prediction (2.10), and the Cover Art preset grid /
 * attribution toggle / share menu / publish-to-showcase / session
 * history (2.11). What remains below is the honest remainder.
 */

export interface NativeFollowOn {
  desk: string;
  item: string;
  /** Where it lives today (the page the transfer footer opens). */
  todayVia: string;
}

export const CREATE_DESK_NATIVE_FOLLOWONS: readonly NativeFollowOn[] = [
  /* ── The Audio Studio deep end — what the full bench does NOT do ── */
  {
    desk: "audio-desk",
    item: "Arrangement timeline editing in-world: the full ArrangementStudio (clip comping, automation curves, MIDI piano roll, effects chains, ducking) and its export render — the in-world arrangement bench (Ring 2, 2.6) loads/saves the same server draft and edits title/BPM/track mutes only",
    todayVia: "/audio-studio arrangement tab (the desk's transfer footer)",
  },
  {
    desk: "audio-desk",
    item: "Harmony AI mode (the modes probe prices it server-side, not via the credit registry — the in-world bench docks the registry-priced classic doubles only) and the stems remix-levels bench (per-stem level mixdown after a split)",
    todayVia: "/audio-studio + the song page's harmony modal",
  },

  /* ── Song Desk ─────────────────────────────────────────────────── */
  {
    desk: "song-desk",
    item: "The rest of the finished-song action row: song cover from the package and the synced-lyrics .lrc export (publish-to-profile SHIPPED Ring 2 2.1; vocal polish / harmony / singing-voice SHIPPED at the Audio Desk, Ring 2 2.6; Inspo / Mashup / Hum-to-Song tabs, vault preset loading and upload + transcription intake SHIPPED Ring 2 2.5)",
    todayVia: "/create?panel=song",
  },
  {
    desk: "song-desk",
    item: "Hearing a desk-published song on the jukebox FROM the Create Wing: the chip lights the moment the publish lands (Ring 2, 2.2) and fires jukebox.add like every other surface, but the room authority only runs a jukebox in the Music Hall — an add sent from another room never lands. Palace-wide queueing (or carrying the pick across the doorway) is the remaining rail; today the song plays when the creator taps the chip in the Music Hall itself",
    todayVia: "The Jukebox panel in the Music Hall",
  },

  /* ── Thumbnail Desk ────────────────────────────────────────────── */
  {
    desk: "thumbnail-desk",
    item: "The CTR bench's apply-suggestions rail (POST /api/thumbnail-test/improve — regenerate a candidate with the predictor's tips applied): the prediction itself SHIPPED in-world (Ring 2, 2.10) alongside the 4-variation maker, A/B variants, face/asset uploads and the text-overlay editor (2.9 + 2.10)",
    todayVia: "/thumbnail-studio (the desk's transfer footer)",
  },
];
