import { cva } from "class-variance-authority"

/**
 * buttonVariants — the single button style system. Kept in a JSX-free
 * module so the variant classes stay unit-testable in the node test env.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
           // @replit: no hover, and add primary border
           "bg-primary text-primary-foreground border border-primary-border",
        luxury:
          // Bow Down Visuals — the flagship CTA. Solid gold bullion with a
          // hover-triggered shine sweep, gentle lift, and a soft press.
          "lux-shine border border-[#ffe9a8]/70 bg-gradient-to-b from-[#f7d774] via-[#eab52e] to-[#c98f0e] " +
          "text-[#1a1204] font-bold shadow-[0_10px_36px_-10px_rgba(212,160,23,0.65),inset_0_1px_0_rgba(255,255,255,0.5)] " +
          "transition-all duration-300 hover:-translate-y-0.5 hover:brightness-[1.07] " +
          "hover:shadow-[0_14px_44px_-10px_rgba(212,160,23,0.8),inset_0_1px_0_rgba(255,255,255,0.55)] " +
          "active:translate-y-0 active:brightness-[0.96] active:shadow-[0_6px_20px_-8px_rgba(212,160,23,0.5)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border-destructive-border",
        outline:
          // @replit Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color. Uses shadow-xs. no shadow on active
          // No hover state
          " border [border-color:var(--button-outline)] shadow-xs active:shadow-none ",
        secondary:
          // @replit border, no hover, no shadow, secondary border.
          "border bg-secondary text-secondary-foreground border border-secondary-border ",
        // @replit no hover, transparent border
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // @replit changed sizes
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)
