import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-sm font-semibold leading-none tracking-tight shadow-sm transition-[transform,box-shadow,background-color,color,border-color] duration-150 disabled:pointer-events-none disabled:opacity-50 enabled:active:translate-y-px [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "border-primary/70 bg-primary text-primary-foreground hover:bg-primary/92 enabled:hover:shadow-md enabled:active:bg-primary/85",
        destructive:
          "border-destructive/70 bg-destructive text-white hover:bg-destructive/92 enabled:hover:shadow-md enabled:active:bg-destructive/85 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border-border bg-background/95 text-foreground hover:border-foreground/20 hover:bg-accent/70 hover:text-accent-foreground enabled:hover:shadow-md enabled:active:bg-accent enabled:active:shadow-sm dark:bg-input/25 dark:border-input/90 dark:hover:bg-input/45 dark:hover:border-input",
        secondary:
          "border-border/70 bg-secondary text-secondary-foreground hover:bg-secondary/88 enabled:hover:shadow-sm",
        ghost:
          "border-transparent bg-transparent text-foreground/85 shadow-none hover:border-border/80 hover:bg-accent/60 hover:text-foreground enabled:hover:shadow-sm enabled:active:bg-accent/80 dark:text-foreground/80 dark:hover:border-border/60 dark:hover:bg-accent/40",
        link: "border-transparent bg-transparent p-0 text-primary underline-offset-4 shadow-none hover:underline",
        success:
          "border-emerald-300 bg-emerald-600 text-white hover:bg-emerald-700 enabled:hover:shadow-md enabled:active:bg-emerald-800 dark:border-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600",
        "success-light":
          "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 enabled:hover:shadow-sm dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/45",
      },
      size: {
        default: "h-8 px-3 has-[>svg]:px-2",
        xs: "h-6 gap-1 rounded-md px-1.5 text-xs has-[>svg]:px-1 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 rounded-md gap-1.5 px-2 has-[>svg]:px-1.5",
        lg: "h-10 rounded-md px-4 has-[>svg]:px-3",
        icon: "size-8",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
