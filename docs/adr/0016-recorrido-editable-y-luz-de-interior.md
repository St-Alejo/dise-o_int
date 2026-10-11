# ADR-0016 — Recorrido editable y luz de interior

**Estado:** aceptada · **Fecha:** 2026-10-10

## Contexto
Recorrer el cuarto a pie era solo mirar: al entrar se soltaba la selección, las herramientas se
apagaban y cualquier arrastre giraba la vista. Para cambiar algo había que salir, editar desde
fuera y volver a entrar. Además, visto desde dentro el cuarto se veía plano: paredes de un solo
tono, muebles que parecían flotar y una mancha quemada en el techo.

## Decisión
**Editar mientras se recorre**
- **Un solo camino para los gestos.** `SceneService` entrega cada gesto a la herramienta activa en
  cualquier modo de cámara. Recorriendo, lo que la herramienta no toma (el vacío) sirve para mirar:
  se agarra un mueble para moverlo y el fondo para girar la vista. No hay un "modo edición" aparte.
- **Todo lo del visor funciona dentro:** gizmo, barra del mueble, paredes, pintar, medir y soltar
  muebles del catálogo.
- **Las teclas de caminar mandan.** W, A, S, D, Q, E y las flechas mueven a la persona (W no
  cambia a "Paredes" ni las flechas empujan el mueble); R, Supr y los atajos con Ctrl siguen
  editando. Escape deshace por capas: herramienta, selección y, al final, el recorrido.
- **Si el cuarto se corre, la persona va con él** (`WalkMode.shiftBy`): mover la pared izquierda o
  la del fondo desplaza el origen del cuarto.

**Luz de interior** (sin posprocesado ni dependencias nuevas)
- **El sol entra por la ventana.** `sunHeading` lo orienta hacia la ventana más grande. Desde fuera
  alumbra alto, como antes; dentro baja y el techo da sombra, así que solo entra por las aberturas.
- **Penumbra de rincones y sombras de contacto.** Texturas dibujadas en canvas (Flyweight):
  una lámina oscura en los bordes de cada pared, una franja en el piso y el techo junto a ella y
  una mancha suave bajo cada mueble apoyado. Es la oclusión ambiental hecha a mano.
- **Cielo en degradado** como fondo panorámico (se ve por las ventanas), borde de sombra suave,
  relieve en las juntas del piso, tela con brillo de pelusa, cuero y cerámica con capa lisa, y
  pantallas de lámpara que se encienden de noche.
- **La luz general baja del techo** al 72 % del alto: pegada a él dejaba una mancha blanca.

## Consecuencias
- Recorriendo no hay vista previa del arrastre "detrás" de la persona: se mueve lo que se ve.
- La penumbra es fija: no cambia con la hora ni con la posición de los muebles.
- Las paredes recortadas de la vista de órbita pierden su penumbra junto con ellas.
- Sigue sin haber oclusión ambiental real ni sombras de las lámparas: su costo en equipos modestos
  no compensa todavía.
- `window.__scene.selectedAt` da la posición en pantalla del mueble seleccionado para que las
  pruebas lo arrastren de verdad.
