import { Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Floating "open navigation" button for mobile. The desktop sidebar has its
 * own collapse/expand button, but on mobile the sidebar is a drawer with no
 * visible trigger once closed — this thumb-reachable button (bottom-left,
 * clear of the bottom-right AI chat widget) opens it. Hidden on md+.
 * Must render inside a SidebarProvider.
 */
export function MobileSidebarTrigger() {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      title="Open navigation"
      aria-label="Open navigation"
      data-testid="btn-open-sidebar-mobile"
      className="fixed bottom-5 left-5 z-40 flex h-12 w-12 items-center justify-center rounded-full md:hidden
        border border-primary/40 bg-black/85 text-primary backdrop-blur
        shadow-[0_0_20px_rgba(218,165,32,0.35)]
        transition-all duration-200 hover:bg-primary hover:text-black active:scale-95"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
