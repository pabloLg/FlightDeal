"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

// Same five destinations, now with the alerts and trends modules reachable
// without inventing new routes: both live on the dashboard as sections.
const LINKS = [
  { href: "/dashboard", label: "Descubrir", match: (p: string) => p === "/dashboard" },
  { href: "/dashboard#searches", label: "Mis búsquedas", match: () => false },
  { href: "/dashboard#alerts", label: "Alertas", match: () => false },
  { href: "/dashboard#trends", label: "Tendencias", match: () => false },
  {
    href: "/settings",
    label: "Configuración",
    match: (p: string) => p.startsWith("/settings"),
  },
];

export function HeaderNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal"
      className="order-last flex w-full flex-wrap items-center gap-x-1 gap-y-0.5 md:order-none md:w-auto md:flex-nowrap"
    >
      {LINKS.map((link) => {
        const active = link.match(pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/70 hover:text-brand-dark focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:px-3 sm:text-sm",
              active && "bg-white/80 font-semibold text-brand-dark",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
