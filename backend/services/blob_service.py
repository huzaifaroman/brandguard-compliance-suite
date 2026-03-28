from typing import Tuple, Optional
from backend.config import settings


async def upload_image(image_bytes: bytes, filename: str) -> Tuple[Optional[str], int, int]:
    """
    Upload image to Azure Blob Storage.
    Returns (blob_url, width, height).
    Stub: returns (None, 0, 0) until Azure Blob is configured.
    """
    if not settings.azure_blob_connection_string:
        from PIL import Image
        import io
        try:
            img = Image.open(io.BytesIO(image_bytes))
            width, height = img.size
        except Exception:
            width, height = 0, 0
        return None, width, height

    return None, 0, 0
