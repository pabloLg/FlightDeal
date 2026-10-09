import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import type { ComponentProps } from "react"

// One badge for every state in the app: replaced the three ad-hoc pills the
// search cards and deal cards used to carry, which drifted apart in tone and
// border radius.
const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        ok: "bg-savings/10 text-savings",
        warn: "bg-opportunity/10 text-opportunity",
        danger: "bg-destructive/10 text-destructive",
        info: "bg-sky text-brand-dark",
        neutral: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

function Badge({
  className,
  variant = "neutral",
  dot = false,
  title,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      title={title}
      {...props}
    >
      {dot ? (
        // Colour is the only thing the dot adds, so it is hidden from
        // assistive tech: the label carries the state.
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      ) : null}
      {props.children}
    </span>
  )
}

export { Badge, badgeVariants }
