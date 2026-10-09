import type { ComponentProps, ReactNode } from "react"
import { cn } from "cn"

// Section header (title + optional description + optional trailing action)
// used by every block of the dashboard and the results page, so they stop
// re-implementing the same heading + subtitle by hand.
function SectionCard({
  title,
  description,
  action,
  icon,
  className,
  children,
  ...props
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
} & Omit<ComponentProps<"section">, "title">) {
  return (
    <section className={cn("flex flex-col gap-3.5", className)} {...props}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-brand-dark">
            {icon}
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export { SectionCard }
