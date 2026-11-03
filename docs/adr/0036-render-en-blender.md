# ADR-0036: Render en Blender como nodo opcional con GPU (plan v10)

**Estado:** aceptada · **Fecha:** 2026-11-02 · **Modifica:** ADR-0034 (dónde se renderiza)

## Contexto
El trazado de rayos del navegador (ADR-0035) es fiel al diseño, pero se sigue notando que es 3D: no
hay bordes biselados, ni luz portal en las ventanas, ni materiales afinados por papel, ni un
denoiser con pases de albedo y normal. Se quiere que cualquier diseño pueda salir con calidad de
revista, renderizado con Blender (Cycles) y visto dentro de la app, sin abrir Blender a mano.
ADR-0034 descartó renderizar en el servidor por tres razones: no hay GPU en Railway, habría que
duplicar materiales y luces, y cada render costaría dinero.

## Decisión
- **Blender es un nodo opcional, no parte obligatoria del despliegue.** Corre en un contenedor
  `blender` (perfil `gpu` de Compose) en una máquina con GPU NVIDIA, que hoy es el PC del autor (RTX
  4070, OptiX). La app funciona igual sin él: el motor "Blender" del estudio se ve deshabilitado y
  explica por qué.
- **La escena viaja como glTF y no se reconstruye a mano.** La web exporta lo mismo que se ve, con
  `GLTFExporter` dentro de `beginStudio`, y marca cada malla con *extras* (`role`, `material`).
  Blender mejora los materiales según ese papel, y los valores salen de tablas puras de
  `shared-types`. Así se elimina la duplicación que temía ADR-0034.
- **Cola propia `render-jobs` (BullMQ).** El `AiWorker` rechaza los tipos de trabajo que no conoce, y
  un render de minutos no debe frenar el análisis de fotos. El nodo Blender (Python + `bullmq`) solo
  lee y escribe en S3 y en la cola.
- **La API sigue siendo dueña del estado.** Un `RenderJobsListener` en el proceso worker escucha los
  `QueueEvents`, pasa el `Render` de `pending` a `ready` o `failed`, publica el avance en el broker
  de progreso y, al arrancar, reconcilia los renders que quedaron pendientes.
- **Cuota y límites.** `BLENDER_RENDERS_PER_DAY` se aplica con `IQuota`, con reembolso si el render
  falla. `RENDER_SCENE_MAX_MB` limita el tamaño del GLB, que se valida por magic bytes (`glTF`). Si
  no hay ningún nodo escuchando, la API responde 503.

## Consecuencias
- En la nube (Railway) no hay render Blender mientras no exista un nodo con GPU. El mismo contenedor
  podrá conectarse más adelante como "nodo de render" a la cola de producción.
- Se añade una imagen pesada (CUDA más Blender 4.2 LTS) que no entra en el E2E de CI. El E2E usa un
  worker falso que contesta en `render-jobs`, y la imagen solo se prueba con un humo en CPU cuando
  cambia `services/blender/**`.
- Junto al PNG se guarda el `.blend`, para quien quiera retocarlo en su Blender. Ambos viven bajo
  `projects/{id}/renders/{rid}.*` y se borran con el render, el proyecto y la retención.
- La foto realista con IA del plan v9 (Fase 2) pasa a ser el ADR-0037.
