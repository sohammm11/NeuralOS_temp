import httpx
import os
from dotenv import load_dotenv
import asyncio
import json

load_dotenv("c:/Users/soham mane/OneDrive/Desktop/neuralos/backend/.env")
api_key = os.getenv("GEMINI_API_KEY")

async def test_stream():
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?key={api_key}&alt=sse"
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{"parts": [{"text": "Hello"}]}],
        "generationConfig": {"temperature": 0.2}
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            print("Status:", response.status_code)
            buffer = ""
            async for chunk in response.aiter_bytes():
                buffer += chunk.decode("utf-8", errors="ignore")
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if not line: continue
                    if line.startswith("data: "):
                        json_str = line[6:]
                        data = json.loads(json_str)
                        text = data["candidates"][0]["content"]["parts"][0]["text"]
                        print(f"TEXT: {text}")

if __name__ == "__main__":
    asyncio.run(test_stream())
