"""
Real-time Audio Processing Engine with Deep Noise Suppression & Voice Isolation.
Features:
- Steep 135Hz 4th-order vehicle/engine/traffic rumble cut
- Close-proximity Voice Isolation Gate (suppresses distant chatter and passing vehicles)
- Adaptive multi-band spectral subtraction & speech presence enhancement
- Formant clarity enhancement (2.8 kHz consonant presence)
- Gated AGC (only boosts the user's close voice, never amplifies background sounds)
- Soft-knee peak limiting
- Real-time ring-buffered streaming output to VB-Audio Cable or headphones
- Live telemetry (latency, RMS, peak, VAD, gate status)
"""

import time
import math
import numpy as np
from scipy import signal
from typing import Optional, Tuple, Dict, Any
import logging
import threading
import queue

from config import PipelineSettings, DEFAULT_SETTINGS

logger = logging.getLogger("voice_enhancer.audio")

class AudioProcessor:
    def __init__(self, settings: Optional[PipelineSettings] = None):
        self.settings: PipelineSettings = settings or DEFAULT_SETTINGS
        self.sample_rate = self.settings.sample_rate
        
        # Internal state for smooth streaming
        self._prev_rms: float = 0.05
        self._noise_floor: Optional[np.ndarray] = None
        self._smooth_spectral_gain: Optional[np.ndarray] = None
        
        # Gate envelope follower
        self._gate_gain: float = 0.0
        self._gate_hold_counter: int = 0
        
        # Audio filters setup
        self._setup_filters()
        
        # Output streaming state
        self._out_stream = None
        self._output_queue = queue.Queue(maxsize=120)  # ~3 seconds max buffer
        self._stream_lock = threading.Lock()
        self._is_streaming = False
        self._active_device_index: Optional[int] = self.settings.output_device_index
        
        # Telemetry
        self.last_latency_ms: float = 0.0
        self.input_level_db: float = -60.0
        self.output_level_db: float = -60.0
        self.is_speaking: bool = False
        self.is_gate_open: bool = False

    def _setup_filters(self):
        """Pre-compute biquad filter coefficients for traffic/fan cut and articulation."""
        nyquist = self.sample_rate / 2.0
        
        # 1. 4th-order Butterworth High-Pass at 150 Hz (Fan motor hum, vehicle rumble, desk thumps cut)
        b_hp, a_hp = signal.butter(4, 150.0 / nyquist, btype='highpass')
        self._traffic_hp_filter = (b_hp, a_hp)
        self._traffic_hp_state = signal.lfilter_zi(b_hp, a_hp)
        
        # 2. Peaking EQ at 2800 Hz (speech articulation & clarity presence)
        center_freq = 2800.0 / nyquist
        bw = 1200.0 / nyquist
        low = max(0.01, center_freq - bw / 2.0)
        high = min(0.99, center_freq + bw / 2.0)
        b_bp, a_bp = signal.butter(2, [low, high], btype='bandpass')
        self._clarity_filter = (b_bp, a_bp)
        self._clarity_state = signal.lfilter_zi(b_bp, a_bp)

    def start_output_stream(self, device_index: Optional[int] = None):
        """Starts real-time sounddevice output stream into VB-Cable or speakers."""
        try:
            import sounddevice as sd
            with self._stream_lock:
                if self._out_stream is not None:
                    try:
                        self._out_stream.stop()
                        self._out_stream.close()
                    except Exception:
                        pass
                
                self._active_device_index = device_index
                
                def audio_callback(outdata, frames, time_info, status):
                    try:
                        data = self._output_queue.get_nowait()
                        if len(data) < frames:
                            padded = np.zeros(frames, dtype=np.float32)
                            padded[:len(data)] = data
                            outdata[:] = padded.reshape(-1, 1)
                        else:
                            outdata[:] = data[:frames].reshape(-1, 1)
                    except queue.Empty:
                        outdata.fill(0.0)

                self._out_stream = sd.OutputStream(
                    samplerate=self.sample_rate,
                    channels=1,
                    dtype='float32',
                    blocksize=self.settings.chunk_size,
                    device=device_index,
                    callback=audio_callback,
                    latency='low'
                )
                self._out_stream.start()
                self._is_streaming = True
                logger.info(f"Started audio output stream on device: {device_index}")
        except Exception as e:
            logger.error(f"Failed to start output audio stream on device {device_index}: {e}")
            self._is_streaming = False

    def stop_output_stream(self):
        """Stops the audio output stream."""
        with self._stream_lock:
            if self._out_stream is not None:
                try:
                    self._out_stream.stop()
                    self._out_stream.close()
                except Exception:
                    pass
                self._out_stream = None
            self._is_streaming = False

    def update_settings(self, new_settings: PipelineSettings):
        """Hot-updates settings without interrupting audio stream."""
        old_device = self._active_device_index
        self.settings = new_settings
        if new_settings.output_device_index != old_device:
            self.start_output_stream(new_settings.output_device_index)

    def _apply_traffic_and_rumble_cut(self, chunk: np.ndarray) -> np.ndarray:
        """Strips fan motor drone, road vibration, subways, and low-frequency rumbling (<150Hz)."""
        if not self.settings.traffic_cut_enabled:
            return chunk
        b_hp, a_hp = self._traffic_hp_filter
        filtered, self._traffic_hp_state = signal.lfilter(b_hp, a_hp, chunk, zi=self._traffic_hp_state)
        return filtered.astype(np.float32)

    def _denoise_chunk(self, chunk: np.ndarray) -> np.ndarray:
        """
        Continuous Minimum-Statistics Spectral Subtractor:
        Dynamically models and suppresses stationary fan noise, AC hum, and laptop cooler hiss
        without distorting the primary voice.
        """
        if not self.settings.denoise_enabled or self.settings.denoise_strength <= 0.01:
            return chunk
            
        strength = float(self.settings.denoise_strength)
        
        # Real FFT of chunk
        spectrum = np.fft.rfft(chunk)
        magnitude = np.abs(spectrum)
        phase = np.angle(spectrum)
        
        # Initialize or recursively track background noise floor
        if self._noise_floor is None or len(self._noise_floor) != len(magnitude):
            self._noise_floor = magnitude.copy()
            self._smooth_spectral_gain = np.ones_like(magnitude)
        else:
            # Asymmetric leaky integrator:
            # - Rapidly tracks down to lower energy during pauses/unvoiced moments (factor 0.20)
            # - Very slowly creeps up during speech (factor 0.002) so speech peaks don't raise noise floor
            is_lower = magnitude < self._noise_floor
            self._noise_floor[is_lower] = 0.80 * self._noise_floor[is_lower] + 0.20 * magnitude[is_lower]
            self._noise_floor[~is_lower] = 0.998 * self._noise_floor[~is_lower] + 0.002 * magnitude[~is_lower]

        # Calculate localized SNR per bin
        snr = magnitude / (self._noise_floor + 1e-7)
        
        # Over-subtraction factor scales with user strength slider (1.5 to 3.8x)
        alpha = 1.5 + (strength * 2.3)
        # Spectral floor (down to -36 dB) prevents musical artifacting while removing all whoosh
        beta = max(0.015, 0.08 * (1.0 - strength))
        
        # Gain computation
        raw_gain = np.clip(1.0 - (alpha / (snr + 1e-6)), beta, 1.0)
        
        # Smooth gain across frames to eliminate fluttering
        if self._smooth_spectral_gain is None:
            self._smooth_spectral_gain = raw_gain
        else:
            self._smooth_spectral_gain = 0.55 * self._smooth_spectral_gain + 0.45 * raw_gain
            
        clean_mag = magnitude * self._smooth_spectral_gain
        clean_fft = clean_mag * np.exp(1j * phase)
        cleaned = np.fft.irfft(clean_fft, n=len(chunk))
        return cleaned.astype(np.float32)

    def _apply_proximity_voice_gate(self, chunk: np.ndarray, current_db: float) -> Tuple[np.ndarray, bool]:
        """
        Close-Proximity Voice Expander / Gate:
        Suppresses distant chatter, fan residual, and room noise below threshold.
        """
        if not self.settings.gate_enabled:
            return chunk, True

        thresh_db = float(self.settings.gate_threshold_db)
        is_above_thresh = current_db > thresh_db

        chunk_frames = len(chunk)
        hold_frames = int(0.14 * (self.sample_rate / chunk_frames))  # ~140ms hold
        
        if is_above_thresh:
            target_gain = 1.0
            self._gate_hold_counter = hold_frames
        else:
            if self._gate_hold_counter > 0:
                self._gate_hold_counter -= 1
                target_gain = 1.0
            else:
                target_gain = 0.0  # Completely mute residual noise when not speaking

        # Fast attack (4ms), smooth release
        rate = 0.85 if target_gain > self._gate_gain else 0.35
        self._gate_gain = (1.0 - rate) * self._gate_gain + rate * target_gain
        self.is_gate_open = bool(self._gate_gain > 0.05)

        gated = chunk * self._gate_gain
        return gated.astype(np.float32), self.is_gate_open

    def _apply_articulation_boost(self, chunk: np.ndarray) -> np.ndarray:
        """Boosts vocal clarity formants (2.8 kHz) for consonant intelligibility."""
        if not self.settings.articulation_boost:
            return chunk
            
        b_bp, a_bp = self._clarity_filter
        clarity_band, self._clarity_state = signal.lfilter(b_bp, a_bp, chunk, zi=self._clarity_state)
        
        enhanced = chunk + 0.35 * clarity_band
        # Gentle preamp saturation adds harmonic richness to weak vocals
        warm = np.tanh(enhanced * 1.25) / 1.25
        return warm.astype(np.float32)

    def _apply_agc_and_gain(self, chunk: np.ndarray, is_voice_present: bool) -> np.ndarray:
        """
        Smart Gated AGC:
        Only amplifies when the user's voice is present; NEVER boosts background noise or distant sounds.
        """
        linear_gain = 10.0 ** (self.settings.gain_db / 20.0)
        gained = chunk * linear_gain
        
        if self.settings.agc_enabled and is_voice_present:
            current_rms = np.sqrt(np.mean(gained ** 2) + 1e-9)
            if current_rms > 0.015:  # Confirmed primary voice presence
                target = self.settings.target_rms
                ratio = target / (current_rms + 1e-6)
                clamped_ratio = np.clip(ratio, 0.7, 3.2)
                smooth_gain = 0.85 * (self._prev_rms) + 0.15 * clamped_ratio
                self._prev_rms = smooth_gain
                gained = gained * smooth_gain
        else:
            self._prev_rms = 1.0
                
        # Soft-knee limiter at 0.95 to prevent clipping
        abs_max = np.max(np.abs(gained)) + 1e-9
        if abs_max > 0.95:
            gained = np.tanh(gained / 0.95) * 0.95
            
        return np.clip(gained, -0.99, 0.99).astype(np.float32)

    def process_chunk(self, raw_bytes_or_floats) -> Tuple[np.ndarray, Dict[str, Any]]:
        """Processes a single incoming audio chunk through the isolation pipeline."""
        t_start = time.perf_counter()
        
        if isinstance(raw_bytes_or_floats, (bytes, bytearray)):
            chunk = np.frombuffer(raw_bytes_or_floats, dtype=np.float32)
        else:
            chunk = np.asarray(raw_bytes_or_floats, dtype=np.float32)
            
        if len(chunk) == 0:
            return np.array([], dtype=np.float32), {}
            
        # 1. Compute input telemetry
        in_rms = np.sqrt(np.mean(chunk ** 2) + 1e-9)
        self.input_level_db = float(20.0 * math.log10(max(in_rms, 1e-4)))

        # 2. Check bypass
        if self.settings.bypass:
            out_chunk = chunk
            self.is_speaking = bool(in_rms > 0.015)
            self.is_gate_open = True
        else:
            # 3. Stage 1: Strip fan motor drone & low-frequency rumble (< 150 Hz)
            de_rumbled = self._apply_traffic_and_rumble_cut(chunk)

            # 4. Stage 2: Adaptive Spectral Subtraction (Continuous Fan / Hiss suppression)
            denoised = self._denoise_chunk(de_rumbled)

            # Measure clean level for proximity gate decision
            clean_rms = np.sqrt(np.mean(denoised ** 2) + 1e-9)
            clean_db = float(20.0 * math.log10(max(clean_rms, 1e-4)))

            # 5. Stage 3: Close-Proximity Voice Gate (Mutes silence and residual background below threshold)
            gated, gate_open = self._apply_proximity_voice_gate(denoised, clean_db)
            
            # 6. Stage 4: Vocal Articulation & Consonant Formant Restoration
            articulated = self._apply_articulation_boost(gated)
            
            # 7. Stage 5: Gated AGC & Normalization
            out_chunk = self._apply_agc_and_gain(articulated, gate_open)

            self.is_speaking = bool(gate_open and clean_rms > 0.012)

        # Output telemetry
        out_rms = np.sqrt(np.mean(out_chunk ** 2) + 1e-9)
        self.output_level_db = float(20.0 * math.log10(max(out_rms, 1e-4)))
        
        t_end = time.perf_counter()
        self.last_latency_ms = float((t_end - t_start) * 1000.0)

        # Queue output to virtual cable / speaker stream if active
        if self._is_streaming and self._out_stream is not None:
            try:
                self._output_queue.put_nowait(out_chunk.copy())
            except queue.Full:
                try:
                    self._output_queue.get_nowait()
                    self._output_queue.put_nowait(out_chunk.copy())
                except Exception:
                    pass

        telemetry = {
            "latency_ms": round(float(self.last_latency_ms), 2),
            "input_db": round(float(self.input_level_db), 1),
            "output_db": round(float(self.output_level_db), 1),
            "is_speaking": bool(self.is_speaking),
            "is_gate_open": bool(self.is_gate_open),
            "streaming_active": bool(self._is_streaming),
            "sample_rate": int(self.sample_rate)
        }
        
        return out_chunk, telemetry


audio_processor = AudioProcessor()
