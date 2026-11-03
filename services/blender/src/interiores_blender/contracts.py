"""Contrato con la API (espejo de `packages/shared-types/src/render/blender.ts`).

El test de contrato valida estos modelos contra el JSON Schema exportado desde zod.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

#: Cola BullMQ del nodo, aparte de la de IA.
RENDER_QUEUE = "render-jobs"
#: Latido del nodo: si caduca, la API deja de ofrecer el motor Blender.
HEARTBEAT_KEY = "render-node:heartbeat"


def cancel_key(render_id: str) -> str:
    """Marca que la API pone cuando borran un render que se está renderizando."""
    return f"render-node:cancel:{render_id}"


class BlenderJob(BaseModel):
    model_config = ConfigDict(extra="ignore")

    renderId: str
    projectId: str
    userId: str
    sceneKey: str
    outputPrefix: str
    #: El BlenderPlan viaja tal cual a render_scene.py, que es quien lo interpreta.
    plan: dict[str, Any]


class BlenderResult(BaseModel):
    imageKey: str
    previewKey: str
    blendKey: str | None
    seconds: float
    device: str


class Heartbeat(BaseModel):
    device: str
    at: str
