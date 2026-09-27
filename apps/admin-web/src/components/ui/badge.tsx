import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        status:
          "border-slate-200 bg-slate-50 text-slate-700 before:size-1.5 before:rounded-full before:bg-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
        retired:
          "border-zinc-300 bg-zinc-100 text-zinc-600 before:size-1.5 before:rounded-full before:bg-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
        success:
          "border-emerald-200 bg-emerald-50 text-emerald-800 before:size-1.5 before:rounded-full before:bg-emerald-600 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
        inactive:
          "border-rose-200 bg-rose-50 text-rose-800 before:size-1.5 before:rounded-full before:bg-rose-600 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
        info:
          "border-sky-200 bg-sky-50 text-sky-800 before:size-1.5 before:rounded-full before:bg-sky-600 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
        review:
          "border-blue-200 bg-blue-50 text-blue-800 before:size-1.5 before:rounded-full before:bg-blue-600 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
        warning:
          "border-amber-200 bg-amber-50 text-amber-800 before:size-1.5 before:rounded-full before:bg-amber-600 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
        highlight:
          "border-primary/30 bg-primary/10 text-foreground before:size-1.5 before:rounded-full before:bg-primary",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
