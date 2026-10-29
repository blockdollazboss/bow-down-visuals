import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/**
 * Floating language switcher — visible on every page.
 * Fixed position, top-left corner (top-right is occupied by the chat widget).
 * Corner budget slot T1: top 68px — below the jackpot banner band (~57px),
 * which owns the document-top strip (Stack-28 #58, extended stack700).
 */
export function FloatingLanguageSwitcher() {
  return (
    <div className="fixed top-[4.25rem] left-4 z-[9000]">
      <LanguageSwitcher variant="icon" />
    </div>
  );
}
