import { cn } from "cn";

import type { ReactNode } from "react";

// A price with the currency it was quoted in. The currency is never assumed:
// each flight_options row carries its own, and comparing amounts across
// currencies is not something this app does.
function PriceTag({
  price,
  currency,
  meta,
  size = "md",
  className,
}: {
  price: number;
  currency: string;
  meta?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const amount = Number.isFinite(price) ? price.toFixed(size === "lg" ? 0 : 2) : "—";
  return (
    <div className={cn("flex flex-col", className)}>
      <span
        className={cn(
          "font-extrabold tracking-tight text-ink tabular-nums",
          size === "lg" && "text-4xl",
          size === "md" && "text-2xl",
          size === "sm" && "text-base",
        )}
      >
        {amount}{" "}
        <span
          className={cn(
            "font-bold text-muted-foreground",
            size === "lg" && "text-2xl",
            size === "md" && "text-base",
            size === "sm" && "text-sm",
          )}
        >
          {currency}
        </span>
      </span>
      {meta ? (
        <span className="text-xs text-muted-foreground">{meta}</span>
      ) : null}
    </div>
  );
}

export { PriceTag };
