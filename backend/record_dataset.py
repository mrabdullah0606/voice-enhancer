"""
Interactive CLI Voice Dataset Recorder.
Allows step-by-step sentence recording directly from the terminal.
"""

import os
import time
import sys
import numpy as np
import sounddevice as sd
from scipy.io import wavfile

from prompts import PHONETIC_PROMPTS
from dataset_prep import DATASET_RAW_DIR, get_dataset_stats, process_and_bundle_dataset

SAMPLE_RATE = 40000  # 40 kHz high-quality for RVC

def record_audio(duration: float = 6.0) -> np.ndarray:
    """Records audio for a given duration in seconds."""
    print(f"🎤 Recording for {duration} seconds... (speak clearly)")
    audio = sd.rec(int(duration * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype='float32')
    sd.wait()
    print("✓ Recording finished!")
    return audio.flatten()

def playback_audio(audio: np.ndarray):
    """Plays audio back through default output."""
    print("🔊 Playing back your recording...")
    sd.play(audio, samplerate=SAMPLE_RATE)
    sd.wait()

def main():
    print("=" * 60)
    print("  VOICE ENHANCER — DATASET RECORDING STUDIO (CLI)")
    print("=" * 60)
    print(f"Goal: Record ~30 to 40 sentences (total ~5-8 minutes).")
    print("Tips: Use your close-proximity microphone. Speak at natural volume.\n")

    stats = get_dataset_stats()
    print(f"Current dataset progress: {stats['raw_count']} samples ({stats['raw_duration_min']} min / {stats['target_min']} min target)\n")

    for i, prompt in enumerate(PHONETIC_PROMPTS, 1):
        print("-" * 60)
        print(f"Prompt {i} of {len(PHONETIC_PROMPTS)}:")
        print(f"  👉 \"{prompt}\"")
        print("-" * 60)

        while True:
            cmd = input("\nPress [Enter] to record (or 's' to skip, 'q' to quit, 'p' to process): ").strip().lower()
            if cmd == 'q':
                print("Exiting recording session.")
                return
            elif cmd == 's':
                print("Skipped.")
                break
            elif cmd == 'p':
                print("Processing recorded dataset...")
                res = process_and_bundle_dataset()
                print("Result:", res)
                return

            # Estimate duration based on word count (minimum 4 seconds)
            est_duration = max(4.0, len(prompt.split()) * 0.55 + 1.2)
            audio = record_audio(est_duration)

            # Playback option
            while True:
                review = input("Options: [Enter] to Accept & Next | 'r' to Re-record | 'p' to Playback: ").strip().lower()
                if review == 'p':
                    playback_audio(audio)
                elif review == 'r':
                    break
                else:
                    # Accept and save
                    save_idx = len(os.listdir(DATASET_RAW_DIR)) + 1
                    filename = os.path.join(DATASET_RAW_DIR, f"prompt_{save_idx:03d}.wav")
                    int16_data = (np.clip(audio, -0.99, 0.99) * 32767.0).astype(np.int16)
                    wavfile.write(filename, SAMPLE_RATE, int16_data)
                    print(f"✓ Saved to {os.path.basename(filename)}")
                    
                    # Update progress
                    cur_stats = get_dataset_stats()
                    print(f"Total recorded: {cur_stats['raw_duration_min']} min ({cur_stats['progress_percent']}% of target)")
                    break
            if review != 'r':
                break

    print("\n" + "=" * 60)
    print("All prompts completed! Processing audio slices...")
    res = process_and_bundle_dataset()
    print(f"✓ Dataset bundled successfully: {res['zip_path']} ({res['zip_size_mb']} MB)")
    print("=" * 60)

if __name__ == "__main__":
    main()
