"""
Configuration settings for the Real-Time Voice Enhancement Assistant.
"""

from pydantic import BaseModel
from typing import Optional


class PipelineSettings(BaseModel):
    sample_rate: int = 16000
    chunk_size: int = 1024  # 64ms at 16kHz
    channels: int = 1
    
    # Audio processing toggles & parameters
    bypass: bool = False
    denoise_enabled: bool = True
    denoise_strength: float = 0.90  # 0.0 to 1.0 (strong fan / ambient suppression)
    
    # Noise Gate & Close-Proximity Voice Isolation (Suppresses traffic, fan, other voices)
    gate_enabled: bool = True
    gate_threshold_db: float = -34.0  # -50 dB (sensitive) to -20 dB (strict close-mic only)
    traffic_cut_enabled: bool = True  # High-pass filter (150 Hz) cuts vehicle engines and fan hum
    suppress_far_voices: bool = True  # Attenuate diffuse background chatter and room reverb
    
    # Gain & dynamics
    gain_db: float = 6.0  # dB boost for whispered / low-volume speech
    agc_enabled: bool = True  # Automatic Gain Control
    target_rms: float = 0.15  # Target loudness level
    
    # Articulation & Clarity Enhancement
    articulation_boost: bool = True  # Formant / high-mid boost (2kHz - 4kHz)
    pitch_shift_semitones: float = 0.0  # Pitch adjustment (-12 to +12)
    
    # Routing
    output_device_index: Optional[int] = None
    output_to_virtual_cable: bool = True


DEFAULT_SETTINGS = PipelineSettings()
