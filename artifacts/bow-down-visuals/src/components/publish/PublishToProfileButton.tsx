import { useLocation } from "wouter";
import { Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildPublishUrl, type PublishPrefill } from "@/lib/publish-protocol";

/* The publish deep-link protocol lives in lib/publish-protocol.ts (pure,
   testable); re-exported here so existing import sites keep working. */
export {
  PUBLISH_VERTICALS,
  buildPublishUrl,
  type PublishPrefill,
  type PublishVertical,
} from "@/lib/publish-protocol";

interface Props extends PublishPrefill {
  className?: string;
  label?: string;
  compact?: boolean;
}

/**
 * "Publish to my profile" — one click from any creation tool → /publish
 * with the finished file pre-filled. The cheat-code chain: create → publish →
 * live on your profile → selling.
 */
export function PublishToProfileButton({
  className,
  label,
  compact,
  ...prefill
}: Props) {
  const [, navigate] = useLocation();

  /* No media URL yet (e.g. Movies section): still renders — /publish opens
     with the vertical prefilled and the creator drops their finished file. */
  return (
    <button
      type="button"
      onClick={() => navigate(buildPublishUrl(prefill))}
      title="Send this to Publish — go live on your profile in one click"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-xl font-bold text-amber-300",
        "border border-amber-400/30 bg-amber-400/[0.07]",
        "hover:bg-amber-400/[0.14] hover:border-amber-400/50 transition-colors",
        compact ? "px-2.5 py-1.5 text-[11px]" : "w-full px-4 py-2.5 text-sm",
        className,
      )}
    >
      <Rocket className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {label ?? "Publish to my profile"}
    </button>
  );
}
