# ADR-0028: Modo Pro y ficha técnica del proyecto (fase 0 del plan v8)

**Estado:** aceptada · **Fecha:** 2026-11-01

## Contexto
Hasta la v7 la app servía a quien diseña su propio cuarto. El usuario pidió que también sirva a
arquitectos y diseñadores: planos técnicos, normativa, cantidades de obra e instalaciones. Eso
necesita datos que la escena no tiene (grosor de muros, cajetín, escala, tarifas, puntos de
instalación) y herramientas que a quien no es profesional le estorban.

## Decisión
- **Modo Pro como preferencia de la cuenta** (`users.proMode`, `PATCH /auth/me`). Se activa con
  el botón "Modo Pro" de la cabecera y vale en cualquier equipo. Sin activarlo no aparece nada
  nuevo: la pestaña **Pro** del editor solo existe con el modo encendido y fuera de la demo.
- **Ficha técnica por proyecto** (`projects.technical`, `PUT /projects/:id/technical`), validada
  con `TechnicalSpecSchema` (`packages/shared-types/src/pro/technical.ts`). Cada bloque (muros,
  cajetín, láminas, revisión técnica, tarifas con AIU, instalaciones) se completa con valores por
  defecto, así una ficha vieja o parcial siempre se lee entera; `null` = ficha por defecto.
- **No cambia la revisión de la escena**, igual que el Brief: se guarda aparte, se ve al momento y,
  si falla, vuelve al valor anterior. No pasa por `CommandHistory` (el plan decía
  `SetTechnicalCommand`): son datos de obra, no gestos de diseño, y deshacerlos con Ctrl+Z
  mezclaría dos historias distintas.
- **Privacidad:** la ficha lleva datos del cliente (nombre, dirección); no sale en el enlace
  público (`PublicProjectSchema` la omite) y sí se copia al duplicar.
- **Muros con grosor hacia fuera** (`pro/walls-2d.ts`): las paredes del modelo son la cara
  interior, así el área útil y todo lo colocado no cambian. Las esquinas exteriores se cortan en
  inglete (con límite para ángulos agudos) y los vanos parten el muro en tramos. Los tabiques de
  zona van centrados en su línea. El 3D usa el mismo grosor por pared cuando el proyecto tiene
  ficha; sin ficha sigue con los 12 cm de siempre.
- **Lógica pura en `shared-types/pro`** para que la web, la API (PDF/DXF) y las pruebas usen la
  misma geometría.

## Consecuencias
- Una migración aditiva (`20261101000000_pro_mode`); los proyectos y cuentas existentes no cambian.
- Las fases siguientes (planos, normativa, cantidades, instalaciones) leen todo de la ficha.
- Un proyecto sin ficha y uno con la ficha por defecto se dibujan distinto en 3D (12 vs 15 cm):
  se acepta para no alterar los proyectos de quien nunca usa el Modo Pro.
