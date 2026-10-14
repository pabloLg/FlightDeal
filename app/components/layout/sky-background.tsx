/**
 * Cielo animado: la misma animación de siempre (nubes que cruzan la pantalla y
 * el avión que sube y baja), con más nubes para dar profundidad. Se usa en dos
 * lienzos: `.sky` (fondo de toda la app) y `.search-loader` (buscando).
 *
 * Cada nube es una barra redondeada con dos lomos (CSS); la profundidad sale
 * del tamaño, la opacidad y la velocidad de cada capa, no de efectos.
 */
export function SkyBackground() {
  return (
    <div className="sky-layers" aria-hidden="true">
      {/* Capa lejana: pequeñas, pálidas y lentas. */}
      <div className="sky-cloud sky-cloud--far sky-cloud--a" />
      <div className="sky-cloud sky-cloud--far sky-cloud--d" />
      <div className="sky-cloud sky-cloud--far sky-cloud--h" />

      {/* Capa media. */}
      <div className="sky-cloud sky-cloud--mid sky-cloud--b" />
      <div className="sky-cloud sky-cloud--mid sky-cloud--e" />
      <div className="sky-cloud sky-cloud--mid sky-cloud--g" />
      <div className="sky-cloud sky-cloud--mid sky-cloud--i" />

      {/* Capa cercana: grandes, opacas y rápidas. */}
      <div className="sky-cloud sky-cloud--near sky-cloud--c" />
      <div className="sky-cloud sky-cloud--near sky-cloud--f" />
      <div className="sky-cloud sky-cloud--near sky-cloud--j" />

      {/* El avión lejano y el de delante, cada uno a su tamaño. */}
      <div className="sky-plane sky-plane--far">✈</div>
      <div className="sky-plane">✈</div>
    </div>
  );
}
