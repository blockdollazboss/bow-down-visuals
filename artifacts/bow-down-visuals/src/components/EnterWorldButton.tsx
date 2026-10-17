import { Link, useLocation } from "wouter";
import { Crown } from "lucide-react";
import {
  ENTER_WORLD_CLASSNAME,
  ENTER_WORLD_LABEL,
  ENTER_WORLD_TEST_ID,
  WORLD_ROUTE,
  shouldShowWorldEntry,
} from "@/lib/world-entry";

/* ─── The Reverse Door — shell control (owner, 2026-10-17) ──────────────
   Mounted once in AppShell beside the floating theme toggle, so it
   renders on every route the shell serves: the authed layout, marketing
   pages, auth pages, and public surfaces alike. One click navigates
   client-side to /world (the King's Hall), same tab. No auth gating —
   the hall admits guests. Hidden only on /world itself. The contract
   (target, label, styling, visibility) lives in lib/world-entry.ts. */
export function EnterWorldButton() {
  const [location] = useLocation();
  if (!shouldShowWorldEntry(location)) return null;
  return (
    <Link
      href={WORLD_ROUTE}
      data-testid={ENTER_WORLD_TEST_ID}
      aria-label="Enter the World — step into the King's Hall"
      title="Enter the World — step into the King's Hall"
      className={ENTER_WORLD_CLASSNAME}
    >
      <Crown className="h-4 w-4" />
      {ENTER_WORLD_LABEL}
    </Link>
  );
}
