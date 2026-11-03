"""Configuración del nodo por variables de entorno (las mismas de S3 y Redis que el resto del stack)."""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    redis_url: str = Field(alias="REDIS_URL")

    s3_endpoint: str | None = Field(default=None, alias="S3_ENDPOINT")
    s3_region: str = Field(default="us-east-1", alias="S3_REGION")
    s3_bucket: str = Field(alias="S3_BUCKET")
    s3_access_key_id: str = Field(alias="S3_ACCESS_KEY_ID")
    s3_secret_access_key: str = Field(alias="S3_SECRET_ACCESS_KEY")
    s3_force_path_style: bool = Field(default=True, alias="S3_FORCE_PATH_STYLE")

    blender_bin: str = Field(default="/opt/blender/blender", alias="BLENDER_BIN")
    render_script: Path = Field(default=Path("/app/blender/render_scene.py"), alias="RENDER_SCRIPT")
    work_dir: Path = Field(default=Path("/tmp/renders"), alias="RENDER_WORK_DIR")
    #: Un render final en 4K tarda minutos; más de esto es que algo se colgó.
    render_timeout_s: float = Field(default=1800.0, gt=0, alias="RENDER_TIMEOUT_S")
    #: Lo que el latido anuncia hasta el primer render (después, el dispositivo real de Cycles).
    node_device: str = Field(default="GPU", alias="RENDER_NODE_DEVICE")
    heartbeat_interval_s: float = Field(default=10.0, gt=0, alias="HEARTBEAT_INTERVAL_S")
