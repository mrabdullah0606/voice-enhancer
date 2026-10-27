"""
FastAPI Server & Real-Time WebSocket Core for Voice Enhancement Assistant.
Handles:
- Bidirectional low-latency audio streaming via WebSockets
- Audio device enumeration and VB-Cable routing
- Hot-reloading DSP / neural pipeline settings
- Telemetry & performance metrics
"""

import time
import json
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import os

from config import PipelineSettings, DEFAULT_SETTINGS
from audio_processor import audio_processor
from device_manager import device_manager
from prompts import PHONETIC_PROMPTS
import dataset_prep

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("voice_enhancer.server")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Voice Enhancement Assistant Backend...")
    # Initialize devices and start output stream on recommended output if available
    dev_info = device_manager.query_devices()
    rec_out = dev_info.get("recommended_output_index")
    if rec_out is not None:
        logger.info(f"Auto-binding output stream to recommended device index: {rec_out}")
        audio_processor.start_output_stream(rec_out)
    yield
    logger.info("Shutting down Voice Enhancement Assistant Backend...")
    audio_processor.stop_output_stream()

app = FastAPI(title="Voice Enhancement Assistant", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DeviceSelectRequest(BaseModel):
    output_device_index: Optional[int] = None

@app.get("/api/status")
async def get_status():
    """Get active pipeline status, latency, and telemetry."""
    return {
        "status": "online",
        "sample_rate": audio_processor.sample_rate,
        "chunk_size": audio_processor.settings.chunk_size,
        "is_streaming": audio_processor._is_streaming,
        "active_device_index": audio_processor._active_device_index,
        "last_latency_ms": float(audio_processor.last_latency_ms),
        "input_level_db": float(audio_processor.input_level_db),
        "output_level_db": float(audio_processor.output_level_db),
        "is_speaking": bool(audio_processor.is_speaking),
        "settings": audio_processor.settings.model_dump()
    }

@app.get("/api/devices")
async def get_devices():
    """List all system audio input/output devices and detect VB-Cable."""
    return device_manager.query_devices()

@app.post("/api/settings")
async def update_settings(settings: PipelineSettings):
    """Update DSP / pipeline settings dynamically."""
    audio_processor.update_settings(settings)
    return {"status": "updated", "settings": audio_processor.settings.model_dump()}

@app.post("/api/stream/start")
async def start_stream(req: DeviceSelectRequest):
    """Start output audio stream to a specific sound card / VB-Cable."""
    audio_processor.start_output_stream(req.output_device_index)
    return {
        "status": "started",
        "device_index": audio_processor._active_device_index,
        "is_streaming": audio_processor._is_streaming
    }

@app.post("/api/stream/stop")
async def stop_stream():
    """Stop the audio output stream."""
    audio_processor.stop_output_stream()
    return {"status": "stopped", "is_streaming": False}

# ==================== DATASET & MODEL PROFILE ENDPOINTS ====================

@app.get("/api/dataset/prompts")
async def get_dataset_prompts():
    """Return the curated list of phonetically balanced training sentences."""
    return {"prompts": PHONETIC_PROMPTS, "total": len(PHONETIC_PROMPTS)}

@app.get("/api/dataset/stats")
async def get_dataset_stats_endpoint():
    """Return stats on recorded voice samples and dataset progress."""
    return dataset_prep.get_dataset_stats()

@app.post("/api/dataset/upload")
async def upload_audio_sample(file: UploadFile = File(...)):
    """Upload a recorded audio WAV sample from the browser."""
    try:
        content = await file.read()
        cur_files = [f for f in os.listdir(dataset_prep.DATASET_RAW_DIR) if f.endswith(".wav")]
        save_name = f"sample_{len(cur_files) + 1:03d}.wav"
        save_path = os.path.join(dataset_prep.DATASET_RAW_DIR, save_name)
        with open(save_path, "wb") as f_out:
            f_out.write(content)
        stats = dataset_prep.get_dataset_stats()
        return {"success": True, "saved_as": save_name, "stats": stats}
    except Exception as e:
        logger.error(f"Error saving dataset sample: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/dataset/process")
async def process_dataset_endpoint():
    """Run slicing, peak normalization, and bundle into user_voice_dataset.zip."""
    res = dataset_prep.process_and_bundle_dataset()
    return res

@app.get("/api/dataset/download_zip")
async def download_dataset_zip():
    """Download the bundled user_voice_dataset.zip for Google Colab training."""
    if not os.path.exists(dataset_prep.DATASET_ZIP_PATH):
        raise HTTPException(status_code=404, detail="Dataset zip not found. Please record and process samples first.")
    return FileResponse(
        dataset_prep.DATASET_ZIP_PATH,
        media_type="application/zip",
        filename="user_voice_dataset.zip"
    )

@app.websocket("/ws/audio")
async def websocket_audio_endpoint(websocket: WebSocket):
    """
    High-speed binary WebSocket endpoint for real-time audio chunk processing.
    Accepts:
      - Raw binary float32 PCM chunks (from Web Audio API AudioWorklet)
      - JSON control messages (e.g., {"type": "ping", "t": 123456})
    Returns:
      - Processed binary float32 PCM chunks (for monitoring / Web Audio output)
      - JSON telemetry headers
    """
    await websocket.accept()
    logger.info("Client connected to audio WebSocket")
    
    try:
        while True:
            message = await websocket.receive()
            
            # Binary frame = raw PCM audio chunk
            if "bytes" in message and message["bytes"]:
                raw_bytes = message["bytes"]
                t0 = time.perf_counter()
                
                # Process audio chunk through DSP pipeline
                out_chunk, telemetry = audio_processor.process_chunk(raw_bytes)
                
                t_total = (time.perf_counter() - t0) * 1000.0
                telemetry["roundtrip_proc_ms"] = round(t_total, 2)
                
                # Send back processed binary audio
                await websocket.send_bytes(out_chunk.tobytes())
                
                # Send occasional telemetry stats (or whenever voice active)
                await websocket.send_text(json.dumps({
                    "type": "telemetry",
                    "data": telemetry
                }))
                
            # Text frame = JSON control message
            elif "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                    if payload.get("type") == "ping":
                        await websocket.send_text(json.dumps({
                            "type": "pong",
                            "client_t": payload.get("t"),
                            "server_t": time.time()
                        }))
                    elif payload.get("type") == "update_settings":
                        new_settings = PipelineSettings(**payload.get("settings", {}))
                        audio_processor.update_settings(new_settings)
                        await websocket.send_text(json.dumps({
                            "type": "settings_updated",
                            "settings": audio_processor.settings.model_dump()
                        }))
                except Exception as json_err:
                    logger.warning(f"Error handling control message: {json_err}")
                    
    except WebSocketDisconnect:
        logger.info("Client disconnected from audio WebSocket")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
