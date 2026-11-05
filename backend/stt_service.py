"""
Speech-to-Text (STT) Transcription Service for VoiceForge AI.
Handles transcription for:
- User microphone speech
- Incoming meeting / partner audio streams
- Auto-conversion of WebM/Opus or raw PCM to 16kHz WAV
- Google Speech Recognition with graceful fallback and multiple language support
"""

import io
import os
import shutil
import subprocess
import logging
from typing import Optional, Dict, Any
import speech_recognition as sr

logger = logging.getLogger("voice_enhancer.stt")

def find_ffmpeg() -> str:
    """Locates ffmpeg binary from local tools, system PATH, or npm modules."""
    local_tool = os.path.join(os.path.dirname(__file__), "tools", "ffmpeg.exe")
    if os.path.exists(local_tool):
        return local_tool
    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffmpeg:
        return sys_ffmpeg
    frontend_ffmpeg = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        "frontend", "node_modules", "@ffmpeg-installer", "win32-x64", "ffmpeg.exe"
    )
    if os.path.exists(frontend_ffmpeg):
        return frontend_ffmpeg
    return "ffmpeg"


class STTService:
    def __init__(self):
        self.recognizer = sr.Recognizer()
        self.recognizer.energy_threshold = 300
        self.recognizer.dynamic_energy_threshold = True
        self.recognizer.pause_threshold = 0.6
        self._ffmpeg_bin = find_ffmpeg()

    def convert_to_wav(self, audio_bytes: bytes) -> Optional[bytes]:
        """Converts any audio container (WebM, OGG, MP3, etc.) to 16kHz 16-bit Mono WAV."""
        if len(audio_bytes) < 12:
            return None
            
        # Already standard RIFF WAV
        if audio_bytes[:4] == b"RIFF":
            return audio_bytes

        try:
            cmd = [
                self._ffmpeg_bin,
                "-hide_banner",
                "-loglevel", "error",
                "-y",
                "-i", "pipe:0",
                "-ac", "1",
                "-ar", "16000",
                "-f", "wav",
                "pipe:1"
            ]
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, stderr = proc.communicate(input=audio_bytes, timeout=8.0)
            if proc.returncode == 0 and len(stdout) > 44:
                return stdout
            else:
                logger.warning(f"ffmpeg conversion returned code {proc.returncode}: {stderr.decode('utf-8', errors='ignore')}")
                return None
        except Exception as e:
            logger.error(f"Error converting audio to WAV with ffmpeg: {e}")
            return None

    def transcribe(self, audio_bytes: bytes, language: str = "en-US") -> Dict[str, Any]:
        """
        Transcribes audio bytes into text.
        Returns:
            {"success": bool, "text": str, "language": str, "error": Optional[str]}
        """
        if not audio_bytes or len(audio_bytes) < 400:
            return {"success": True, "text": "", "language": language, "error": None}

        # Ensure audio is PCM WAV
        wav_bytes = self.convert_to_wav(audio_bytes)
        if not wav_bytes:
            return {"success": False, "text": "", "language": language, "error": "Could not decode audio format"}

        try:
            buf = io.BytesIO(wav_bytes)
            with sr.AudioFile(buf) as source:
                audio_data = self.recognizer.record(source)

            # Transcribe via Google Speech Recognition
            text = self.recognizer.recognize_google(audio_data, language=language)
            return {"success": True, "text": text.strip(), "language": language, "error": None}

        except sr.UnknownValueError:
            # Normal: audio was unintelligible, breathing, silence, or noise
            return {"success": True, "text": "", "language": language, "error": None}
        except sr.RequestError as req_err:
            logger.warning(f"Google STT network/request error: {req_err}")
            return {"success": False, "text": "", "language": language, "error": f"STT network error: {req_err}"}
        except Exception as e:
            logger.error(f"STT unexpected error: {e}")
            return {"success": False, "text": "", "language": language, "error": str(e)}


stt_service = STTService()
