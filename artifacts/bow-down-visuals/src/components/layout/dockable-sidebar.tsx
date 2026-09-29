import { useSidebarDock, type DockPosition } from "@/hooks/use-sidebar-dock";
import { AppSidebar } from "./app-sidebar";
import { GripVertical, Home, Layers, Sparkles, TrendingUp, DollarSign, GraduationCap, Settings } from "lucide-react";
import { Link, useLocation } from "wouter";

export function DockableSidebar() {
  const { docked, isDragging, dragPos, onPointerDown, onPointerMove, onPointerUp } = useSidebarDock();

  const getPositionStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = { position: "fixed", zIndex: 50, transition: isDragging ? "none" : "all 0.3s ease-out" };
    switch (docked) {
      case "left": return { ...base, left: 0, top: 0, bottom: 0, width: "var(--sidebar-width, 16rem)" };
      case "right": return { ...base, right: 0, top: 0, bottom: 0, width: "var(--sidebar-width, 16rem)" };
      case "top": return { ...base, top: 0, left: 0, right: 0, height: "4rem" };
      case "bottom": return { ...base, bottom: 0, left: 0, right: 0, height: "4rem" };
    }
  };

  const isHorizontal = docked === "top" || docked === "bottom";

  return (
    <>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={`fixed z-[60] cursor-grab active:cursor-grabbing flex items-center justify-center bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg transition-colors ${docked === "left" ? "left-2 top-1/2 -translate-y-1/2 w-6 h-16" : ""} ${docked === "right" ? "right-2 top-1/2 -translate-y-1/2 w-6 h-16" : ""} ${docked === "top" ? "top-2 left-1/2 -translate-x-1/2 h-6 w-16" : ""} ${docked === "bottom" ? "bottom-2 left-1/2 -translate-x-1/2 h-6 w-16" : ""}`}
        title="Drag to dock sidebar to any edge"
      >
        <GripVertical className={`h-4 w-4 text-primary/60 ${isHorizontal ? "rotate-90" : ""}`} />
      </div>
      <div style={getPositionStyles()} className={isHorizontal ? "overflow-x-auto" : "overflow-y-auto"}>
        {isHorizontal ? <HorizontalNav docked={docked} /> : <AppSidebar />}
      </div>
      {isDragging && dragPos && (
        <div className="fixed z-[70] pointer-events-none" style={{ left: dragPos.x - 100, top: dragPos.y - 20, width: 200, height: 40 }}>
          <div className="w-full h-full rounded-lg border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center">
            <span className="text-xs font-bold text-primary">Drop to dock: {getNearestEdgeLabel(dragPos.x, dragPos.y)}</span>
          </div>
        </div>
      )}
    </>
  );
}

function getNearestEdgeLabel(x: number, y: number): string {
  const w = window.innerWidth; const h = window.innerHeight;
  const min = Math.min(x, w - x, y, h - y);
  if (min === x) return "Left";
  if (min === w - x) return "Right";
  if (min === y) return "Top";
  return "Bottom";
}

function HorizontalNav({ docked }: { docked: DockPosition }) {
  const [location] = useLocation();
  const mainSections = [
    { title: "Home", href: "/", icon: Home },
    { title: "Create", href: "/hub", icon: Layers },
    { title: "AI Studio", href: "/hooks", icon: Sparkles },
    { title: "Grow", href: "/content-calendar", icon: TrendingUp },
    { title: "Monetize", href: "/pricing", icon: DollarSign },
    { title: "Learn", href: "/academy", icon: GraduationCap },
    { title: "Tools", href: "/settings", icon: Settings },
  ];
  return (
    <div className={`h-full w-full bg-sidebar flex items-center px-4 gap-2 overflow-x-auto ${docked === "top" ? "border-b border-sidebar-border" : "border-t border-sidebar-border"}`}>
      <Link href="/" className="flex items-center gap-2 mr-4 shrink-0">
        <img src={`${import.meta.env.BASE_URL}logo-static.png`} alt="Bow Down Visuals" className="h-8 w-auto" />
      </Link>
      {mainSections.map((section) => {
        const Icon = section.icon;
        const isActive = location === section.href;
        return (
          <Link key={section.title} href={section.href} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}>
            <Icon className="h-4 w-4" />
            <span className="hidden md:inline">{section.title}</span>
          </Link>
        );
      })}
    </div>
  );
}
