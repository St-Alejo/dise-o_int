# ADR-0001 — Stack: Angular + NestJS + FastAPI (y no un backend único)

**Estado:** aceptada · **Fecha:** 2026-09-29

## Contexto
El documento de arquitectura pide Angular + NestJS + Python/FastAPI para IA + BullMQ. El
proyecto hermano de planos (`../arquitectura`) terminó colapsando a un backend único en Python.

## Decisión
Se sigue el documento: **NestJS** es el API gateway y dueño del dominio (auth, proyectos,
versiones, catálogo, colas); **FastAPI** es un microservicio *sin estado* solo para IA; el
**worker** es la misma imagen de NestJS con otro entrypoint.

## Consecuencias
- (+) El dominio vive en TypeScript y comparte tipos con la web (`packages/shared-types`).
- (+) La IA escala y se despliega aparte (y podría moverse a GPU sin tocar el dominio).
- (−) Un contrato más entre servicios → se mitiga con el **test de contrato zod ↔ Pydantic**
  (`services/ai/tests/test_contract.py`) sobre el JSON Schema exportado.
- Versiones: Angular 22 y NestJS 12 (ESM) exigen Node ≥ 22.22 → imágenes `node:24-alpine`.
