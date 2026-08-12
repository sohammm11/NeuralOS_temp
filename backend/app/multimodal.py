import io
import json
from app.gemini_http import describe_image_http
import app.config as config

def describe_image(image_bytes: bytes) -> dict:
    """Analyze an image and extract structured information."""
    return describe_image_http(image_bytes, config.GEMINI_API_KEY)


def is_chart(description: dict) -> bool:
    """Check if the image is a chart/graph."""
    return description.get("type") == "chart"


def format_for_search(description: dict) -> str:
    """Convert image analysis to searchable text."""
    
    parts = [description.get("title", "")]
    parts.append(description.get("description", ""))
    
    data = description.get("data", {})
    if data:
        parts.append("Data: " + json.dumps(data))
    
    insights = description.get("insights", [])
    if insights:
        parts.append("Insights: " + " ".join(insights))
    
    return "\n".join(parts)
