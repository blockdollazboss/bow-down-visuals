import { VisualBucsIcon } from "./VisualBucsIcon";

/**
 * CostBadge — shows the Visual Bucs cost on generation buttons BEFORE the user clicks.
 * Part of the cost-before-render pattern: users see the price upfront, not just
 * in the confirmation dialog.
 */
export function CostBadge({ cost, className = "" }: { cost: number; className?: string }) {
  if (!cost || cost <= 0) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-primary/15 border border-primary/30 px-1.5 py-0.5 text-[10px] font-black text-primary ${className}`}
      title={`${cost.toLocaleString("en-US")} Visual Bucs`}
    >
      <VisualBucsIcon className="h-3 w-3" />
      {cost.toLocaleString("en-US")}
    </span>
  );
}
