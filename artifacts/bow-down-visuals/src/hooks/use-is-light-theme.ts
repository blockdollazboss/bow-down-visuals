import { useEffect, useState } from "react";

/**
 * Tracks whether the light theme is active.
 * The theme toggle flips `light` on document.documentElement —
 * this hook stays in sync via MutationObserver so themed assets
 * (logos, mascot art) swap the moment the theme changes.
 */
export function useIsLightTheme(): boolean {
  const [isLight, setIsLight] = useState<boolean>(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("light"),
  );

  useEffect(() => {
    const check = () =>
      setIsLight(document.documentElement.classList.contains("light"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  return isLight;
}
