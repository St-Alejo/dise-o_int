# ADR-0025: Zonas interiores construidas, recorribles y distribuidas (fase 3 del plan v7)

**Estado:** aceptada · **Fecha:** 2026-10-21

## Contexto
La ADR-0023 dio a `RoomShell` sus `zones`: un contorno, `open` y una puerta en un lado. Con eso se
podía describir un baño privado dentro del dormitorio, pero solo se validaba. Faltaba todo lo que
hace que exista:

- verlo en 3D;
- entrar a pie;
- que el motor ponga un inodoro dentro y la cama fuera;
- crearlo sin dibujar un polígono a mano.

## Decisión
- **Los tabiques salen del contorno.** Un lado de zona que no va sobre una pared del cuarto es un
  tabique de 8 cm (`PARTITION_THICKNESS_M`).
  - `partitions()` devuelve los tabiques.
  - `partitionSolids()` devuelve sus tramos macizos: cada tabique menos el vano de su puerta, que
    mide 2,05 m de alto.
  - No hay un `WallSegment` nuevo. La fuente de verdad sigue siendo el contorno, y mover la zona
    mueve los tabiques.
- **3D (`zone-builder.ts`).**
  - Los tabiques van centrados en su línea, con marco y zócalo por ambas caras.
  - La puerta de la zona queda abierta: se entra caminando, y no hace falta animar la hoja.
  - Cada tabique es un `WallInfo` con la normal hacia dentro de la zona. Así el corte tipo maqueta
    lo recorta cuando se mira el baño desde el resto del cuarto.
  - Los acabados de la zona (`finishes.zones[id]`) dan su propio piso, pintado apenas por encima
    del piso del cuarto.
  - La pintura y la baldosa de la zona son una lámina delante de las paredes del cuarto, pero solo
    en el tramo que le toca. Esa lámina vive en el grupo de la pared, y se recorta con ella.
- **Recorrido.** Los tramos macizos son paredes más para `buildWalkWorld`. Por el vano se pasa,
  porque mide 0,7 m y la persona ocupa 0,5. El punto de partida del recorrido nunca queda dentro de
  una zona.
- **Distribución (`services/ai/layout/zones.py`).**
  - Cada zona cerrada se distribuye como un cuarto propio, con su plantilla:
    - baño: la del baño;
    - vestidor: armarios;
    - tocador: `dressing-table`;
    - estudio: escritorio.
  - Sus paredes son el contorno, con los tabiques corridos medio espesor hacia dentro.
  - Lleva su puerta y las ventanas del cuarto que caen en sus lados.
  - El resto del cuarto se distribuye con su plantilla y no puede pisar la zona: se separa 6 cm de
    su contorno. Tampoco puede tapar el paso de 0,9 m delante de su puerta.
  - Dentro de la zona el paso de la puerta mide 0,6 m. Con 0,9 m no cabía la ducha en un baño de
    1,7 m de fondo.
  - La API ofrece el catálogo entero cuando hay zonas, porque un dormitorio necesita piezas de baño.
  - La API también manda `mustHave` del Brief, para lo pedido en el espacio común. Así un tocador
    entra aunque la plantilla del dormitorio no lo traiga.
- **Baño privado en un clic (`zone-presets.ts`).**
  - `cornerZone` elige el rincón más lejano a la puerta del cuarto y prueba medidas de 2,2 × 1,7 m
    a 1,6 × 1,4 m, en las dos orientaciones.
  - El baño no puede comerse más de medio cuarto.
  - La puerta va en el tabique más largo, junto a la esquina de dentro. Así el lado de las paredes
    queda libre para los sanitarios.
  - Hay cuatro tipos de baño: ducha de obra, bañera con mampara, spa en mármol e industrial. Cada
    tipo es un juego de piso, pintura y revestimiento.
  - En la web, "+ Baño privado" es un solo paso de deshacer: cuarto, acabados y quitar lo que no
    estaba fijado dentro. Después pide otra distribución.
- **Reglas nuevas en `validateZones`.** Un tabique no puede acabar sobre una puerta ni sobre una
  ventana del cuarto. Las zonas se corren con el cuarto cuando una edición de paredes lo lleva al
  origen.

## Consecuencias
- Un dormitorio de 5 × 4,5 m con "+ Baño privado" queda con cama, mesitas y armario fuera, y con
  ducha, lavamanos e inodoro dentro. Se ve con baldosa de metro y se recorre cruzando el vano.
- El motor sigue siendo uno solo: una zona es un cuarto más, y en Python no hay geometría nueva de
  tabiques.
- **Límites conocidos:**
  - Mover una pared en la que se apoya una zona deja un hueco o invalida la zona; el error se
    explica y se deshace.
  - Solo hay plantilla de esquina. Una zona "a lo largo de una pared" se puede describir, pero no
    tiene botón propio.
  - Los tabiques no se arrastran en el plano: la zona se quita y se vuelve a añadir.
