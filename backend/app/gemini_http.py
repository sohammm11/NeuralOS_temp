import requests
import json
import base64
import httpx

class AIMessage:
    def __init__(self, content: str):
        self.content = content

class AIMessageChunk:
    def __init__(self, content: str):
        self.content = content

class HTTPGoogleGenerativeAIEmbeddings:
    def __init__(self, model: str, google_api_key: str, output_dimensionality: int = 768):
        self.model = model
        self.google_api_key = google_api_key
        self.output_dimensionality = output_dimensionality

    def embed_query(self, text: str) -> list:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={self.google_api_key}"
        headers = {"Content-Type": "application/json"}
        payload = {
            "model": "models/gemini-embedding-001",
            "content": {
                "parts": [{"text": text}]
            },
            "outputDimensionality": self.output_dimensionality
        }
        res = requests.post(url, headers=headers, json=payload)
        res.raise_for_status()
        data = res.json()
        return data["embedding"]["values"]

    def embed_documents(self, texts: list) -> list:
        return [self.embed_query(t) for t in texts]


class HTTPChatGoogleGenerativeAI:
    def __init__(self, model: str, google_api_key: str, temperature: float = 0.2, streaming: bool = True):
        self.model = model
        self.google_api_key = google_api_key
        self.temperature = temperature
        self.streaming = streaming

    def invoke(self, prompt: str) -> AIMessage:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.google_api_key}"
        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [
                {
                    "parts": [{"text": prompt}]
                }
            ],
            "generationConfig": {
                "temperature": self.temperature
            }
        }
        res = requests.post(url, headers=headers, json=payload)
        res.raise_for_status()
        data = res.json()
        try:
            content = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            content = "Error: No text generated."
        return AIMessage(content=content)

    async def astream(self, prompt: str):
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:streamGenerateContent?key={self.google_api_key}&alt=sse"
        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [
                {
                    "parts": [{"text": prompt}]
                }
            ],
            "generationConfig": {
                "temperature": self.temperature
            }
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                response.raise_for_status()
                buffer = ""
                async for chunk in response.aiter_bytes():
                    buffer += chunk.decode("utf-8", errors="ignore")
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        if line.startswith("data: "):
                            json_str = line[6:]
                            try:
                                data = json.loads(json_str)
                                text = data["candidates"][0]["content"]["parts"][0]["text"]
                                yield AIMessageChunk(content=text)
                            except Exception:
                                pass


def describe_image_http(image_bytes: bytes, api_key: str) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    image_base64 = base64.b64encode(image_bytes).decode("utf-8")
    
    prompt = """
    Analyze this image carefully.
    
    If it's a chart/graph:
    - Extract chart type, title, all data points
    - Describe trends and insights
    
    If it's a screenshot:
    - Describe what's shown
    - Extract any visible text
    
    If it's a document:
    - Extract all text
    
    Return JSON:
    {
        "type": "chart|screenshot|document|photo",
        "title": "descriptive title",
        "description": "detailed description for search",
        "data": {},
        "insights": []
    }
    """
    
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inlineData": {
                            "mimeType": "image/png",
                            "data": image_base64
                        }
                    }
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    }
    
    res = requests.post(url, headers=headers, json=payload)
    res.raise_for_status()
    data = res.json()
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
        return json.loads(text)
    except Exception as e:
        print(f"[Gemini HTTP Image] Error parsing JSON: {e}")
        return {
            "type": "unknown",
            "title": "Image",
            "description": "Image could not be analyzed",
            "data": {},
            "insights": []
        }
