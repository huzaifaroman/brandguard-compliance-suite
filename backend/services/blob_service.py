import asyncio
import io
import logging
from typing import Tuple, Optional

from PIL import Image
from azure.storage.blob import BlobServiceClient, ContentSettings

from backend.config import settings

logger = logging.getLogger("backend.services.blob")

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
        logger.info(f"Image uploaded to Azure Blob: {filename}")
        return blob_url, width, height

    except Exception as e:
        logger.error(f"Azure Blob upload error: {type(e).__name__}: {e}")
        return None, width, height
