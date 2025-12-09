"""FastAPI server for real-time TTS streaming."""
import asyncio
import time
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from tts_engine import get_voices, synthesize_stream

app = FastAPI(title="Real-Time TTS Player")

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

@app.get("/api/voices")
async def list_voices():
    """Get available TTS voices."""
    voices = await get_voices()
    return {"voices": voices}

@app.websocket("/ws/tts")
async def tts_websocket(websocket: WebSocket):
    """WebSocket endpoint for real-time TTS streaming."""
    await websocket.accept()
    
    try:
        while True:
            # Receive text to synthesize
            data = await websocket.receive_json()
            text = data.get("text", "")
            voice = data.get("voice", "en-US-AriaNeural")
            rate = data.get("rate", "+0%")
            
            if not text.strip():
                await websocket.send_json({"type": "error", "message": "Empty text"})
                continue
            
            # Send start marker with timestamp
            start_time = time.time() * 1000
            await websocket.send_json({"type": "start", "timestamp": start_time})
            
            chunk_count = 0
            total_bytes = 0
            
            # Stream audio chunks
            async for chunk in synthesize_stream(text, voice, rate):
                chunk_count += 1
                total_bytes += len(chunk)
                
                # Send binary audio chunk
                await websocket.send_bytes(chunk)
            
            # Send end marker with stats
            end_time = time.time() * 1000
            await websocket.send_json({
                "type": "end",
                "chunks": chunk_count,
                "bytes": total_bytes,
                "duration_ms": round(end_time - start_time)
            })
            
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
