/* ─── Project-save handoffs ────────────────────────────────────────────────
   What a creation desk saves into a project's input_data is the contract
   the video editor reads back — it derives the timeline's song audio
   SOLELY from input_data.audioUrl (and lyrics from input_data.lyrics).
   The flagship flows used to save their form values without the audio
   URL that lived in separate page state, so the project opened silent
   (linkage audit DE-10). These builders make the carry explicit and
   testable: audio the desk is holding MUST land in inputData. */

export type ProjectInputData = Record<string, unknown>;

/** A URL worth persisting: blob: URLs die with the page session (the hub
 *  tray drops them on reload for the same reason), so a project saved
 *  with one would reopen broken — leave it out instead. */
export function isPersistableMediaUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.trim().length > 0 && !url.startsWith("blob:");
}

/** Merge the desk's current audio URL into the inputData being saved.
 *  Returns the original object untouched when there is no persistable
 *  audio — a save without audio must not gain an audioUrl key. */
export function withProjectAudio(
  inputData: ProjectInputData,
  audioUrl: string | null | undefined,
): ProjectInputData {
  if (!isPersistableMediaUrl(audioUrl)) return inputData;
  return { ...inputData, audioUrl };
}

/** Turbo (Simple) Song+Video save payload — lyrics were always carried;
 *  the song itself now travels too, so the editor opens with it loaded. */
export function turboSongVideoInputData(input: {
  idea: string;
  lyrics: string;
  audioUrl: string | null | undefined;
}): ProjectInputData {
  return withProjectAudio(
    { simpleMode: true, idea: input.idea, lyrics: input.lyrics },
    input.audioUrl,
  );
}

/** How the editor reads a saved project back — mirrored here so tests pin
 *  the seam from the savers' side, not just the editor's. */
export function editorAudioUrlFromInputData(
  inputData: ProjectInputData | null | undefined,
): string | null {
  if (!inputData) return null;
  const direct = inputData["audioUrl"];
  if (typeof direct === "string" && direct) return direct;
  const snake = inputData["audio_url"];
  if (typeof snake === "string" && snake) return snake;
  return null;
}

export function editorLyricsFromInputData(
  inputData: ProjectInputData | null | undefined,
): string {
  if (!inputData) return "";
  for (const key of ["lyrics", "lyricsText", "songLyrics"] as const) {
    const v = inputData[key];
    if (typeof v === "string" && v) return v;
  }
  return "";
}
