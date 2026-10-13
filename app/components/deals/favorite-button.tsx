"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";

import { cn } from "cn";
import { toggleFavorite } from "@/app/actions/favorites";
import { useToast } from "@/components/ui/toast";

// Heart toggle for one offer. The list reorders favorites first after the
// server confirms, so we keep the optimistic state and reconcile with the
// response, reverting on error.
export function FavoriteButton({
  optionId,
  initialFavorited,
}: {
  optionId: string;
  initialFavorited: boolean;
}) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { show } = useToast();

  const onClick = () => {
    const next = !favorited;
    setFavorited(next);
    startTransition(async () => {
      const res = await toggleFavorite(optionId);
      if (res.error) {
        setFavorited(!next);
        show(res.error);
        return;
      }
      setFavorited(res.favorited);
      show(res.favorited ? "Añadido a favoritos" : "Quitado de favoritos");
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      aria-pressed={favorited}
      aria-label={favorited ? "Quitar de favoritos" : "Añadir a favoritos"}
      title={favorited ? "Quitar de favoritos" : "Añadir a favoritos"}
      disabled={pending}
      onClick={onClick}
      className={cn(
        "grid size-12 place-items-center rounded-full border transition-colors disabled:opacity-60",
        favorited
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-sky text-brand-dark hover:bg-sky-2",
      )}
    >
      <Heart className="size-5" fill={favorited ? "currentColor" : "none"} aria-hidden />
    </button>
  );
}
