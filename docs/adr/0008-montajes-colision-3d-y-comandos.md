# ADR-0008 — Montajes como estrategias, colisión 3D por capas y comandos de personalización

**Estado:** aceptada · **Fecha:** 2026-10-07

## Contexto
Con objetos de pared y de superficie (Fase 2) el editor seguía moviendo todo sobre el piso y validando
colisiones en 2D: un cuadro arrastrado flotaba en medio del cuarto, dos cuadros a distinta altura
"chocaban" y una silla no podía entrar bajo la mesa. Además cada pieza necesita medidas y materiales
propios con deshacer, y el cuarto, acabados.

## Decisión
- **Strategy de montaje** (`viewport-3d/mounts`): `FloorMount`, `CeilingMount`, `WallMount`,
  `SurfaceMount` convierten un rayo del cursor en una pose. Son matemática pura (sin three.js) y se
  prueban sin GPU. La pared marca como bloqueada la pose que tapa una puerta o ventana.
- **Colisión 3D por capas** (`shared-types/collision.ts`): huella (SAT) + rango vertical; capas piso,
  alfombra, techo, pared y superficie; excepción `tucksUnder`/`allowsUnder` (silla bajo la mesa); lo
  apoyado solo choca con lo que está sobre el mismo soporte.
- **Soportes**: lo apoyado guarda `supportId`; mover, girar o empujar el soporte lo arrastra en el mismo
  paso de deshacer (`MacroCommand`); al quitarlo, cae al piso.
- **Comandos**: el historial opera sobre el estado de la escena completo (muebles + acabados).
  `PlacementCommand` (Template Method), `PatchPlacementCommand` (medidas, material, altura, montaje)
  con **fusión** de ediciones continuas en 800 ms (un slider = un paso), `MacroCommand` (Composite),
  `SetFinishesCommand`.
- **Inspector**: medidas dentro de los rangos del catálogo; si en su sitio no cabe, la pieza se mueve al
  hueco libre más cercano y se avisa; solo se rechaza lo imposible (no cabe en el cuarto o bajo el
  techo).
- **Acabados**: piso, paredes (todas o una) y techo; sin acabados propios se usa la paleta del estilo.
- **Lista de compras** por producto y variante (medidas/materiales propios).

## Consecuencias
- Agregar un montaje nuevo (p. ej. "esquina") es otra estrategia con sus pruebas, sin tocar la escena.
- El servidor sigue siendo la defensa en profundidad (acota medidas, resuelve soportes y paredes); el
  cliente no necesita confiar en sí mismo para la persistencia.
- Cambiar las medidas del cuarto aún no se deshace con Ctrl+Z (es una operación del servidor).
