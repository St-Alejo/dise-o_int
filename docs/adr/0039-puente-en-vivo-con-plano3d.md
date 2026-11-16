# ADR-0039: Puente en vivo con Plano 3D: la casa entra por código y cada app manda en lo suyo

**Estado:** aceptada · **Fecha:** 2026-11-16 · **Relacionada:** ADR-024 de Plano 3D (compartir por código)

## Contexto
Plano 3D (el otro proyecto del curso) convierte un plano en una casa por pisos, con muros,
aberturas y ambientes. Interiores diseña un cuarto con mejor catálogo, acabados PBR, chat con IA y
render en Blender. Se pidió unirlas: hacer la casa en Plano 3D, pasarla a Interiores con un código
y diseñar ahí sus interiores, con los cambios visibles en vivo en las dos apps y sin que se pisen.

## Decisión
- **Quién manda en qué.** Plano 3D es dueño de la arquitectura: niveles, muros, aberturas,
  polígonos de ambientes, columnas y escaleras. Interiores es dueño de los muebles `int_*` y del
  acabado de piso de cada ambiente enlazado. El servidor de Plano 3D lo hace cumplir: su sala en
  vivo rechaza (`reject`) cualquier op de arquitectura que llegue con el rol `interiores`. Aquí,
  `PUT /projects/:id/room` responde 422 (`ARCHITECTURE_IN_PLANO3D`) en un cuarto enlazado.
- **Código → enlace.** `POST /plano3d/links {code}` canjea el código en
  `POST {PLANO3D_API_URL}/api/shares/claim`. Plano 3D devuelve un token de enlace (JWT `typ=link`),
  que se guarda cifrado (AES-256-GCM) en `Plano3dLink` junto con `lastSeq`. Se crea una vivienda
  con un cuarto por ambiente: piso en `plano3d.levelName`, origen en `homePosition` y forma con
  `createPolygonShell`.
- **Mapeo puro y compartido** (`packages/shared-types/src/plano3d-map.ts`), probado en los dos sentidos:
  - Ejes: la `y` de Plano 3D es la `z` de aquí, y `rotationY = -rotation`.
  - Aberturas: `offset` (borde de inicio) pasa a `offsetM` (centro).
  - Ids: el mueble es `int-<roomId>-<placementId>` y su catálogo `int_<itemId>`. El acabado es `int_<materialId>`.
- **En vivo.** Una conexión WebSocket por casa enlazada (`Plano3dService`), con `hello` +
  `last_seq`, ping cada 25 s, reconexión con espera creciente y revocación ante 4401, 4403 o 1008.
  - **De allá para acá:** los lotes de Plano 3D rehacen solo los cuartos tocados (debounce de
    350 ms, se conservan los muebles) y avisan a la web por Socket.IO con `scene-sync`.
  - **De aquí para allá:** al guardar la escena se calcula el diff de muebles y del acabado de piso
    y se manda como ops; se ignoran los lotes propios.
- **Plano 3D muestra lo diseñado aquí** (web y escritorio). Carga el GLB público
  `/api/catalog/:id/model.glb` y pinta el piso con el manifiesto público `/api/textures`; los dos
  tienen CORS.

## Consecuencias
- Verificado de punta a punta con `e2e/scripts/puente-plano3d.mjs` contra las dos apps encendidas:
  una casa de 4 pisos (22 cuartos), el sofá ida y vuelta en unos 550 ms, y el cambio de un muro
  rehace el cuarto en unos 530 ms.
- Si Plano 3D está apagado, el enlace queda «sin conexión»: Interiores sigue funcionando y al
  volver se resincroniza desde `lastSeq` (o con «Sincronizar»).
- Para entrar a Plano 3D desde el contenedor, la API usa `host.docker.internal`. En local, Plano 3D
  debe escuchar en `0.0.0.0`; en Azure, `PLANO3D_API_URL` apunta a su URL pública.
