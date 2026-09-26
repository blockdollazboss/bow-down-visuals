import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-xl border border-white/[0.1] px-3.5 py-2.5 text-sm",
        "bg-[linear-gradient(180deg,hsl(0_0%_100%/0.04),hsl(0_0%_100%/0.015))]",
        "text-foreground shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.3)]",
        "transition-[border-color,box-shadow,background-color] duration-200",
        "placeholder:text-muted-foreground hover:border-white/[0.18]",
        "focus-visible:outline-none focus-visible:border-[hsl(45_95%_55%/0.6)]",
        "focus-visible:shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.3),0_0_0_3px_hsl(45_95%_50%/0.15),0_0_20px_-4px_hsl(45_95%_50%/0.35)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
