# ADR-0022 — Cierre del plan v6: lo que había quedado a medias

**Estado:** aceptada · **Fecha:** 2026-10-11 · Completa los ADR-0018, 0020 y 0021

## Contexto
Al cerrar el plan v6 quedaron cinco cosas hechas solo en parte, anotadas como desviaciones: la vista
cenital era un teleobjetivo, el tope de presupuesto vivía en el navegador, los diálogos y las ayudas
seguían siendo los nativos, el editor era un componente de 700 líneas y las viviendas no tenían
planta conjunta. La página de inicio tampoco llevaba las fotos libres que se habían elegido.

## Decisiones

### Una cámara que cambia de proyección, no dos cámaras
La vista cenital pasa a ser ortográfica de verdad. En vez de añadir una segunda cámara (y enseñar
a usarla a cada pieza del visor: herramientas, tiradores, etiquetas, controles, posprocesado),
`RoomCamera` extiende la de perspectiva y sabe proyectar de las dos formas.

- three decide cómo tratar una cámara por sus banderas `isPerspectiveCamera` e
  `isOrthographicCamera`. `RoomCamera` las cambia junto con la matriz, así que el rayo del cursor,
  el zoom de los controles y la luz especular se comportan bien sin tocar su código.
- Los pases de posprocesado eligen la fórmula de profundidad al crearse: `PostFx` mira la cámara
  antes de cada dibujo y los recompila si cambió.
- El tamaño de los tiradores dependía de la distancia a la cámara, que en ortográfica no significa
  nada: `apparentDistance` da la distancia equivalente.
- **Coste:** es una clase que miente sobre su tipo a propósito. Si una versión de three empieza a
  mirar otra cosa (por ejemplo `camera.type`), habrá que revisarla. Está cubierta por pruebas que
  comprueban el rayo, la proyección y el zoom.

### El tope de presupuesto es un dato del proyecto
`budgetCap` es una columna opcional de `projects`. Se cambia con `PUT /projects/:id/budget` y
**no sube la revisión**: no es parte de la escena, así que ponerlo desde otro dispositivo no
provoca un conflicto al guardar. Va por el puerto `ProjectPersistence`, de modo que la demo sin
cuenta lo guarda en el navegador con el mismo código. Un tope de la versión anterior se sube solo
la primera vez que se abre ese proyecto.

### La planta conjunta guarda solo dónde va cada cuarto
Como preveía el ADR-0021, `homePosition` (`{x, z}` en metros) es otra columna opcional. La planta
de la vivienda se dibuja con lo que ya devuelve la lista de proyectos (el contorno de cada cuarto),
sin pedir cada proyecto entero.

- La lógica es pura y está en `shared-types/home-plan.ts`: colocar en fila lo que aún no tiene
  sitio, pegar los bordes al arrastrar, decir quién comparte pared y quién se pisa.
- El pegado trabaja con la caja que encierra cada cuarto. Un cuarto en L se pega por su caja, no
  por su contorno real: suficiente para ordenar una vivienda, no para comprobar que encaja.
- **PDF de la vivienda:** `GET /projects/:id/home/dossier.pdf` reúne una portada (la planta
  conjunta, lo que suma cada cuarto y su tope) y después las páginas de cada cuarto, las mismas del
  PDF de un proyecto. La planta se coloca con la misma función que usa la web, así que coinciden.
- **Sigue sin hacerse:** puertas compartidas entre cuartos, caminar de uno a otro en 3D, los
  muebles dentro de la planta conjunta y una presentación de la vivienda entera.

### Diálogo y ayuda como piezas base
- `app-dialog` envuelve el `<dialog>` nativo (que ya atrapa el foco y cierra con Escape) y pone lo
  que repetían las cinco ventanas: título que la nombra, botón de cerrar y cierre al pulsar fuera.
- `appTooltip` sustituye al `title` del navegador en la barra del editor y en el visor: sale también
  con el teclado, se anuncia con `aria-describedby` y sigue el tema. El resto de la app conserva
  `title` donde ya lo tenía; cambiarlo es sustituir el atributo.
- `editor.component.ts` se parte en tres: la barra (`editor-toolbar`), el panel (`editor-panel`) y
  el escenario, que se queda en el editor con los avisos, los diálogos y los atajos. La barra y el
  panel piden con salidas lo que es de otra pieza; no se llaman entre sí.

### Fotos libres, solo en la sección de estilos
Seis fotografías CC0 de interiores reales, una por estilo, junto al cuarto que dibuja la app. Se
buscaron con Openverse, filtrando por licencia CC0, y se sirven desde el propio sitio (la CSP no
admite orígenes externos). Fuente y autor de cada una en
`apps/web/public/landing/fotos/ATTRIBUTION.md`. El resto de la página sigue saliendo de la app.

## De paso: cuatro fallos que destapó CI
Al correr por fin Playwright en CI aparecieron fallos que eran de la app, no de las pruebas. Para
verlos sin esperar a GitHub se levantó en local un segundo stack igual al de CI
(`CATALOG_OFFLINE=true docker compose -p interiores-ci up`), y la suite entera pasa contra él.

- **Guardar la demo en la cuenta** se rechazaba entera si un mueble no estaba en el catálogo. Con
  el catálogo sin conexión de CI faltan modelos, así que fallaba siempre; a una persona le pasaría
  lo mismo si se retira un mueble mientras su demo espera en el navegador. Ahora ese mueble se deja
  fuera, se guarda el resto y el aviso lo dice.
- La misma pantalla **cargaba el editor 3D entero** al volver del registro, solo para subir el
  cuarto y salir. Ahora sube directamente lo guardado en el navegador.
- **Los avisos** empezaban a contar sus 4,5 s al pedirse, no al pintarse: si la página estaba
  ocupada rehaciendo el 3D, podían agotarse sin llegar a verse. Ahora cuentan desde que se pintan.
- **La planta de la vivienda** pedía un guardado por pulsación de flecha, todos a la vez: podían
  llegar desordenados y quedar guardado un sitio anterior al último. Ahora van en fila.

## De paso: CI llevaba tiempo en rojo
El trabajo e2e de GitHub Actions fallaba en su primer paso propio desde hacía decenas de commits:
`scripts/init-env.sh` estaba en el repositorio sin permiso de ejecución (en Windows no se nota). El
stack nunca llegaba a levantarse allí, así que Playwright solo se había corrido en local. Se
corrigió el permiso y se añadió el reporter `github`, que deja cada fallo como anotación del commit.

## Consecuencias
- Dos columnas más en `projects`, ambas opcionales (migración `20261011020000_budget_home_plan`).
- Para una ventana nueva: `<app-dialog heading="…">` con `.modal-body` y `.modal-actions` dentro.
- Para una vista nueva del visor basta decidir su proyección antes de colocar la cámara.
