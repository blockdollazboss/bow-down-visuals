import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

/* Floating theme toggle — always visible on every page, top-right.
   User directive 2026-10-10: theme switch must never be hidden. */
export function FloatingThemeToggle() {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("bdv-theme");
    const light = saved === "light";
    setIsLight(light);
    document.documentElement.classList.toggle("light", light);
    document.documentElement.classList.toggle("dark", !light);
  }, []);

  // Listen for theme changes from other toggles (sidebar, homepage)
  useEffect(() => {
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
    document.documentElement.classList.toggle("light", next);
    document.documentElement.classList.toggle("dark", !next);
    localStorage.setItem("bdv-theme", next ? "light" : "dark");
  };

  return (
    <button
      onClick={toggle}
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      title={isLight ? "Switch to dark theme" : "Switch to light theme"}
      className="fixed top-4 right-4 z-[9999] flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-black/60 text-primary shadow-lg backdrop-blur-md transition hover:scale-105 hover:bg-black/80 light:bg-white/80 light:text-[#7A5A12] light:hover:bg-white"
    >
      {isLight ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
    </button>
  );
}
