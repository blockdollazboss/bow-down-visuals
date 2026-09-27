import type { ReactNode } from "react";
import { useUserMode, type StarLevel } from "@/contexts/UserModeContext";

/**
 * Render `children` only when the user's Creator Level is >= `level`.
 * Prefer the `data-min-stars` attribute (pure CSS, no re-render) for simple
 * show/hide; use this component for expensive subtrees or branches that
 * need hooks.
 */
export function MinStars({
  level,
  children,
  fallback = null,
}: {
  level: StarLevel;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { stars } = useUserMode();
  return stars >= level ? <>{children}</> : <>{fallback}</>;
}
