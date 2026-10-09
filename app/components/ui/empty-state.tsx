import type { ReactNode } from "react"

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "cn";

// Shared empty state. Two copies of the same "we're waiting for your first
// results" block were living in the dashboard, drifting apart; this is now
// the only one.
function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("border-dashed", className)}>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        {icon ? <div className="text-brand/60">{icon}</div> : null}
        <p className="font-semibold text-brand-dark">{title}</p>
        {body ? (
          <p className="max-w-md text-sm text-muted-foreground">{body}</p>
        ) : null}
        {action}
      </CardContent>
    </Card>
  );
}

export { EmptyState };
