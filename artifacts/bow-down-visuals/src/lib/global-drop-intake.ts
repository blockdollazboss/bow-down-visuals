/**
 * global-drop-intake — the receiving half of the Global Drop (#165)
 * preloaded door (stack1300).
 *
 * The server stamps each version's Translate & Dub door with
 * `?gd=<releaseId>&lang=<code>` (api-server lib/global-drop.ts —
 * globalDropTranslateLink). The /translate route preserves the query
 * into the video editor, and the Translate surface consumes the pair
 * here:
 *
 *  - the pair is STRUCTURED data only — it preselects the version's
 *    language and, once verified against the caller's own package,
 *    names the return slot for the finished dub's video URL;
 *  - a pair that doesn't name one of the five launch languages, or
 *    carries no release, parses to NOTHING — no intake happens, and
 *    the raw params are never rendered anywhere as text (the dead
 *    literal-text landing the trend-preload lane killed);
 *  - verification itself lives on the surface (GET the package): a
 *    pair that doesn't resolve to a real version of the caller's own
 *    package is refused there in plain words.
 */

/** Mirror of the server's GLOBAL_DROP_LANGUAGES codes — the five
 *  launch languages a Global Drop package can hold. Change both
 *  sides together (the api suite pins the server list against the
 *  dub rail's TARGET_LANGUAGES). */
export const GLOBAL_DROP_INTAKE_LANGUAGES = ["es", "pt", "fr", "de", "ja"] as const;

export type GlobalDropIntakeLanguage = (typeof GLOBAL_DROP_INTAKE_LANGUAGES)[number];

export interface GlobalDropIntake {
  releaseId: string;
  language: GlobalDropIntakeLanguage;
}

/** Parse the preload pair out of a query string (leading "?" optional).
 *  Returns null when the pair is absent or malformed — a plain visit
 *  to Translate & Dub (no door) parses to null and behaves exactly as
 *  it always has. */
export function parseGlobalDropIntake(search: string): GlobalDropIntake | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const releaseId = params.get("gd")?.trim() ?? "";
  const lang = params.get("lang")?.trim() ?? "";
  if (!releaseId) return null;
  if (!(GLOBAL_DROP_INTAKE_LANGUAGES as readonly string[]).includes(lang)) return null;
  return { releaseId, language: lang as GlobalDropIntakeLanguage };
}

/** The query string with the preload pair removed (everything else —
 *  notably the editor's `tab` — preserved, order intact). The surface
 *  rewrites the URL with this once the intake settles, so a refresh
 *  doesn't re-fire the door and the raw params don't linger. */
export function withoutGlobalDropParams(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.delete("gd");
  params.delete("lang");
  return params.toString();
}
