/* Shared Shorts navigation metadata. Keeping the route and labels in one
   place lets the sidebar, horizontal navigation, and footer expose the
   same front door without drifting into separate destinations. */
export const SHORTS_NAV_ENTRY = {
  href: "/shorts",
  labelKey: "nav.shorts",
  label: "Shorts",
} as const;

export function isShortsRoute(href: string): boolean {
  return href === SHORTS_NAV_ENTRY.href;
}
