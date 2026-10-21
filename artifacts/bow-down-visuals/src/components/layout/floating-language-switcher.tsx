import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/**
 * Floating language switcher — visible on every page.
 * Fixed position, top-left corner (top-right is occupied by the chat widget).
 */
export function FloatingLanguageSwitcher() {
  return (
    <div className="fixed top-4 left-4 z-[9000]">
      <LanguageSwitcher variant="icon" />
    </div>
  );
}
