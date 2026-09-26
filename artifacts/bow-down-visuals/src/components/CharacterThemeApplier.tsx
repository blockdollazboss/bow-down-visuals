import { useEffect } from "react";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { getCharacterTheme, themeAlpha } from "@/lib/character-themes";

/**
 * Applies the active character's theme as CSS variables on the document root.
 * Any surface can then tint itself to the character via var(--character-*)
 * with a gold fallback, so the whole app feels like WHO you're creating for.
 *
 * Variables set:
 *   --character-primary, --character-highlight, --character-deep,
 *   --character-glow (primary at 35%), --character-tint (primary at 8%),
 *   --character-name (theme display name)
 */
export function CharacterThemeApplier() {
  const { activeArtist } = useActiveArtist();

  useEffect(() => {
    const root = document.documentElement;
    const theme = getCharacterTheme(activeArtist?.theme_id);
    root.style.setProperty("--character-primary", theme.primary);
    root.style.setProperty("--character-highlight", theme.highlight);
    root.style.setProperty("--character-deep", theme.deep);
    root.style.setProperty("--character-glow", themeAlpha(theme.primary, 0.35));
    root.style.setProperty("--character-tint", themeAlpha(theme.primary, 0.08));
    root.style.setProperty("--character-name", `"${theme.name}"`);
    root.setAttribute("data-character-theme", theme.id);
  }, [activeArtist?.theme_id]);

  return null;
}
