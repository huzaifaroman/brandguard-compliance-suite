from typing import Optional
from config import settings


async def analyze_image(image_bytes: bytes) -> dict:
    """
    Analyze image using Azure Vision API 4.0.
    Returns visual signals including captions, tags, OCR text with bounding boxes,
    detected objects with rectangles, and color palette.
    Returns empty signals if Vision is not configured.
    """
    if not settings.azure_vision_endpoint or not settings.azure_vision_key:
        return _empty_signals()

    try:
        from azure.ai.vision.imageanalysis.aio import ImageAnalysisClient
        from azure.ai.vision.imageanalysis.models import VisualFeatures
        from azure.core.credentials import AzureKeyCredential
        import io

        client = ImageAnalysisClient(
            endpoint=settings.azure_vision_endpoint,
            credential=AzureKeyCredential(settings.azure_vision_key),
        )

        result = await client.analyze(
            image_data=image_bytes,
            visual_features=[
                VisualFeatures.CAPTION,
                VisualFeatures.DENSE_CAPTIONS,
                VisualFeatures.TAGS,
                VisualFeatures.OBJECTS,
                VisualFeatures.READ,
                VisualFeatures.COLOR,
            ],
            gender_neutral_caption=True,
        )

        signals = {
            "caption": result.caption.text if result.caption else "",
            "dense_captions": [
                {"text": c.text, "confidence": c.confidence}
                for c in (result.dense_captions.list if result.dense_captions else [])
            ],
            "tags": [
                {"name": t.name, "confidence": t.confidence}
                for t in (result.tags.list if result.tags else [])
            ],
            "objects": [
                {
                    "name": obj.tags[0].name if obj.tags else "unknown",
                    "confidence": obj.tags[0].confidence if obj.tags else 0,
                    "bbox": {
                        "x": obj.bounding_box.x,
                        "y": obj.bounding_box.y,
                        "w": obj.bounding_box.width,
                        "h": obj.bounding_box.height,
                    },
                }
                for obj in (result.objects.list if result.objects else [])
            ],
            "ocr_text": [],
            "dominant_colors": [],
        }

        if result.read and result.read.blocks:
            for block in result.read.blocks:
                for line in block.lines:
                    poly = line.bounding_polygon
                    if poly and len(poly) >= 4:
                        xs = [p.x for p in poly]
                        ys = [p.y for p in poly]
                        x, y = min(xs), min(ys)
                        w = max(xs) - x
                        h = max(ys) - y
                    else:
                        x, y, w, h = 0, 0, 0, 0
                    signals["ocr_text"].append({
                        "text": line.text,
                        "bbox": {"x": x, "y": y, "w": w, "h": h},
                    })

        if result.color:
            signals["dominant_colors"] = result.color.dominant_colors or []

        await client.close()
        return signals

    except Exception as e:
        print(f"Vision API error: {e}")
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
