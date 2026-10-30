import { Coins, Crown, FlaskConical, UserPlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ALERT_DISPLAY_MS, type OverlayAlertData } from "@/lib/stream-overlay-client";

/* ─── Overlay alert card (stack900 lane C2) ───────────────────────────────
   The pop a viewer sees on the creator's program output when a tip
   lands, a fan follows, or a member joins. Rendered on a transparent
   page inside an OBS / Streamlabs browser source, so:
     - colors are explicit hex, never theme classes — the site's
       light/dark remap tables don't reach a browser source, and the
       card must look identical on every stream;
     - the animation is timed to ALERT_DISPLAY_MS, the same constant
       the feed's display pump runs on: pop in, hold, fade out —
       then the pump advances the queue.
   A TEST alert is labelled TEST on its face, always — a test must
   never be mistakable for a real fan moment. */

const KIND_PRESENTATION: Record<
  OverlayAlertData["kind"],
  { icon: LucideIcon; eyebrow: string }
> = {
  tip: { icon: Coins, eyebrow: "New tip" },
  follow: { icon: UserPlus, eyebrow: "New follower" },
  member: { icon: Crown, eyebrow: "New member" },
  test: { icon: FlaskConical, eyebrow: "Test alert" },
};

const OVERLAY_ALERT_CSS = `
@keyframes bdv-overlay-alert {
  0% { opacity: 0; transform: translateY(18px) scale(0.96); }
  7% { opacity: 1; transform: translateY(0) scale(1); }
  88% { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(-8px) scale(0.99); }
}
`;

export function OverlayAlertCard({
  alert,
  style,
}: {
  alert: OverlayAlertData;
  style: "dark" | "light";
}) {
  const { icon: Icon, eyebrow } = KIND_PRESENTATION[alert.kind];
  const light = style === "light";
  return (
    <div
      data-testid="overlay-alert-card"
      data-kind={alert.kind}
      className="pointer-events-none w-[min(92vw,430px)] rounded-2xl border-2 px-5 py-4 shadow-2xl"
      style={{
        backgroundColor: light ? "#FBF6E9" : "#12100C",
        borderColor: light ? "#C9A84C" : "#D4AF37",
        color: light ? "#2A1E07" : "#F7EFDB",
        animation: `bdv-overlay-alert ${ALERT_DISPLAY_MS}ms linear forwards`,
      }}
    >
      <style>{OVERLAY_ALERT_CSS}</style>
      <div className="flex items-center gap-2">
        <Icon
          className="h-5 w-5"
          style={{ color: light ? "#7A5A12" : "#E8C86A" }}
          aria-hidden
        />
        <span
          className="text-[11px] font-black uppercase tracking-[0.18em]"
          style={{ color: light ? "#7A5A12" : "#E8C86A" }}
        >
          {eyebrow}
        </span>
        {alert.test && (
          <span
            data-testid="overlay-alert-test-badge"
            className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em]"
            style={{
              backgroundColor: light ? "#7A5A12" : "#D4AF37",
              color: light ? "#FBF6E9" : "#12100C",
            }}
          >
            Test
          </span>
        )}
      </div>
      <p className="mt-1.5 text-lg font-black leading-snug">{alert.title}</p>
      {alert.body && (
        <p
          className="mt-1 text-sm font-semibold leading-snug"
          style={{ color: light ? "#6B5B36" : "#CFC4A5" }}
        >
          {alert.body}
        </p>
      )}
    </div>
  );
}
