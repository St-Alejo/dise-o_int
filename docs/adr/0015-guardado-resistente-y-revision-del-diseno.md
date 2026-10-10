# ADR-0015 — Guardado resistente y revisión del diseño

**Estado:** aceptada · **Fecha:** 2026-10-10

## Contexto
El autoguardado funcionaba mientras todo iba bien. Con la red caída mostraba un error y esperaba a
que el usuario pulsara "Reintentar"; si cerraba la pestaña, lo último se perdía. Al poner el
editor bajo carga aparecieron además tres carreras que ya existían y daban conflictos falsos
(409) o dejaban el editor sin refrescar. Por otro lado, la app dejaba armar cuartos imposibles de
usar (un armario delante de la puerta) sin decir nada.

## Decisión
**Guardado**
- **Un guardado a la vez.** `flush()` espera al que está en vuelo antes de seguir: dos envíos con
  la misma revisión chocaban entre sí, y quien llamaba (el asistente, "guardar versión") seguía
  con una revisión vieja.
- **Lo nuevo no se pisa con lo viejo.** Una respuesta del servidor con una revisión anterior a la
  local se descarta; una con la misma revisión no vacía el historial.
- **Reintentos solo cuando sirven.** Los fallos de red o del servidor se reintentan solos con
  espera creciente (2 s … 30 s) y al volver la conexión; un rechazo de los datos (4xx) no, porque
  repetir lo mismo daría el mismo error.
- **Copia local.** Cada edición guarda la escena en el navegador con la revisión sobre la que se
  hizo. Al abrir el proyecto se ofrece recuperarla solo si esa sigue siendo la revisión del
  servidor: si el proyecto cambió después, mezclarlos sería adivinar.
- **Un conflicto se resuelve solo cuando no es de la escena.** Ante un 409 se compara la escena
  del servidor con la última que se conocía: si es la misma (cambió otra cosa), se toma la
  revisión nueva y se reenvía; si no, decide el usuario como antes.
- **Lo que hace el servidor también se deshace.** `CommandHistory.record` anota un cambio ya
  ocurrido ("Otra distribución") sin volver a aplicarlo.

**Revisión del diseño**
- `design-check.ts` (en `shared-types`, pura) revisa el cuarto con la misma física del recorrido
  a pie: se inunda el piso desde la puerta y se mira a qué muebles se llega y cuánto piso queda.
  Si una persona no pasa, es un aviso.
- Tres niveles: problema (fuera del cuarto, puerta bloqueada), atención (mueble inaccesible,
  cuarto muy lleno) y sugerencia (ventana tapada, sin lámparas). Solo los dos primeros cuentan
  para el indicador de la barra.

## Consecuencias
- El borrador vive en el navegador donde se editó: no viaja a otro dispositivo.
- Con cambios pendientes el navegador pregunta antes de cerrar o recargar.
- Los límites de frecuencia por IP son configurables con un multiplicador
  (`RATE_LIMIT_MULTIPLIER`) porque la suite de extremo a extremo sale entera de una sola IP.
- La revisión usa una rejilla de 20 cm: un pasillo de menos de ~50 cm cuenta como cerrado.
- Los avisos son reglas fijas, no un criterio de diseño: dicen lo que estorba, no lo que queda bien.
