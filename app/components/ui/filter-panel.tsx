import { SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "cn";

// Results filter column. Rendered once (never twice): on desktop it is the
// sticky side column, and the caller puts it first in the source order so on
// mobile it sits above the cards instead of below them, where it used to be
// buried. The form itself comes from the caller so the GET field names stay
// the server's contract.
function FilterPanel({
  children,
  footer,
  className,
  ...props
}: {
  children: ReactNode;
  footer?: ReactNode;
} & Omit<React.ComponentProps<"div">, "children">) {
  return (
    <Card className={cn("h-fit lg:sticky lg:top-20", className)} {...props}>
      <CardHeader className="flex flex-row items-center gap-2">
        <SlidersHorizontal className="size-4 text-brand" aria-hidden />
        <CardTitle className="text-sm">Filtrar y ordenar</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {children}
        {footer}
      </CardContent>
    </Card>
  );
}

export { FilterPanel };
