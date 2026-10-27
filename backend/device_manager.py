"""
Audio Device Management module.
Queries Windows audio endpoints and identifies physical microphones,
headphones/speakers, and Virtual Audio Cables (VB-Audio Cable).
"""

from typing import List, Dict, Optional, Any
import logging

logger = logging.getLogger("voice_enhancer.devices")

class DeviceManager:
    def __init__(self):
        self._cached_devices: List[Dict[str, Any]] = []
        self._vb_cable_input_index: Optional[int] = None
        self._vb_cable_output_index: Optional[int] = None

    def query_devices(self) -> Dict[str, Any]:
        """Query system audio devices via sounddevice."""
        try:
            import sounddevice as sd
            devices = sd.query_devices()
            hostapis = sd.query_hostapis()
            
            inputs = []
            outputs = []
            vb_cable_found = False
            recommended_output_idx = None
            
            for idx, dev in enumerate(devices):
                dev_name = dev.get("name", "")
                hostapi_idx = dev.get("hostapi", 0)
                hostapi_name = hostapis[hostapi_idx].get("name", "") if hostapi_idx < len(hostapis) else ""
                
                is_vb_cable = "cable" in dev_name.lower() or "vb-audio" in dev_name.lower()
                
                info = {
                    "index": idx,
                    "name": dev_name,
                    "hostapi": hostapi_name,
                    "max_input_channels": dev.get("max_input_channels", 0),
                    "max_output_channels": dev.get("max_output_channels", 0),
                    "default_sample_rate": dev.get("default_samplerate", 44100),
                    "is_vb_cable": is_vb_cable,
                }
                
                if dev.get("max_input_channels", 0) > 0:
                    inputs.append(info)
                    
                if dev.get("max_output_channels", 0) > 0:
                    outputs.append(info)
                    if is_vb_cable:
                        vb_cable_found = True
                        if recommended_output_idx is None:
                            recommended_output_idx = idx

            # If no VB-Cable found, pick default output
            if recommended_output_idx is None:
                try:
                    default_out = sd.default.device[1]
                    recommended_output_idx = default_out if default_out >= 0 else (outputs[0]["index"] if outputs else None)
                except Exception:
                    recommended_output_idx = outputs[0]["index"] if outputs else None

            return {
                "inputs": inputs,
                "outputs": outputs,
                "vb_cable_detected": vb_cable_found,
                "recommended_output_index": recommended_output_idx,
                "vb_cable_install_instructions": None if vb_cable_found else (
                    "VB-Audio Virtual Cable was not detected. To route audio into Zoom/Teams, "
                    "download and install the free driver from https://vb-audio.com/Cable/ and restart audio."
                )
            }
        except Exception as e:
            logger.error(f"Error querying audio devices: {e}")
            return {
                "inputs": [],
                "outputs": [],
                "vb_cable_detected": False,
                "recommended_output_index": None,
                "error": str(e)
            }

device_manager = DeviceManager()
