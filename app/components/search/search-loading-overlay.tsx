import { SkyBackground } from "@/components/layout/sky-background";

export function SearchLoadingOverlay({
  label,
}: {
  label: string | null;
}) {
  return (
    <div
      className="search-loader"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {/* Mismo cielo 8-bit que el fondo: aquí tapa la pantalla. */}
      <SkyBackground />

      <div className="search-loader-text">
        <p className="text-2xl font-extrabold tracking-tight">
          {label ? `Buscando vuelos · ${label}` : "Buscando vuelos…"}
        </p>
        <p className="mt-2 text-sm opacity-80">
          La primera ejecución en frío puede tardar hasta unos 30 s. Los precios
          que ves siguen siendo los últimos observados.
        </p>
      </div>
    </div>
  );
}
