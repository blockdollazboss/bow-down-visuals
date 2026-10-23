/* Beat Maker's opening tab — which of its tabs the module starts on.
 *
 * The Producer Tag tab is picked from the URL. Two channels, because the
 * host page (Audio Studio) already owns ?tab= and the AI Audio hub owns
 * ?sub=: a door cannot carry a SECOND ?tab= value through a redirect —
 * URLSearchParams.set collapses repeats away — so the tag pick rides
 * its own param, ?aitab=tag.
 *
 *   ?aitab=tag          → the Producer Tag tab (current doors)
 *   ?tab=…&tab=tag      → the Producer Tag tab (legacy multi-value links)
 *   anything else       → the AI beat tab (the plain beats door included)
 */
export function initialBeatMakerTab(search: string): "ai" | "tag" {
  try {
    const params = new URLSearchParams(search);
    if (params.get("aitab") === "tag") return "tag";
    return params.getAll("tab").includes("tag") ? "tag" : "ai";
  } catch {
    return "ai";
  }
}
