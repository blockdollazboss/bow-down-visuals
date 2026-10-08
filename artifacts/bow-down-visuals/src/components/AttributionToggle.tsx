import { Link } from "wouter";
import { Tag } from "lucide-react";

/* ─── AttributionToggle — the virality playbook, shared opt-in ──────────
   One gold/black checkbox used by every paid export panel that offers the
   opt-in "Made with Bow Down Visuals" credit. Free/bonus exports carry the
   credit by default (removable only via the watermark-removal upsell);
   paid exports offer it here as an opt-in — every export is a billboard. */

interface AttributionToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Compact variant for dense panels (smaller padding/text). */
  compact?: boolean;
}

export function AttributionToggle({ checked, onChange, disabled, compact }: AttributionToggleProps) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] ${
        compact ? "px-3 py-2" : "px-4 py-3"
      } ${disabled ? "opacity-60" : "cursor-pointer hover:border-primary/30"} transition-colors`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 accent-[#d4af37]"
        data-testid="attribution-toggle"
      />
      <span>
        <span className="flex items-center gap-1.5 text-xs font-bold text-white">
          <Tag className="h-3.5 w-3.5 text-primary" />
          Add &ldquo;Made with Bow Down Visuals&rdquo; credit
        </span>
        <span className={`block ${compact ? "text-[10px]" : "text-[11px]"} text-white/45 mt-0.5`}>
          A small gold credit rides with your export — free promotion for your
          work, and it tells viewers how you made it.{" "}
          <Link href="/watermark-removal" className="text-primary hover:underline font-semibold">
            Remove credits →
          </Link>
        </span>
      </span>
    </label>
  );
}
