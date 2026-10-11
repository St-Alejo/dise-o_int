# ADR-0018 — Imagen del visor: posprocesado, corte de paredes, luz y calidad adaptativa

**Estado:** aceptada · **Fecha:** 2026-10-11

## Contexto
El visor ya se podía editar entero, pero la imagen se veía plana: sin oclusión en los rincones, con
las paredes cercanas convertidas en un velo translúcido que lavaba los colores y con una luz de
relleno tan alta que apenas había sombra. Además, perder el contexto WebGL obligaba a recargar.

## Decisión
**Posprocesado** (`viewport-3d/scene/post-fx.ts`, cargado con `import()`)
- Oclusión ambiental (GTAO) y contorno del mueble seleccionado y del que está bajo el cursor, con
  los pases que trae three.js. Sin dependencias nuevas y fuera del bundle inicial.
- El contorno se mezcla de forma normal (no aditiva): sobre una pared blanca el aditivo no se ve.
- Los pases que redibujan la escena ignoran las ayudas de edición y las paredes en corte.

**Paredes en corte** (`scene/cutaway.ts`, `room-builder.ts`)
- La pared que queda entre la cámara y el cuarto se dibuja como un murete de 10 cm con tapa, como
  en una maqueta. La pared entera sigue en la escena sin pintarse, así su sombra no cambia al girar.
- Qué pared estorba es una función pura, con pruebas.

**Luz** (`scene/lighting-rig.ts`)
- Tres horas: día, tarde (sol bajo y cálido) y noche. Cada una fija sol, altura, relleno y exposición.
- Las dos ventanas más grandes dan su propia claridad. Menos relleno general: el volumen lo dan la
  sombra y la penumbra.

**Calidad** (`scene/quality.ts`)
- Tres niveles: alta (todo), media (sin oclusión) y baja (sin posprocesado).
- En automático, un gobernador baja un escalón cuando la mediana de diez cuadros seguidos pasa de
  45 ms, y nunca sube solo. Si el navegador dibuja por software, se empieza directamente en baja.
- La persona puede fijar el nivel; se recuerda en el navegador.
- Al volver el contexto WebGL se rehace el entorno y la vista sigue sin recargar.

## Alternativas descartadas
- **Luz de área (`RectAreaLight`) por ventana:** exige tablas LTC que engordan el chunk de three y
  no da sombra. Se usa un foco ancho sin borde, que cuesta menos y se parece lo suficiente.
- **Entorno capturado del propio cuarto (`CubeCamera`):** el reflejo ganaría color real, pero hay que
  rehacerlo con cada cambio y se realimenta con la luz ambiente. Se mantiene `RoomEnvironment`.
- **Texturas PBR descargadas:** unos 10 MB en el repositorio para una mejora menor que la de la luz.
  Los pisos siguen con su textura dibujada, que multiplica el color del material.

## Consecuencias
- Una pared en corte deja "flotando" lo que cuelga de ella (un cuadro, la tele): es coherente con la
  vista de maqueta, pero conviene saberlo.
- Las pruebas e2e corren sin GPU: arrancan en calidad baja. La que comprueba el posprocesado elige
  "Calidad alta" a mano.
- Para añadir un pase: se crea en `PostFx` y, si redibuja la escena, se envuelve con `hideExtras`.
