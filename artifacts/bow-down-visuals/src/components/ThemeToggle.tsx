import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { applyThemeMode, bootThemePack } from "@/lib/theme-packs";

export function ThemeToggle() {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    // Restores mode + any saved theme pack (lib/theme-packs.ts).
    bootThemePack();
    setIsLight(document.documentElement.classList.contains("light"));

    // Sync with other toggles (floating, homepage) via class observer
    const observer = new MutationObserver(() => {
      setIsLight(document.documentElement.classList.contains("light"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const toggle = () => {
    const next = !isLight;
    setIsLight(next);
    // Flipping the mode leaves a pack that doesn't live in the new
    // mode for that mode's house theme (lib/theme-packs.ts).
    applyThemeMode(next ? "light" : "dark");
  };

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors w-full"
      title={isLight ? "Switch to dark theme" : "Switch to light theme"}
    >
      {isLight ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      <span>{isLight ? "Dark" : "Light"}</span>
    </button>
  );
}
