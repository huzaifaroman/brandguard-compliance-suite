import asyncio
import logging

from azure.ai.vision.imageanalysis import ImageAnalysisClient
from azure.ai.vision.imageanalysis.models import VisualFeatures
from azure.core.credentials import AzureKeyCredential
from azure.core.exceptions import HttpResponseError, ServiceRequestError

from backend.config import settings

logger = logging.getLogger("backend.services.vision")

VISION_TIMEOUT_SECONDS = 30
MAX_RETRIES = 2

_client = None


def _get_client() -> ImageAnalysisClient:
    global _client
    if _client is None:
        if not settings.azure_vision_endpoint or not settings.azure_vision_key:
            raise RuntimeError("Azure Vision credentials not configured")
        _client = ImageAnalysisClient(
            endpoint=settings.azure_vision_endpoint,
            credential=AzureKeyCredential(settings.azure_vision_key),
        )
    return _client


async def analyze_image(image_bytes: bytes) -> dict:
    if not settings.azure_vision_endpoint or not settings.azure_vision_key:
        logger.warning("Azure Vision not configured — returning empty signals")
        return _empty_signals()

    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            client = _get_client()

            result = await asyncio.wait_for(
                asyncio.to_thread(
                    client.analyze,
                    image_data=image_bytes,
                    visual_features=[
                        VisualFeatures.CAPTION,
                        VisualFeatures.DENSE_CAPTIONS,
                        VisualFeatures.TAGS,
                        VisualFeatures.OBJECTS,
                        VisualFeatures.READ,
                    ],
                ),
                timeout=VISION_TIMEOUT_SECONDS,
            )

            return _extract_signals(result)

        except asyncio.TimeoutError:
            logger.error(f"Azure Vision timeout on attempt {attempt}/{MAX_RETRIES}")
            last_error = "Request timed out"
        except (HttpResponseError, ServiceRequestError) as e:
            logger.error(f"Azure Vision API error on attempt {attempt}/{MAX_RETRIES}: {type(e).__name__}: {e.message if hasattr(e, 'message') else str(e)}")
            last_error = str(e)
            if hasattr(e, "status_code") and e.status_code in (400, 401, 403, 404):
                break
        except Exception as e:
            logger.error(f"Azure Vision unexpected error on attempt {attempt}/{MAX_RETRIES}: {type(e).__name__}")
            last_error = str(e)
            break

        if attempt < MAX_RETRIES:
            await asyncio.sleep(1.0 * attempt)

    logger.error(f"Azure Vision failed after {MAX_RETRIES} attempts. Last error: {last_error}")
    return _empty_signals()


def _extract_signals(result) -> dict:
    caption = ""
    caption_confidence = 0.0
    if result.caption:
        caption = result.caption.text or ""
        caption_confidence = result.caption.confidence or 0.0

    dense_captions = []
    if result.dense_captions and result.dense_captions.list:
        for dc in result.dense_captions.list:
            entry = {
                "text": dc.text or "",
                "confidence": dc.confidence or 0.0,
            }
            if dc.bounding_box:
                entry["bbox"] = {
                    "x": dc.bounding_box.x,
                    "y": dc.bounding_box.y,
                    "w": dc.bounding_box.width,
                    "h": dc.bounding_box.height,
                }
            dense_captions.append(entry)

    tags = []
    if result.tags and result.tags.list:
        for tag in result.tags.list:
            tags.append({
                "name": tag.name or "",
                "confidence": tag.confidence or 0.0,
            })

    objects_detected = []
    if result.objects and result.objects.list:
        for obj in result.objects.list:
            obj_tags = []
            if obj.tags:
                obj_tags = [{"name": t.name, "confidence": t.confidence} for t in obj.tags]
            entry = {"tags": obj_tags}
            if obj.bounding_box:
                entry["bbox"] = {
                    "x": obj.bounding_box.x,
                    "y": obj.bounding_box.y,
                    "w": obj.bounding_box.width,
                    "h": obj.bounding_box.height,
                }
            objects_detected.append(entry)

    ocr_lines = []
    if result.read and result.read.blocks:
        for block in result.read.blocks:
            if block.lines:
                for line in block.lines:
                    line_entry = {
                        "text": line.text or "",
                        "words": [],
                    }
                    if line.bounding_polygon:
                        line_entry["bounding_polygon"] = [
                            {"x": p.x, "y": p.y} for p in line.bounding_polygon
                        ]
                    if line.words:
                        for word in line.words:
                            word_entry = {
                                "text": word.text or "",
                                "confidence": word.confidence or 0.0,
                            }
                            if word.bounding_polygon:
                                word_entry["bounding_polygon"] = [
                                    {"x": p.x, "y": p.y} for p in word.bounding_polygon
                                ]
                            line_entry["words"].append(word_entry)
                    ocr_lines.append(line_entry)

    return {
        "caption": caption,
        "caption_confidence": caption_confidence,
        "dense_captions": dense_captions,
        "tags": tags,
        "objects": objects_detected,
        "ocr_text": ocr_lines,
    }


def _empty_signals() -> dict:
    return {
        "caption": "",
        "caption_confidence": 0.0,
        "dense_captions": [],
        "tags": [],
        "objects": [],
        "ocr_text": [],
    }
