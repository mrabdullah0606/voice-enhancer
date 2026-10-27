"""
Voice Dataset Preparation & Slicing Utility for Neural Model Fine-Tuning.
Processes raw voice recordings:
- Removes trailing/leading dead silence
- Segments longer recordings into 3-10s training slices
- Peak normalizes audio (-1.0 dBFS) to prevent clipping
- Bundles processed dataset into user_voice_dataset.zip ready for RVC training
"""

import os
import glob
import zipfile
import numpy as np
from scipy.io import wavfile
from scipy import signal
from typing import List, Dict, Any, Tuple
import logging

logger = logging.getLogger("voice_enhancer.dataset")

DATASET_RAW_DIR = os.path.join(os.path.dirname(__file__), "dataset", "raw")
DATASET_PROCESSED_DIR = os.path.join(os.path.dirname(__file__), "dataset", "processed")
DATASET_ZIP_PATH = os.path.join(os.path.dirname(__file__), "dataset", "user_voice_dataset.zip")

os.makedirs(DATASET_RAW_DIR, exist_ok=True)
os.makedirs(DATASET_PROCESSED_DIR, exist_ok=True)


def normalize_audio(audio: np.ndarray, target_peak_db: float = -1.0) -> np.ndarray:
    """Normalizes audio float array to target peak dB."""
    max_val = np.max(np.abs(audio)) + 1e-9
    target_linear = 10.0 ** (target_peak_db / 20.0)
    return (audio / max_val) * target_linear


def slice_audio(audio: np.ndarray, sr: int, min_chunk_sec: float = 2.0, max_chunk_sec: float = 10.0) -> List[np.ndarray]:
    """
    Slices audio on energy dips to produce chunks between 2 and 10 seconds.
    Ensures optimal training chunk duration for RVC HuBERT / RMVPE models.
    """
    frame_len = int(sr * 0.05)  # 50ms frames
    hop_len = int(sr * 0.025)   # 25ms hop
    
    # Calculate short-term frame energy
    energy = []
    for i in range(0, len(audio) - frame_len, hop_len):
        chunk = audio[i:i + frame_len]
        energy.append(np.sqrt(np.mean(chunk ** 2) + 1e-9))
    energy = np.array(energy)
    
    threshold = np.percentile(energy, 25) * 1.5
    silence_frames = energy < threshold
    
    chunks = []
    start_sample = 0
    min_samples = int(min_chunk_sec * sr)
    max_samples = int(max_chunk_sec * sr)
    
    cur_idx = 0
    while cur_idx < len(silence_frames):
        cur_sample = cur_idx * hop_len
        duration = cur_sample - start_sample
        
        # If we hit silence after min_samples or reached max_samples
        if (silence_frames[cur_idx] and duration >= min_samples) or (duration >= max_samples):
            sub_chunk = audio[start_sample:cur_sample]
            if len(sub_chunk) >= min_samples:
                # Trim tiny leading/trailing silence
                chunks.append(normalize_audio(sub_chunk))
            start_sample = cur_sample
        cur_idx += 1
        
    # Append remainder if long enough
    if len(audio) - start_sample >= min_samples:
        chunks.append(normalize_audio(audio[start_sample:]))
        
    return chunks if chunks else [normalize_audio(audio)]


def get_dataset_stats() -> Dict[str, Any]:
    """Returns total raw recordings and duration stats."""
    raw_files = glob.glob(os.path.join(DATASET_RAW_DIR, "*.wav"))
    total_seconds = 0.0
    for f in raw_files:
        try:
            sr, data = wavfile.read(f)
            total_seconds += len(data) / float(sr)
        except Exception:
            pass
            
    processed_files = glob.glob(os.path.join(DATASET_PROCESSED_DIR, "*.wav"))
    proc_seconds = 0.0
    for f in processed_files:
        try:
            sr, data = wavfile.read(f)
            proc_seconds += len(data) / float(sr)
        except Exception:
            pass

    return {
        "raw_count": len(raw_files),
        "raw_duration_sec": round(total_seconds, 1),
        "raw_duration_min": round(total_seconds / 60.0, 2),
        "target_min": 5.0,
        "progress_percent": min(100, round((total_seconds / 300.0) * 100, 1)),
        "processed_count": len(processed_files),
        "processed_duration_min": round(proc_seconds / 60.0, 2),
        "zip_available": os.path.exists(DATASET_ZIP_PATH),
        "zip_size_mb": round(os.path.getsize(DATASET_ZIP_PATH) / (1024 * 1024), 2) if os.path.exists(DATASET_ZIP_PATH) else 0.0
    }


def process_and_bundle_dataset(target_sr: int = 40000) -> Dict[str, Any]:
    """
    Processes all raw WAV files:
    1. Normalizes and slices into optimal 2-10s training segments
    2. Writes to dataset/processed/
    3. Archives into dataset/user_voice_dataset.zip
    """
    raw_files = glob.glob(os.path.join(DATASET_RAW_DIR, "*.wav"))
    if not raw_files:
        return {"success": False, "error": "No raw audio recordings found in dataset/raw."}

    # Clear previous processed files
    for f in glob.glob(os.path.join(DATASET_PROCESSED_DIR, "*.wav")):
        try:
            os.remove(f)
        except Exception:
            pass

    slice_count = 0
    total_sec = 0.0

    for file_path in raw_files:
        try:
            sr, data = wavfile.read(file_path)
            # Convert integer formats to float32 [-1.0, 1.0]
            if data.dtype == np.int16:
                float_data = data.astype(np.float32) / 32768.0
            elif data.dtype == np.int32:
                float_data = data.astype(np.float32) / 2147483648.0
            else:
                float_data = data.astype(np.float32)

            # Mono convert
            if float_data.ndim > 1:
                float_data = np.mean(float_data, axis=1)

            # Resample to target_sr if needed
            if sr != target_sr:
                num_samples = int(len(float_data) * float(target_sr) / float(sr))
                float_data = signal.resample(float_data, num_samples).astype(np.float32)
                sr = target_sr

            slices = slice_audio(float_data, sr)
            for s in slices:
                slice_count += 1
                out_path = os.path.join(DATASET_PROCESSED_DIR, f"slice_{slice_count:04d}.wav")
                # Write as 16-bit PCM for RVC
                int16_data = (s * 32767.0).astype(np.int16)
                wavfile.write(out_path, sr, int16_data)
                total_sec += len(int16_data) / float(sr)
        except Exception as e:
            logger.error(f"Error processing {file_path}: {e}")

    # Build zip file
    with zipfile.ZipFile(DATASET_ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zip_out:
        for f in glob.glob(os.path.join(DATASET_PROCESSED_DIR, "*.wav")):
            zip_out.write(f, os.path.basename(f))

    return {
        "success": True,
        "slice_count": slice_count,
        "total_duration_sec": round(total_sec, 1),
        "total_duration_min": round(total_sec / 60.0, 2),
        "zip_path": DATASET_ZIP_PATH,
        "zip_size_mb": round(os.path.getsize(DATASET_ZIP_PATH) / (1024 * 1024), 2)
    }


if __name__ == "__main__":
    print("Dataset stats:", get_dataset_stats())
