from backend.config import settings


async def analyze_image(image_bytes: bytes) -> dict:
    """
    Analyze image using Azure Vision API 4.0.
    Returns visual signals. Stub until Azure Vision is configured.
    """
    if not settings.azure_vision_endpoint or not settings.azure_vision_key:
        return _empty_signals()

    return _empty_signals()


def _empty_signals() -> dict:
    return {
        "caption": "",
        "dense_captions": [],
        "tags": [],
        "objects": [],
        "ocr_text": [],
        "dominant_colors": [],
    }
