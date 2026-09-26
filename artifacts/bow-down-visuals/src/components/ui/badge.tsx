import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // @replit
  // Whitespace-nowrap: Badges should never wrap.
  "whitespace-nowrap inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-[0.08em] uppercase transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" +
  " hover-elevate ",
  {
    variants: {
      variant: {
        default:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          // Premium: gold gradient pill with inner highlight
          "border-[hsl(45_90%_55%/0.4)] bg-[linear-gradient(180deg,hsl(45_95%_50%/0.22),hsl(45_95%_50%/0.1))] text-[hsl(45_95%_68%)] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.15),0_4px_14px_-6px_hsl(45_95%_50%/0.5)]",
        secondary:
          // @replit no hover because we use hover-elevate
          "border-white/[0.12] bg-white/[0.05] text-secondary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.08)]",
        destructive:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          "border-transparent bg-destructive text-destructive-foreground shadow-xs",
          // @replit shadow-xs" - use badge outline variable
        outline: "text-foreground border [border-color:var(--badge-outline)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
