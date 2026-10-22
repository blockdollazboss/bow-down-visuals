import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { mediaBaseUrl } from "@/lib/media-cdn";

/* Theme-aware Shark King portrait: cream robe on light theme,
   black robe on dark. Swaps live when the theme flips. */
export function ThemedSharkImage({ className = "" }: { className?: string }) {
  const isLight = useIsLightTheme();
  const base = mediaBaseUrl();
  return (
    <img
      src={
        isLight
          ? `${base}images/shark-king-light-bowing.png`
          : `${base}images/shark-king-clean-authority.png`
      }
      alt="Thy Cheat Code, the Shark King"
      className={className}
      draggable={false}
    />
  );
}
