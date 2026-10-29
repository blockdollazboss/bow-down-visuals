/**
 * Provider display labels (stack800 lane 3 — the provider-string leak
 * pin, board #60's family). Raw provider ids are internal names:
 * the avatar-presenter status endpoint answers the closed enum
 * "heygen" | "hedra", and a scene's `provider` field is a free
 * string written by generation flows. Neither may reach a customer
 * surface verbatim. These pure helpers are the only doors:
 *
 * - avatarProviderLabel: known ids → their public brand names;
 *   anything unknown → the generic feature name, never the raw id.
 * - sceneProviderLabel: the one provider display name the scene
 *   surfaces have ever used is "Runway"; anything else returns null
 *   so the caller falls back to its generic wording ("Scene Clip")
 *   or hides the badge — a raw id is never the fallback.
 */

export function avatarProviderLabel(provider: string | null | undefined): string {
  switch ((provider ?? "").trim().toLowerCase()) {
    case "heygen":
      return "HeyGen";
    case "hedra":
      return "Hedra";
    default:
      return "AI avatar";
  }
}

export function sceneProviderLabel(provider: string | null | undefined): string | null {
  const id = (provider ?? "").trim().toLowerCase();
  if (id === "runway" || id.startsWith("runway-") || id.startsWith("runway ")) {
    return "Runway";
  }
  return null;
}
