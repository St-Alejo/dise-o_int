# ADR-0012 — Recorrido a pie, modos de cámara y luz del cuarto

**Estado:** aceptada · **Fecha:** 2026-10-10

## Contexto
El cuarto solo se podía mirar desde fuera, orbitando. Para decidir si un mueble estorba o si un
pasillo alcanza hay que estar dentro, a la altura de los ojos. Además todas las escenas tenían la
misma luz plana, viniera de donde viniera la ventana y hubiera o no lámparas.

## Decisión
- **Caminar es lógica pura, fuera de Three.js.** `packages/shared-types/src/walk.ts` modela a la
  persona como un círculo de 25 cm en planta que avanza hacia donde mira, no atraviesa paredes ni
  muebles y se desliza a lo largo de ellos. Vive junto a la geometría del cuarto porque usa la
  misma (polígono de planta, huellas de los muebles) y así se prueba sin navegador.
- **Qué estorba lo decide la altura.** Una alfombra se pisa y una lámpara colgante no molesta: solo
  cuenta lo que queda entre 20 cm y la altura de los ojos.
- **Modos de cámara (State).** `CameraMode` tiene dos estados, `OrbitMode` y `WalkMode`; cada uno
  sabe cómo empieza, qué hace en cada frame y cómo se sale. `CameraDirector` es el contexto: guarda
  el estado activo y, al cambiar, vuela la cámara de una pose a la otra antes de entregarle el
  control al nuevo. Añadir un modo (una vista cenital) es otra clase, sin tocar `SceneService`.
- **Dónde empieza el recorrido.** No en el centro mirando al fondo, que puede dejar a la persona a
  un palmo de un mueble: se puntúa cada punto libre por su holgura y por lo lejos que se ve en su
  mejor dirección.
- **Las paredes se ven enteras desde dentro.** El recorte de paredes que sirve a la órbita se apaga
  al caminar y aparece el techo.
- **Luz por presets (Strategy).** `LIGHTING_PRESETS` define día y noche. Cada lámpara colocada es
  una luz puntual donde está su pantalla (tope de seis, por rendimiento): de noche el cuarto lo
  alumbran sus propias lámparas.
- **También en el enlace público.** Recorrer no edita nada, así que el visitante de un proyecto
  compartido puede hacerlo igual.

## Consecuencias
- El recorrido obliga a dibujar en cada frame mientras hay movimiento; el resto del tiempo el visor
  sigue dibujando solo cuando algo cambia.
- Las puertas están cerradas: se recorre un cuarto, no una casa.
- Sin posprocesado (oclusión ambiental, contorno de selección) ni texturas todavía.
- `window.__scene` expone un resumen de la escena (modo, posición de la cámara, lámparas) para que
  las pruebas de extremo a extremo comprueben el recorrido sin comparar píxeles.
