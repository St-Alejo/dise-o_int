# ADR-0019 — Decoración automática, demo sin registro y plantillas

**Estado:** aceptada · **Fecha:** 2026-10-11

## Contexto
Los cuartos generados salían casi vacíos: el motor de distribución solo coloca piezas de piso y de
techo, y con foto se limitaba a lo imprescindible y lo que se vio. Y para ver el editor había que
crear una cuenta, lo que deja fuera a quien solo quiere probar.

## Decisión
**Decoración** (`shared-types/src/decorate.ts`)
- Una pasada pura, después del motor: cortinas a la medida de cada ventana, cuadro sobre la cama o
  el sofá, la tele sobre su mueble, alacenas sobre la hilera de la cocina, espejo sobre el
  lavamanos, repisa sobre el escritorio y lámparas, plantas y libros sobre las tapas planas.
- Vive en TypeScript y no en el servicio de IA porque la convención de dónde queda algo colgado
  (`positionOnWall`, el giro de cada pared) ya está aquí: duplicarla en Python era invitar a que
  divergieran. El pipeline la aplica tras `placeFurniture`, también en "Otra distribución".
- Nada ocupa piso, así que no puede estropear la distribución ni bloquear el paso.
- En el motor (Python), con inventario de la foto se añaden los roles de ambiente: alfombra,
  lámpara de techo, de pie y una planta.
- `photoInventory` (columna opcional) guarda lo reconocido: "Otra distribución" recoloca eso.

**Demo sin registro**
- Puerto `ProjectPersistence` (Strategy) entre el editor y dónde vive el proyecto: `ApiPersistence`
  con cuenta, `LocalPersistence` (este navegador) en `/demo/:plantilla`.
- `POST /projects/import` convierte la demo en proyecto propio, con las mismas validaciones que una
  escena guardada. Si no hay sesión, se pasa por el registro y se vuelve con `?guardar=1`.
- En modo demo el editor oculta lo que necesita servidor: el asistente y "Otra distribución".

**Plantillas** (`shared-types/src/furnished-templates.ts`, `apps/web/public/escenas/`)
- Seis cuartos generados con el motor real. La ficha está en el código; la escena, en un JSON que se
  carga al abrirla, para no engordar el bundle.
- `e2e/scripts/make-templates.mjs` las regenera; una prueba comprueba que cada una cumple el
  contrato y otra que solo usa muebles que existen en el catálogo.

## Consecuencias
- Cambiar el catálogo o las reglas puede dejar una plantilla desfasada: las pruebas avisan y el
  script la rehace.
- La demo no tiene versiones, compartir ni chat: son del servidor. El aviso de la página lo dice.
- La carpeta estática se llama `escenas` y no `plantillas` porque nginx sirve una carpeta antes que
  la ruta de la SPA del mismo nombre.
