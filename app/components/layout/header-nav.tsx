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
  
];

export function HeaderNav() {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-white/70 hover:text-brand-dark",
            link.match(pathname) && "bg-white/80 font-semibold text-brand-dark",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
