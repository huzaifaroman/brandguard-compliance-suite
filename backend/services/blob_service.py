import asyncio
import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Tuple, Optional
from urllib.parse import urlparse, unquote

from PIL import Image
from azure.storage.blob import BlobServiceClient, ContentSettings, generate_blob_sas, BlobSasPermissions

from backend.config import settings

logger = logging.getLogger("backend.services.blob")

_conn_parts: dict = {}


def _parse_connection_string() -> dict:
    global _conn_parts
    if _conn_parts:
        return _conn_parts
    if not settings.azure_blob_connection_string:
        return {}
    try:
        _conn_parts = dict(
            part.split("=", 1)
            for part in settings.azure_blob_connection_string.split(";")
            if "=" in part
        )
    except Exception:
        _conn_parts = {}
    return _conn_parts


def get_sas_url(blob_url: Optional[str], expiry_hours: int = 2) -> Optional[str]:
    if not blob_url or not settings.azure_blob_connection_string:
        return blob_url

    try:
        parts = _parse_connection_string()
        account_name = parts.get("AccountName", "")
        account_key = parts.get("AccountKey", "")
        if not account_name or not account_key:
            return blob_url

        base_url = blob_url.split("?")[0] if "?" in blob_url else blob_url
        parsed = urlparse(base_url)
        path_segments = parsed.path.strip("/").split("/", 1)
        if len(path_segments) < 2:
            return blob_url
        container_name = path_segments[0]
        blob_name = unquote(path_segments[1])

        sas_token = generate_blob_sas(
            account_name=account_name,
            container_name=container_name,
            blob_name=blob_name,
            account_key=account_key,
            permission=BlobSasPermissions(read=True),
            expiry=datetime.now(timezone.utc) + timedelta(hours=expiry_hours),
        )
        return f"{base_url}?{sas_token}"
    except Exception as e:
        logger.warning("SAS URL generation failed: %s", e)
        return blob_url

_blob_client = None


def _get_blob_client():
    global _blob_client
    if _blob_client is None:
        if not settings.azure_blob_connection_string:
            raise RuntimeError("Azure Blob Storage not configured")
        _blob_client = BlobServiceClient.from_connection_string(
            settings.azure_blob_connection_string
        )
    return _blob_client


def _get_image_dimensions(image_bytes: bytes) -> Tuple[int, int]:
    try:
        img = Image.open(io.BytesIO(image_bytes))
        return img.size
    except Exception:
        return 0, 0


async def upload_image(image_bytes: bytes, filename: str) -> Tuple[Optional[str], int, int]:
    width, height = _get_image_dimensions(image_bytes)

    if not settings.azure_blob_connection_string:
        logger.warning("Azure Blob Storage not configured — skipping upload")
        return None, width, height

    try:
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
        content_type = {
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "webp": "image/webp",
            "gif": "image/gif",
        }.get(ext, "image/png")

        blob_client = _get_blob_client()
        container_client = blob_client.get_container_client(settings.azure_blob_container)

        await asyncio.to_thread(
            lambda: container_client.create_container() if not container_client.exists() else None
        )

        blob = container_client.get_blob_client(filename)
        await asyncio.to_thread(
            blob.upload_blob,
            image_bytes,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type),
        )

        blob_url = blob.url
        logger.info("Blob: uploaded %s", filename)
        return blob_url, width, height

    except Exception as e:
        logger.error(f"Azure Blob upload error: {type(e).__name__}: {e}")
        return None, width, height
