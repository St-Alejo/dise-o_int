"""Configuración 12-factor del servicio de IA (variables de entorno validadas al arrancar)."""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    ai_internal_token: str = Field(min_length=16, alias="AI_INTERNAL_TOKEN")

    # Strategy: qué proveedor implementa cada capacidad.
    room_analyzer: Literal["mock", "replicate"] = Field(default="mock", alias="ROOM_ANALYZER")
    style_generator: Literal["mock", "replicate"] = Field(default="mock", alias="STYLE_GENERATOR")

    replicate_api_token: str | None = Field(default=None, alias="REPLICATE_API_TOKEN")
    # "owner/name" (modelo oficial) u "owner/name:version" (versión fija).
    replicate_depth_model: str = Field(default="chenxwh/depth-anything-v2", alias="REPLICATE_DEPTH_MODEL")
    replicate_style_model: str = Field(default="adirik/interior-design", alias="REPLICATE_STYLE_MODEL")
    replicate_timeout_s: float = Field(default=150.0, alias="REPLICATE_TIMEOUT_S")

    s3_endpoint: str | None = Field(default=None, alias="S3_ENDPOINT")
    s3_region: str = Field(default="us-east-1", alias="S3_REGION")
    s3_bucket: str = Field(alias="S3_BUCKET")
    s3_access_key_id: str = Field(alias="S3_ACCESS_KEY_ID")
    s3_secret_access_key: str = Field(alias="S3_SECRET_ACCESS_KEY")
    s3_force_path_style: bool = Field(default=True, alias="S3_FORCE_PATH_STYLE")

    max_image_side: int = Field(default=2048, alias="MAX_IMAGE_SIDE")

    def resolved_room_analyzer(self) -> str:
        """Si se pidió Replicate pero no hay token, se degrada a mock (y se registra)."""
        return self.room_analyzer if self.room_analyzer == "mock" or self.replicate_api_token else "mock"

    def resolved_style_generator(self) -> str:
        return self.style_generator if self.style_generator == "mock" or self.replicate_api_token else "mock"


@lru_cache
def get_settings() -> Settings:
    return Settings()
