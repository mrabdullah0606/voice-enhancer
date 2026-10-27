import asyncio
import websockets
import json
import numpy as np

async def test_ws():
    uri = "ws://127.0.0.1:8000/ws/audio"
    print(f"Connecting to {uri}...")
    async with websockets.connect(uri) as ws:
        print("Connected!")
        # Send ping
        await ws.send(json.dumps({"type": "ping", "t": 123456}))
        pong = await ws.recv()
        print("Received response:", pong)
        
        # Send a synthetic audio chunk (1024 float32 samples = 64ms at 16kHz)
        audio_chunk = (np.sin(np.linspace(0, 100, 1024)) * 0.1).astype(np.float32)
        await ws.send(audio_chunk.tobytes())
        print("Sent audio chunk (1024 samples)")
        
        # Expect processed binary audio frame
        audio_resp = await ws.recv()
        print(f"Received processed audio bytes: {len(audio_resp)} bytes ({len(audio_resp)//4} float32 samples)")
        
        # Expect telemetry JSON
        telemetry_resp = await ws.recv()
        print("Received telemetry:", telemetry_resp)
        print("ALL WEBSOCKET TESTS PASSED!")

if __name__ == "__main__":
    asyncio.run(test_ws())
