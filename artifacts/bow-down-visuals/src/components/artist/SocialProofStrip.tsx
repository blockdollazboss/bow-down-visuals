import type { ComponentType } from "react";
import { InstagramIcon } from "@/components/ui/instagram-icon";
import { TikTokIcon } from "@/components/ui/tiktok-icon";
import { FacebookIcon } from "@/components/ui/facebook-icon";
import type { SocialProofFigureDto } from "@/lib/artist-profiles";
import { formatProofValue, liveProofFigures, proofUpdatedLabel } from "@/lib/social-proof-display";

/* ─── Live social proof (C5) — verified audience figures from the
   creator's connected accounts, rendered on the Grand Stage profile.
   The server only ships figures a platform rail actually returned
   (already filtered: creator-hidden, disconnected, and >7-day-old
   figures never arrive), each stamped with WHEN it was measured.
   Counts render in full — no k-abbreviations, no rounding up — and
   every figure carries its "Updated <date>" provenance line. The
   strip hides itself entirely when no figure is live. */

const PLATFORM_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  instagram: InstagramIcon,
  tiktok: TikTokIcon,
  facebook: FacebookIcon,
};

export default function SocialProofStrip({ figures }: { figures: SocialProofFigureDto[] | undefined }) {
  const live = liveProofFigures(figures);
  if (live.length === 0) return null;
  return (
    <div className="flex justify-center px-4 pb-4" data-testid="social-proof-strip">
      <div
        className="flex max-w-full flex-wrap items-stretch justify-center gap-x-6 gap-y-3 rounded-2xl border px-5 py-3"
        style={{ borderColor: "var(--ap-border)", backgroundColor: "var(--ap-card)" }}
      >
        {live.map((f) => {
          const Icon = PLATFORM_ICONS[f.platform];
          const updated = proofUpdatedLabel(f.updatedAt);
          return (
            <div key={f.key} className="flex items-center gap-2.5" title={f.accountLabel ? `${f.label} — @${f.accountLabel.replace(/^@/, "")}` : f.label}>
              {Icon ? <Icon className="h-5 w-5 shrink-0" /> : null}
              <div className="leading-tight">
                <div className="text-base font-black tabular-nums">
                  {formatProofValue(f.value)}
                  <span className="ml-1.5 text-xs font-semibold opacity-70">{f.label}</span>
                </div>
                {updated && (
                  <div className="text-[10px] font-medium uppercase tracking-wider opacity-50">
                    Updated {updated}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
