import config
import audio_processor
import device_manager
import main
import numpy as np

print("Imports all succeeded!")
devices = device_manager.device_manager.query_devices()
print(f"Device query: {len(devices['inputs'])} inputs, {len(devices['outputs'])} outputs")

# Test audio processing on a dummy 1024-sample chunk
test_chunk = np.random.uniform(-0.1, 0.1, 1024).astype(np.float32)
out_chunk, telemetry = audio_processor.audio_processor.process_chunk(test_chunk)
print("Pipeline telemetry:", telemetry)
print(f"Output shape: {out_chunk.shape}, Latency: {telemetry['latency_ms']}ms")
print("SUCCESS: Core audio engine operational!")
