"""Acceso a objetos (S3 genérico: SeaweedFS/MinIO en local, AWS S3 o R2 en la nube)."""

from typing import Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from .config import Settings


class ObjectNotFoundError(Exception):
    pass


class ObjectStorage(Protocol):
    def get_bytes(self, key: str) -> bytes: ...
    def put_bytes(self, key: str, data: bytes, content_type: str) -> None: ...
    def ping(self) -> None: ...


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
                read_timeout=30,
            ),
        )

    def get_bytes(self, key: str) -> bytes:
        try:
            obj = self._client.get_object(Bucket=self._bucket, Key=key)
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
                raise ObjectNotFoundError(key) from err
            raise
        data: bytes = obj["Body"].read()
        return data

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)

    def ping(self) -> None:
        self._client.head_bucket(Bucket=self._bucket)


class MemoryStorage:
    """Implementación en memoria para tests."""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    def get_bytes(self, key: str) -> bytes:
        if key not in self.objects:
            raise ObjectNotFoundError(key)
        return self.objects[key][0]

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = (data, content_type)

    def ping(self) -> None:
        return None
