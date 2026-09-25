import { ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExpandSidebarButtonProps {
  /** Whether the sidebar is currently collapsed (controls visibility). */
  collapsed: boolean;
  onExpand: () => void;
}

/**
 * Slim floating "show sidebar" button, visible only while the desktop
 * sidebar is collapsed. Fixed below the sticky video banner so it's always
 * reachable — the user can never get trapped without navigation.
 * Desktop only: on mobile the sidebar is a drawer opened by
 * MobileSidebarTrigger, not a collapsible rail.
 */
export function ExpandSidebarButton({
  collapsed,
  onExpand,
}: ExpandSidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title="Show sidebar"
      aria-label="Show sidebar"
      data-testid="btn-expand-sidebar"
      className={cn(
        "fixed left-3 top-24 z-30 hidden h-9 w-9 items-center justify-center rounded-full",
        "border border-primary/30 bg-black/85 text-primary backdrop-blur",
        "shadow-[0_0_16px_rgba(218,165,32,0.25)]",
        "transition-all duration-200 hover:bg-primary hover:text-black",
        "md:flex",
        collapsed
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0",
      )}
    >
      <ChevronsRight className="h-4 w-4" />
    </button>
  );
}
