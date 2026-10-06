# ADR-0004 — Privacidad y retención de fotos

**Estado:** aceptada · **Fecha:** 2026-09-29

## Decisión
- La foto se re-codifica con sharp: se **eliminan EXIF/GPS** y se limita a 2048 px.
- Todo lo de un proyecto vive bajo `projects/<id>/` en S3 → borrado real por prefijo.
- Un proyecto nuevo no está "guardado"; si no se guarda una versión ni se comparte, un job
  repetible de BullMQ lo **borra a las 24 h** (`RETENTION_HOURS`), S3 primero y luego la BD.
- Los medios privados se sirven con URLs firmadas HMAC de vida corta; el bucket nunca es público.
- Las fotos no se usan para entrenar modelos.
