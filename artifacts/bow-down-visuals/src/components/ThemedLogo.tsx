import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { mediaBaseUrl } from "@/lib/media-cdn";

/* Theme-aware site logo: the ivory-ribbon version on light theme,
   the black-ribbon version on dark. Swaps live when the theme flips. */
export function ThemedLogo({ className = "h-8 w-auto" }: { className?: string }) {
  const isLight = useIsLightTheme();
  const base = mediaBaseUrl();
  return (
    <img
      src={isLight ? `${base}logo-light.webp` : `${base}logo-static.webp`}
      alt="Bow Down Visuals"
      className={className}
      draggable={false}
    />
  );
}
