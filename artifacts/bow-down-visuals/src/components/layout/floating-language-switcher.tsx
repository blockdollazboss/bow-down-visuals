import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/**
 * Floating language switcher — visible on every page.
 * Fixed position, top-right corner, below any nav headers.
 */
export function FloatingLanguageSwitcher() {
  return (
    <div className="fixed top-4 right-4 z-[9000]">
      <LanguageSwitcher variant="icon" />
    </div>
  );
}
