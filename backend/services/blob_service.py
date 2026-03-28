from typing import Tuple, Optional
from config import settings


async def upload_image(image_bytes: bytes, filename: str) -> Tuple[Optional[str], int, int]:
    """
    Upload image to Azure Blob Storage.
    Returns (blob_url, width, height).
    Returns (None, 0, 0) if blob storage is not configured.
    """
    if not settings.azure_blob_connection_string:
        return None, 0, 0

    try:
        from azure.storage.blob.aio import BlobServiceClient
        from PIL import Image
        import io

        img = Image.open(io.BytesIO(image_bytes))
        width, height = img.size

        blob_service = BlobServiceClient.from_connection_string(
            settings.azure_blob_connection_string
        )
        container_client = blob_service.get_container_client(settings.azure_blob_container)

        try:
            await container_client.create_container()
        except Exception:
            pass

        blob_client = container_client.get_blob_client(filename)
        await blob_client.upload_blob(image_bytes, overwrite=True)

        blob_url = blob_client.url
        await blob_service.close()

        return blob_url, width, height

    except Exception as e:
        print(f"Blob upload error: {e}")
        return None, 0, 0
