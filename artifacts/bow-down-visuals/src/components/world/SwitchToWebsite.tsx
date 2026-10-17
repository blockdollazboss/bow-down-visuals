import { Globe } from "lucide-react";
import { SWITCH_TO_WEBSITE_LABEL, WEBSITE_HOME_PATH } from "@/lib/world/station-panel";

/* ─── SwitchToWebsite — the standing exit (owner addendum, Oct 17) ──
   A permanent control in the /world page chrome (the header, next
   to Full screen): "Switch to the website". Always reachable while
   in the palace, in both themes, for guests too — it takes no auth
   and reads no state. It is the plain way OUT: a same-tab
   navigation to the site root that leaves the palace entirely.
   Deliberately NOT the per-panel transfer footer ("Open on the
   website ↗"): that one is a peek at a station's exact page in a
   new tab while the palace stays put. This one has no target —
   clicking it exits, which is exactly what it says. Styling copies
   the header's own control (the Full screen button) so the chrome
   stays one furniture set. */

export function SwitchToWebsite({ isLight }: { isLight: boolean }) {
  return (
    <a
      href={WEBSITE_HOME_PATH}
      data-testid="world-switch-to-website"
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
        isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
      }`}
    >
      <Globe className="h-4 w-4" />
      {SWITCH_TO_WEBSITE_LABEL}
    </a>
  );
}
