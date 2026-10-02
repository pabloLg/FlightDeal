"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const LINKS = [
  { href: "/dashboard", label: "Descubrir", match: (p: string) => p === "/dashboard" },
  {
    href: "/dashboard#searches",
    label: "Mis búsquedas",
    match: () => false,
  },
  {
    href: "/settings",
    label: "Configuración",
    match: (p: string) => p.startsWith("/settings"),
  },
];

export function HeaderNav() {
  const pathname = usePathname();

  return (
    <nav className="order-last flex w-full items-center gap-1 md:order-none md:w-auto">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/70 hover:text-brand-dark sm:px-3 sm:text-sm",
            link.match(pathname) && "bg-white/80 font-semibold text-brand-dark",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
