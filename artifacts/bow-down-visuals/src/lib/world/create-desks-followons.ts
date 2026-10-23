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
 * history (2.11).
 *
 * Stack-100 Stage D retirement pass (items 49–52): the Song Desk
 * finishers (cover-from-package via the site's own CoverSongModal
 * + synced-lyrics .lrc export via its LrcExportModal), the CTR
 * bench's apply-suggestions rail, the Audio Desk deep end I
 * (Harmony AI mode via the modes probe + the stems remix-levels
 * mixdown) and deep end II (the site's own ArrangementStudio
 * mounted in-world on the shared audio-arrangement draft) all
 * shipped in-world and their entries were retired. What remains
 * below is the honest remainder.
 */

export interface NativeFollowOn {
  desk: string;
  item: string;
  /** Where it lives today (the page the transfer footer opens). */
  todayVia: string;
}

export const CREATE_DESK_NATIVE_FOLLOWONS: readonly NativeFollowOn[] = [
  /* ── Song Desk ─────────────────────────────────────────────────── */
  {
    desk: "song-desk",
    item: "Hearing a desk-published song on the jukebox FROM the Create Wing: the chip lights the moment the publish lands (Ring 2, 2.2) and fires jukebox.add like every other surface, but the room authority only runs a jukebox in the Music Hall — an add sent from another room never lands. Palace-wide queueing (or carrying the pick across the doorway) is the remaining rail; today the song plays when the creator taps the chip in the Music Hall itself",
    todayVia: "The Jukebox panel in the Music Hall",
  },
];
