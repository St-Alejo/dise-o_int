"""Escena de entrada y archivos de salida en S3 (SeaweedFS en local; S3 o R2 en la nube)."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

import boto3
from botocore.config import Config

from .config import Settings


class ObjectStorage(Protocol):
    def download(self, key: str, path: Path) -> None: ...
    def upload(self, path: Path, key: str, content_type: str) -> None: ...


class S3Storage:
    def __init__(self, settings: Settings) -> None:
        self._bucket = settings.s3_bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            config=Config(
                s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"},
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=5,
                read_timeout=60,
            ),
        )

    def download(self, key: str, path: Path) -> None:
        self._client.download_file(self._bucket, key, str(path))

    def upload(self, path: Path, key: str, content_type: str) -> None:
        self._client.upload_file(str(path), self._bucket, key, ExtraArgs={"ContentType": content_type})


class MemoryStorage:
    """Implementación en memoria para tests."""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    def download(self, key: str, path: Path) -> None:
        if key not in self.objects:
            raise FileNotFoundError(key)
        path.write_bytes(self.objects[key][0])

    def upload(self, path: Path, key: str, content_type: str) -> None:
        self.objects[key] = (path.read_bytes(), content_type)
