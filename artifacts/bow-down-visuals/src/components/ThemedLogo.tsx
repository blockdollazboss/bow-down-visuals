import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* Theme-aware site logo: the BDV roundel — gold on dark theme,
   deep bronze on light. Swaps live when the theme flips. */
export function ThemedLogo({ className = "h-8 w-auto" }: { className?: string }) {
  const isLight = useIsLightTheme();
  const base = import.meta.env.BASE_URL;
  return (
    <img
      src={isLight ? `${base}logo-roundel-bronze.svg` : `${base}logo-roundel.svg`}
      alt="Bow Down Visuals"
      className={className}
      draggable={false}
    />
  );
}
