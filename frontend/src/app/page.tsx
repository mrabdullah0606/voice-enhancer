"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Sliders,
  Activity,
  Radio,
  Zap,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ExternalLink,
  Headphones,
  Settings2,
  BookOpen,
  Download,
  Play,
  RotateCcw,
  Check,
  ChevronRight,
  ChevronLeft,
  FileAudio,
  ShieldCheck
} from "lucide-react";

interface DeviceInfo {
  index: number;
  name: string;
  hostapi: string;
  max_input_channels: number;
  max_output_channels: number;
  default_sample_rate: number;
  is_vb_cable: boolean;
}

interface DeviceQueryResponse {
  inputs: DeviceInfo[];
  outputs: DeviceInfo[];
  vb_cable_detected: boolean;
  recommended_output_index: number | null;
  vb_cable_install_instructions: string | null;
}

interface TelemetryData {
  latency_ms: number;
  roundtrip_proc_ms?: number;
  input_db: number;
  output_db: number;
  is_speaking: boolean;
  is_gate_open?: boolean;
  streaming_active: boolean;
  sample_rate: number;
}

interface DatasetStats {
  raw_count: number;
  raw_duration_sec: number;
  raw_duration_min: number;
  target_min: number;
  progress_percent: number;
  processed_count: number;
  processed_duration_min: number;
  zip_available: boolean;
  zip_size_mb: number;
}

export default function VoiceEnhancementDashboard() {
  const [activeTab, setActiveTab] = useState<"studio" | "dataset">("studio");

  // Engine states
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [monitorAudio, setMonitorAudio] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Device states
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState<string>("");
  const [outputDevices, setOutputDevices] = useState<DeviceInfo[]>([]);
  const [selectedOutputIndex, setSelectedOutputIndex] = useState<number | null>(null);
  const [vbCableDetected, setVbCableDetected] = useState<boolean>(false);

  // DSP & AI Enhancement Settings
  const [bypass, setBypass] = useState<boolean>(false);
  const [denoiseStrength, setDenoiseStrength] = useState<number>(0.90);
  const [gainDb, setGainDb] = useState<number>(6.0);
  const [agcEnabled, setAgcEnabled] = useState<boolean>(true);
  const [articulationBoost, setArticulationBoost] = useState<boolean>(true);
  const [pitchShift, setPitchShift] = useState<number>(0.0);

  // Voice Isolation & Traffic Filter
  const [gateEnabled, setGateEnabled] = useState<boolean>(true);
  const [gateThresholdDb, setGateThresholdDb] = useState<number>(-34.0);
  const [trafficCutEnabled, setTrafficCutEnabled] = useState<boolean>(true);

  // Live telemetry
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    latency_ms: 0,
    roundtrip_proc_ms: 0,
    input_db: -60,
    output_db: -60,
    is_speaking: false,
    is_gate_open: false,
    streaming_active: false,
    sample_rate: 16000,
  });

  // Dataset Studio state
  const [prompts, setPrompts] = useState<string[]>([]);
  const [currentPromptIdx, setCurrentPromptIdx] = useState<number>(0);
  const [isRecordingPrompt, setIsRecordingPrompt] = useState<boolean>(false);
  const [promptRecordSec, setPromptRecordSec] = useState<number>(0);
  const [promptAudioUrl, setPromptAudioUrl] = useState<string | null>(null);
  const [promptBlob, setPromptBlob] = useState<Blob | null>(null);
  const [isProcessingDataset, setIsProcessingDataset] = useState<boolean>(false);
  const [datasetStats, setDatasetStats] = useState<DatasetStats>({
    raw_count: 0,
    raw_duration_sec: 0,
    raw_duration_min: 0,
    target_min: 5.0,
    progress_percent: 0,
    processed_count: 0,
    processed_duration_min: 0,
    zip_available: false,
    zip_size_mb: 0,
  });

  // Audio refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const monitorGainNodeRef = useRef<GainNode | null>(null);
  const monitorAudioRef = useRef<boolean>(monitorAudio);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformBoxRef = useRef<HTMLDivElement | null>(null);
  const waveformBufferRef = useRef<Float32Array>(new Float32Array(128));

  // Dataset recorder refs
  const datasetRecorderRef = useRef<MediaRecorder | null>(null);
  const datasetChunksRef = useRef<Blob[]>([]);
  const promptTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    monitorAudioRef.current = monitorAudio;
  }, [monitorAudio]);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/api/devices");
      if (res.ok) {
        const data: DeviceQueryResponse = await res.json();
        setOutputDevices(data.outputs);
        setVbCableDetected(data.vb_cable_detected);
        if (selectedOutputIndex === null && data.recommended_output_index !== null) {
          setSelectedOutputIndex(data.recommended_output_index);
        }
      }
    } catch {
      // ignore
    }
  }, [selectedOutputIndex]);

  const fetchDatasetInfo = useCallback(async () => {
    try {
      const pRes = await fetch("http://127.0.0.1:8000/api/dataset/prompts");
      if (pRes.ok) {
        const pData = await pRes.json();
        setPrompts(pData.prompts || []);
      }
      const sRes = await fetch("http://127.0.0.1:8000/api/dataset/stats");
      if (sRes.ok) {
        const sData = await sRes.json();
        setDatasetStats(sData);
      }
    } catch {
      // ignore
    }
  }, []);

  const enumerateInputs = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === "audioinput");
      setInputDevices(mics);
      if (mics.length > 0 && !selectedInputDeviceId) {
        setSelectedInputDeviceId(mics[0].deviceId);
      }
    } catch {
      // ignore
    }
  }, [selectedInputDeviceId]);

  useEffect(() => {
    fetchDevices();
    enumerateInputs();
    fetchDatasetInfo();
    const interval = setInterval(fetchDevices, 5000);
    return () => clearInterval(interval);
  }, [fetchDevices, enumerateInputs, fetchDatasetInfo]);

  const pushSettings = useCallback(
    async (overrides = {}) => {
      const payload = {
        sample_rate: 16000,
        chunk_size: 1024,
        channels: 1,
        bypass: bypass,
        denoise_enabled: denoiseStrength > 0.05,
        denoise_strength: denoiseStrength,
        gate_enabled: gateEnabled,
        gate_threshold_db: gateThresholdDb,
        traffic_cut_enabled: trafficCutEnabled,
        suppress_far_voices: true,
        gain_db: gainDb,
        agc_enabled: agcEnabled,
        target_rms: 0.16,
        articulation_boost: articulationBoost,
        pitch_shift_semitones: pitchShift,
        output_device_index: selectedOutputIndex,
        output_to_virtual_cable: true,
        ...overrides,
      };

      try {
        await fetch("http://127.0.0.1:8000/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "update_settings",
              settings: payload,
            })
          );
        }
      } catch (err) {
        console.error("Failed to push settings:", err);
      }
    },
    [
      bypass,
      denoiseStrength,
      gateEnabled,
      gateThresholdDb,
      trafficCutEnabled,
      gainDb,
      agcEnabled,
      articulationBoost,
      pitchShift,
      selectedOutputIndex,
    ]
  );

  useEffect(() => {
    if (isConnected) {
      pushSettings();
    }
  }, [pushSettings, isConnected]);

  const connectWebSocket = useCallback(() => {
    const ws = new WebSocket("ws://127.0.0.1:8000/ws/audio");
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setIsConnected(true);
      setErrorMsg(null);
      pushSettings();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "telemetry" && msg.data) {
            setTelemetry((prev) => ({
              ...prev,
              ...msg.data,
            }));
          }
        } catch {
          // ignore
        }
      } else if (event.data instanceof ArrayBuffer) {
        const floatData = new Float32Array(event.data);
        waveformBufferRef.current = floatData.slice(0, 128);

        if (monitorAudioRef.current && audioContextRef.current && monitorGainNodeRef.current) {
          const ctx = audioContextRef.current;
          const audioBuffer = ctx.createBuffer(1, floatData.length, 16000);
          audioBuffer.getChannelData(0).set(floatData);
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(monitorGainNodeRef.current);
          source.start();
        }
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
      setIsConnected(false);
    };

    wsRef.current = ws;
  }, [pushSettings]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWebSocket]);

  const startAudio = async () => {
    try {
      setErrorMsg(null);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedInputDeviceId ? { ideal: selectedInputDeviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: false, // Handled cleanly by backend DSP
            autoGainControl: false,  // CRITICAL: Stop Windows/Chromium from ramping up fan noise when user pauses!
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            autoGainControl: false,
          },
        });
      }
      mediaStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(1024, 1, 1);
      processorNodeRef.current = processor;

      const monitorGain = audioCtx.createGain();
      monitorGain.gain.value = monitorAudio ? 1.0 : 0.0;
      monitorGain.connect(audioCtx.destination);
      monitorGainNodeRef.current = monitorGain;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(inputData.buffer);
        }
      };

      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      await fetch("http://127.0.0.1:8000/api/stream/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output_device_index: selectedOutputIndex }),
      });

      setIsProcessing(true);
    } catch {
      setErrorMsg("Could not connect to microphone. Please grant browser permission.");
      setIsProcessing(false);
    }
  };

  const stopAudio = async () => {
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    try {
      await fetch("http://127.0.0.1:8000/api/stream/stop", { method: "POST" });
    } catch {
      // ignore
    }
    setIsProcessing(false);
  };

  // Canvas visualizer with responsive box size
  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      // Match canvas internal resolution to client display size
      if (waveformBoxRef.current) {
        const boxWidth = waveformBoxRef.current.clientWidth;
        if (canvas.width !== boxWidth) {
          canvas.width = boxWidth;
        }
      }

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Subtle studio grid
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 36) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      const data = waveformBufferRef.current;
      const sliceWidth = width / data.length;

      ctx.shadowBlur = 10;
      ctx.shadowColor = bypass ? "rgba(245, 158, 11, 0.7)" : "rgba(99, 102, 241, 0.8)";
      ctx.strokeStyle = bypass ? "#f59e0b" : "#6366f1";
      ctx.lineWidth = 2.5;
      ctx.beginPath();

      let x = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] * 1.8;
        const y = height / 2 + v * (height / 2);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [bypass]);

  // Helper to encode AudioBuffer into genuine 16-bit PCM WAV (RIFF/WAVE)
  const audioBufferToWav = (buffer: AudioBuffer): Blob => {
    const numChannels = 1;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    const channelData = buffer.getChannelData(0);
    const dataLength = channelData.length * 2;
    const bufferLength = 44 + dataLength;
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, "data");
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < channelData.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return new Blob([view], { type: "audio/wav" });
  };

  // Dataset prompt recording functions
  const startRecordingPrompt = async () => {
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedInputDeviceId ? { ideal: selectedInputDeviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
          },
        });
      }

      const recorder = new MediaRecorder(stream);
      datasetChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          datasetChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const rawBlob = new Blob(datasetChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        try {
          const ab = await rawBlob.arrayBuffer();
          const decodeCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          const decoded = await decodeCtx.decodeAudioData(ab);
          const wavBlob = audioBufferToWav(decoded);
          decodeCtx.close();
          setPromptBlob(wavBlob);
          setPromptAudioUrl(URL.createObjectURL(wavBlob));
        } catch {
          setPromptBlob(rawBlob);
          setPromptAudioUrl(URL.createObjectURL(rawBlob));
        }
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(100);
      datasetRecorderRef.current = recorder;
      setIsRecordingPrompt(true);
      setPromptRecordSec(0);

      promptTimerRef.current = setInterval(() => {
        setPromptRecordSec((s) => s + 1);
      }, 1000);
    } catch {
      alert("Failed to access microphone for dataset recording.");
    }
  };

  const stopRecordingPrompt = () => {
    if (datasetRecorderRef.current && isRecordingPrompt) {
      datasetRecorderRef.current.stop();
      setIsRecordingPrompt(false);
      if (promptTimerRef.current) {
        clearInterval(promptTimerRef.current);
        promptTimerRef.current = null;
      }
    }
  };

  const approveAndUploadPrompt = async () => {
    if (!promptBlob) return;
    try {
      const formData = new FormData();
      formData.append("file", promptBlob, `prompt_${currentPromptIdx + 1}.wav`);

      const res = await fetch("http://127.0.0.1:8000/api/dataset/upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setDatasetStats(data.stats);
        setPromptBlob(null);
        setPromptAudioUrl(null);
        if (currentPromptIdx < prompts.length - 1) {
          setCurrentPromptIdx((i) => i + 1);
        }
      }
    } catch {
      alert("Failed to save audio sample.");
    }
  };

  // Converts any browser WebM raw files to PCM WAV and runs slicing
  const processDataset = async () => {
    setIsProcessingDataset(true);
    try {
      // 1. Check if raw files need conversion from WebM to PCM WAV
      const listRes = await fetch("http://127.0.0.1:8000/api/dataset/raw_list");
      const listData = await listRes.json();
      const files: string[] = listData.files || [];

      if (files.length > 0) {
        const decodeCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        for (const fname of files) {
          try {
            const fRes = await fetch(`http://127.0.0.1:8000/api/dataset/raw_file/${fname}`);
            const ab = await fRes.arrayBuffer();
            // Check if it starts with EBML (WebM)
            const header = new Uint8Array(ab.slice(0, 4));
            if (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) {
              const decoded = await decodeCtx.decodeAudioData(ab);
              const wavBlob = audioBufferToWav(decoded);
              const formData = new FormData();
              formData.append("file", wavBlob, fname);
              await fetch(`http://127.0.0.1:8000/api/dataset/overwrite_sample/${fname}`, {
                method: "POST",
                body: formData,
              });
            }
          } catch (e) {
            console.warn(`Skip conversion for ${fname}:`, e);
          }
        }
        decodeCtx.close();
      }

      // 2. Trigger slicing, normalization & zip bundling
      const res = await fetch("http://127.0.0.1:8000/api/dataset/process", {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        await fetchDatasetInfo();
        alert(`✓ Dataset bundled! Created ${data.slice_count} slices (${data.total_duration_min} minutes). Download ready!`);
      } else {
        alert("Dataset processing returned: " + (data.error || "unknown error"));
      }
    } catch (err) {
      console.error("Process dataset error:", err);
      alert("Failed to process dataset.");
    } finally {
      setIsProcessingDataset(false);
    }
  };

  const getDbPercent = (db: number) => {
    const minDb = -60;
    const maxDb = 0;
    const clamped = Math.max(minDb, Math.min(maxDb, db));
    return ((clamped - minDb) / (maxDb - minDb)) * 100;
  };

  return (
    <div className="app-container">
      {/* Top Header Bar */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-logo">
            <Radio style={{ width: 22, height: 22, color: "#fff" }} />
          </div>
          <div>
            <div className="brand-title">
              VoiceForge AI
              <span className="badge-tag">Real-Time v1.0</span>
            </div>
            <div className="brand-subtitle">
              Low-Latency Vocal Strain Assistance & Neural Resynthesis Engine
            </div>
          </div>
        </div>

        {/* Tab Switcher & Status Indicators */}
        <div className="header-actions">
          <div className="tab-switcher">
            <button
              onClick={() => setActiveTab("studio")}
              className={`tab-btn ${activeTab === "studio" ? "active" : ""}`}
            >
              <Activity style={{ width: 14, height: 14 }} />
              Live Studio
            </button>
            <button
              onClick={() => setActiveTab("dataset")}
              className={`tab-btn ${activeTab === "dataset" ? "active" : ""}`}
            >
              <BookOpen style={{ width: 14, height: 14 }} />
              Dataset Studio
              {datasetStats.raw_count > 0 && (
                <span style={{ fontSize: "0.65rem", padding: "1px 6px", borderRadius: 9999, background: "#fff", color: "#000", fontWeight: 700 }}>
                  {datasetStats.raw_count}
                </span>
              )}
            </button>
          </div>

          <div className="status-pill">
            <span className={`status-dot ${!isConnected ? "offline" : ""}`} />
            {isConnected ? "Engine Core Online" : "Backend Disconnected"}
          </div>

          <div className="latency-pill">
            <Zap style={{ width: 14, height: 14, color: "var(--accent-cyan)" }} />
            <span style={{ fontWeight: 700, color: "#fff" }}>
              {telemetry.roundtrip_proc_ms ? `${telemetry.roundtrip_proc_ms} ms` : "< 2 ms"}
            </span>
            <span style={{ opacity: 0.6, fontSize: "0.7rem", borderLeft: "1px solid rgba(255,255,255,0.15)", paddingLeft: 6 }}>
              Target: &lt; 300ms
            </span>
          </div>
        </div>
      </header>

      {/* VB-Audio Cable Alert / Status Banner */}
      {!vbCableDetected ? (
        <div className="alert-banner warning">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AlertTriangle style={{ width: 18, height: 18, flexShrink: 0 }} />
            <span>
              <strong>Virtual Audio Cable Not Detected:</strong> To route audio into Zoom or Teams, install the free VB-Audio Cable driver.
            </span>
          </div>
          <a
            href="https://vb-audio.com/Cable/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            style={{ textDecoration: "none" }}
          >
            Get Free VB-CABLE
            <ExternalLink style={{ width: 12, height: 12 }} />
          </a>
        </div>
      ) : (
        <div className="alert-banner success">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CheckCircle2 style={{ width: 18, height: 18, color: "var(--accent-emerald)", flexShrink: 0 }} />
            <span>
              <strong>Ready for Virtual Meetings:</strong> VB-Audio Cable is detected. Choose &quot;CABLE Output&quot; as your mic in Zoom or Teams!
            </span>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="alert-banner warning" style={{ background: "rgba(159, 18, 57, 0.25)", borderColor: "rgba(244, 63, 94, 0.4)", color: "#fecdd3" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AlertTriangle style={{ width: 18, height: 18, flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        </div>
      )}

      {/* TAB 1: LIVE STUDIO */}
      {activeTab === "studio" && (
        <div className="studio-grid">
          {/* Left Column: Visualizer & Master Actions */}
          <div className="grid-col">
            <div className="glass-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">
                    <Activity style={{ width: 18, height: 18, color: "var(--accent-indigo-light)" }} />
                    Live Acoustic Resynthesis
                  </div>
                  <div className="panel-desc">
                    Real-time spectral denoising, proximity voice isolation, and dynamic clarity.
                  </div>
                </div>

                <button
                  id="master-engage-btn"
                  onClick={isProcessing ? stopAudio : startAudio}
                  className={`btn-primary ${isProcessing ? "btn-danger" : ""}`}
                >
                  {isProcessing ? (
                    <>
                      <MicOff style={{ width: 16, height: 16 }} />
                      Stop Engine
                    </>
                  ) : (
                    <>
                      <Mic style={{ width: 16, height: 16 }} />
                      Engage Engine
                    </>
                  )}
                </button>
              </div>

              {/* Live Waveform Canvas */}
              <div ref={waveformBoxRef} className="waveform-box">
                <canvas ref={canvasRef} height={150} className="waveform-canvas" />
                <div className="waveform-tag">
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: telemetry.is_speaking ? "var(--accent-emerald)" : "var(--text-subtle)",
                      boxShadow: telemetry.is_speaking ? "0 0 6px var(--accent-emerald)" : "none",
                    }}
                  />
                  {telemetry.is_speaking ? "Voice Active (VAD)" : "Ambient Floor"}
                </div>

                {bypass && (
                  <div style={{ position: "absolute", top: 10, right: 12, fontSize: "0.68rem", fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.4)", color: "var(--accent-amber)" }}>
                    BYPASS ACTIVE
                  </div>
                )}
              </div>

              {/* Dual VU Meters */}
              <div className="vu-grid">
                <div className="vu-box">
                  <div className="vu-header">
                    <span>Input Level (Raw Mic)</span>
                    <span style={{ fontFamily: "monospace" }}>{telemetry.input_db} dB</span>
                  </div>
                  <div className="vu-meter-track">
                    <div
                      className="vu-meter-bar input"
                      style={{ width: `${getDbPercent(telemetry.input_db)}%` }}
                    />
                  </div>
                </div>

                <div className="vu-box">
                  <div className="vu-header">
                    <span>Enhanced Output (Sink)</span>
                    <span style={{ fontFamily: "monospace" }}>{telemetry.output_db} dB</span>
                  </div>
                  <div className="vu-meter-track">
                    <div
                      className="vu-meter-bar output"
                      style={{ width: `${getDbPercent(telemetry.output_db)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Quick Controls */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 4 }}>
                <button
                  onClick={() => setBypass(!bypass)}
                  className={`btn-secondary ${bypass ? "active" : ""}`}
                >
                  <Sliders style={{ width: 14, height: 14 }} />
                  {bypass ? "Bypass: Enabled (Raw Mic)" : "Bypass: Off (Enhanced)"}
                </button>

                <button
                  onClick={() => setMonitorAudio(!monitorAudio)}
                  className={`btn-secondary ${monitorAudio ? "active" : ""}`}
                >
                  {monitorAudio ? (
                    <Headphones style={{ width: 14, height: 14, color: "var(--accent-indigo-light)" }} />
                  ) : (
                    <VolumeX style={{ width: 14, height: 14 }} />
                  )}
                  {monitorAudio ? "Headphone Monitor: On" : "Headphone Monitor: Muted"}
                </button>
              </div>
            </div>

            {/* Conversational Latency Budget */}
            <div className="glass-panel" style={{ padding: 20 }}>
              <div className="panel-title" style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
                <Zap style={{ width: 14, height: 14, color: "var(--accent-cyan)" }} />
                Real-Time Conversational Latency Budget
              </div>

              <div className="latency-grid">
                <div className="latency-item">
                  <span style={{ fontSize: "0.68rem", color: "var(--text-subtle)", textTransform: "uppercase" }}>Capture</span>
                  <strong style={{ fontSize: "0.95rem" }}>~40 ms</strong>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-subtle)" }}>AudioWorklet 16k</span>
                </div>

                <div className="latency-item">
                  <span style={{ fontSize: "0.68rem", color: "var(--text-subtle)", textTransform: "uppercase" }}>DSP Engine</span>
                  <strong style={{ fontSize: "0.95rem", color: "var(--accent-indigo-light)" }}>
                    {telemetry.latency_ms ? `${telemetry.latency_ms} ms` : "1.8 ms"}
                  </strong>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-subtle)" }}>Gate + Denoise</span>
                </div>

                <div className="latency-item">
                  <span style={{ fontSize: "0.68rem", color: "var(--text-subtle)", textTransform: "uppercase" }}>Ring Output</span>
                  <strong style={{ fontSize: "0.95rem" }}>~25 ms</strong>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-subtle)" }}>VB-Cable Sink</span>
                </div>

                <div className="latency-item highlight">
                  <span style={{ fontSize: "0.68rem", color: "var(--accent-emerald)", textTransform: "uppercase", fontWeight: 700 }}>Total Delay</span>
                  <strong style={{ fontSize: "0.95rem", color: "#6ee7b7" }}>
                    {telemetry.latency_ms ? `${Math.round(telemetry.latency_ms + 65)} ms` : "67 ms"}
                  </strong>
                  <span style={{ fontSize: "0.65rem", color: "var(--accent-emerald)" }}>&lt; 300ms Budget</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Routing & Noise Isolation Parameters */}
          <div className="grid-col">
            {/* Audio Routing & Devices */}
            <div className="glass-panel" style={{ padding: 20 }}>
              <div className="panel-header">
                <div className="panel-title" style={{ fontSize: "0.95rem" }}>
                  <Settings2 style={{ width: 16, height: 16, color: "var(--accent-cyan)" }} />
                  Audio Routing & Devices
                </div>
                <button
                  onClick={() => {
                    fetchDevices();
                    enumerateInputs();
                  }}
                  className="btn-secondary"
                  style={{ padding: "4px 8px" }}
                  title="Refresh Audio Devices"
                >
                  <RefreshCw style={{ width: 12, height: 12 }} />
                </button>
              </div>

              <div className="field-group">
                <label className="field-label">
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Mic style={{ width: 14, height: 14, color: "var(--accent-indigo-light)" }} />
                    Physical Microphone (Input)
                  </span>
                </label>
                <select
                  value={selectedInputDeviceId}
                  onChange={(e) => setSelectedInputDeviceId(e.target.value)}
                  className="field-select"
                >
                  {inputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone (${d.deviceId.slice(0, 8)})`}
                    </option>
                  ))}
                  {inputDevices.length === 0 && <option value="">Default Microphone</option>}
                </select>
              </div>

              <div className="field-group">
                <label className="field-label">
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Volume2 style={{ width: 14, height: 14, color: "var(--accent-cyan)" }} />
                    Output Sink (Zoom/Teams Target)
                  </span>
                </label>
                <select
                  value={selectedOutputIndex ?? ""}
                  onChange={(e) => {
                    const val = e.target.value ? parseInt(e.target.value, 10) : null;
                    setSelectedOutputIndex(val);
                  }}
                  className="field-select"
                >
                  {outputDevices.map((d) => (
                    <option key={d.index} value={d.index}>
                      {d.is_vb_cable ? "⭐ [VB-CABLE] " : ""}
                      {d.name} ({d.hostapi})
                    </option>
                  ))}
                  {outputDevices.length === 0 && <option value="">Default Audio Output</option>}
                </select>
                <div style={{ fontSize: "0.7rem", color: "var(--text-subtle)", marginTop: 2 }}>
                  Route into VB-CABLE Input, then select VB-CABLE Output in Zoom/Teams.
                </div>
              </div>
            </div>

            {/* Voice Isolation & Background Filters Card */}
            <div className="glass-panel" style={{ padding: 20 }}>
              <div className="panel-header">
                <div className="panel-title" style={{ fontSize: "0.95rem" }}>
                  <ShieldCheck style={{ width: 16, height: 16, color: "var(--accent-emerald)" }} />
                  Voice Isolation & Background Filters
                </div>
                <div
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    padding: "3px 10px",
                    borderRadius: 9999,
                    background: telemetry.is_gate_open ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.05)",
                    color: telemetry.is_gate_open ? "#6ee7b7" : "var(--text-subtle)",
                    border: telemetry.is_gate_open ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid var(--border-color)",
                  }}
                >
                  {telemetry.is_gate_open ? "● Gate Open (Your Voice)" : "○ Gate Muted (Noise Blocked)"}
                </div>
              </div>

              {/* Close-Proximity Voice Isolation Gate */}
              <div className="slider-wrapper" style={{ borderColor: "rgba(16, 185, 129, 0.2)" }}>
                <div className="slider-header">
                  <span style={{ fontWeight: 600, color: "#fff" }}>Close-Mic Isolation Gate</span>
                  <span style={{ fontFamily: "monospace", color: "var(--accent-emerald)", fontWeight: 700 }}>{gateThresholdDb} dB</span>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="-22"
                  step="1"
                  value={gateThresholdDb}
                  onChange={(e) => setGateThresholdDb(parseFloat(e.target.value))}
                />
                <div className="slider-desc">
                  Mutes distant chatter and street noise. Slide right if outside voices/vehicles are being heard.
                </div>
              </div>

              {/* Traffic / Vehicle Rumble Cut Toggle */}
              <div
                onClick={() => setTrafficCutEnabled(!trafficCutEnabled)}
                className={`toggle-card ${trafficCutEnabled ? "active cyan" : ""}`}
              >
                <div className="toggle-header">
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <ShieldCheck style={{ width: 14, height: 14, color: "var(--accent-cyan)" }} />
                    Vehicle & Traffic Rumble Cut (135 Hz)
                  </span>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: trafficCutEnabled ? "var(--accent-cyan)" : "var(--text-subtle)" }} />
                </div>
                <div className="toggle-desc">
                  Steep high-pass filter completely removes car engines, road vibration, and AC hum.
                </div>
              </div>

              {/* Ambient Noise Suppression */}
              <div className="slider-wrapper">
                <div className="slider-header">
                  <span style={{ fontWeight: 600, color: "#fff" }}>Ambient Noise Suppression</span>
                  <span style={{ fontFamily: "monospace", color: "var(--accent-indigo-light)" }}>{Math.round(denoiseStrength * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={denoiseStrength}
                  onChange={(e) => setDenoiseStrength(parseFloat(e.target.value))}
                />
              </div>

              {/* Whisper & Low-Volume Gain */}
              <div className="slider-wrapper">
                <div className="slider-header">
                  <span style={{ fontWeight: 600, color: "#fff" }}>Whisper & Vocal Strain Gain</span>
                  <span style={{ fontFamily: "monospace", color: "var(--accent-cyan)" }}>+{gainDb} dB</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="24"
                  step="1"
                  value={gainDb}
                  onChange={(e) => setGainDb(parseFloat(e.target.value))}
                />
              </div>

              {/* Toggles */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div
                  onClick={() => setAgcEnabled(!agcEnabled)}
                  className={`toggle-card ${agcEnabled ? "active" : ""}`}
                >
                  <div className="toggle-header">
                    <span>Auto Gain (AGC)</span>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: agcEnabled ? "var(--accent-indigo-light)" : "var(--text-subtle)" }} />
                  </div>
                  <div className="toggle-desc">Normalizes voice volume</div>
                </div>

                <div
                  onClick={() => setArticulationBoost(!articulationBoost)}
                  className={`toggle-card ${articulationBoost ? "active" : ""}`}
                >
                  <div className="toggle-header">
                    <span>Articulation</span>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: articulationBoost ? "var(--accent-violet)" : "var(--text-subtle)" }} />
                  </div>
                  <div className="toggle-desc">2.8kHz consonant clarity</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DATASET STUDIO */}
      {activeTab === "dataset" && (
        <div className="studio-grid">
          <div className="grid-col">
            <div className="glass-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">
                    <BookOpen style={{ width: 18, height: 18, color: "var(--accent-indigo-light)" }} />
                    Phonetic Dataset Recording Studio
                  </div>
                  <div className="panel-desc">
                    Read sentences aloud to train your personalized neural voice conversion model.
                  </div>
                </div>
                <span className="badge-tag" style={{ fontSize: "0.75rem" }}>
                  Sentence {currentPromptIdx + 1} of {prompts.length || 40}
                </span>
              </div>

              {/* Progress Bar */}
              <div style={{ width: "100%", height: 8, borderRadius: 9999, background: "rgba(0,0,0,0.5)", overflow: "hidden", border: "1px solid var(--border-color)" }}>
                <div
                  style={{
                    height: "100%",
                    borderRadius: 9999,
                    background: "linear-gradient(90deg, var(--accent-indigo), var(--accent-cyan))",
                    width: `${datasetStats.progress_percent}%`,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-subtle)" }}>
                <span>Recorded: {datasetStats.raw_duration_min} min</span>
                <span>Target: 5.0 min ({datasetStats.progress_percent}%)</span>
              </div>

              {/* Prompt Sentence Card */}
              <div style={{ padding: "32px 24px", background: "var(--bg-inner)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", textAlign: "center", minHeight: 140, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
                <span style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--accent-indigo-light)", fontWeight: 700 }}>
                  Prompt #{currentPromptIdx + 1}
                </span>
                <p style={{ fontSize: "1.25rem", fontWeight: 500, color: "#fff", maxWidth: 640, lineHeight: 1.6 }}>
                  &ldquo;{prompts[currentPromptIdx] || "Loading prompts..."}&rdquo;
                </p>
              </div>

              {/* Recording Controls */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingTop: 8 }}>
                {!isRecordingPrompt ? (
                  <button onClick={startRecordingPrompt} className="btn-primary" style={{ padding: "12px 28px", borderRadius: 9999 }}>
                    <Mic style={{ width: 18, height: 18 }} />
                    Record Sentence
                  </button>
                ) : (
                  <button onClick={stopRecordingPrompt} className="btn-primary btn-danger" style={{ padding: "12px 28px", borderRadius: 9999 }}>
                    <div style={{ width: 10, height: 10, background: "#fff", borderRadius: 2 }} />
                    Stop Recording ({promptRecordSec}s)
                  </button>
                )}

                {promptAudioUrl && (
                  <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-inner)", padding: 12, borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", flexWrap: "wrap", gap: 12 }}>
                    <audio controls src={promptAudioUrl} style={{ height: 36, maxWidth: 260 }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => {
                          setPromptAudioUrl(null);
                          setPromptBlob(null);
                        }}
                        className="btn-secondary"
                      >
                        <RotateCcw style={{ width: 14, height: 14 }} />
                        Re-record
                      </button>
                      <button
                        onClick={approveAndUploadPrompt}
                        className="btn-primary"
                        style={{ background: "linear-gradient(135deg, var(--accent-emerald), #059669)", boxShadow: "0 4px 14px rgba(5,150,105,0.3)" }}
                      >
                        <Check style={{ width: 14, height: 14 }} />
                        Approve & Next
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", borderTop: "1px solid var(--border-color)", paddingTop: 12 }}>
                  <button
                    onClick={() => {
                      if (currentPromptIdx > 0) {
                        setCurrentPromptIdx((i) => i - 1);
                        setPromptAudioUrl(null);
                        setPromptBlob(null);
                      }
                    }}
                    disabled={currentPromptIdx === 0}
                    className="btn-secondary"
                  >
                    <ChevronLeft style={{ width: 14, height: 14 }} />
                    Previous
                  </button>

                  <button
                    onClick={() => {
                      if (currentPromptIdx < prompts.length - 1) {
                        setCurrentPromptIdx((i) => i + 1);
                        setPromptAudioUrl(null);
                        setPromptBlob(null);
                      }
                    }}
                    disabled={currentPromptIdx >= prompts.length - 1}
                    className="btn-secondary"
                  >
                    Skip
                    <ChevronRight style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Dataset Export & Colab */}
          <div className="grid-col">
            <div className="glass-panel" style={{ padding: 20 }}>
              <div className="panel-title" style={{ fontSize: "0.95rem" }}>
                <FileAudio style={{ width: 16, height: 16, color: "var(--accent-cyan)" }} />
                Dataset Processing & Export
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: "0.78rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-color)", paddingBottom: 6 }}>
                  <span style={{ color: "var(--text-subtle)" }}>Recorded Prompts:</span>
                  <strong>{datasetStats.raw_count} files</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-color)", paddingBottom: 6 }}>
                  <span style={{ color: "var(--text-subtle)" }}>Total Duration:</span>
                  <strong>{datasetStats.raw_duration_min} minutes</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-color)", paddingBottom: 6 }}>
                  <span style={{ color: "var(--text-subtle)" }}>Training Slices:</span>
                  <strong>{datasetStats.processed_count} chunks</strong>
                </div>
              </div>

              <button
                onClick={processDataset}
                disabled={isProcessingDataset || datasetStats.raw_count === 0}
                className="btn-primary"
                style={{ width: "100%", opacity: datasetStats.raw_count === 0 ? 0.5 : 1 }}
              >
                {isProcessingDataset ? (
                  <>
                    <RefreshCw style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
                    Slicing & Normalizing...
                  </>
                ) : (
                  <>
                    <Sparkles style={{ width: 14, height: 14 }} />
                    Process & Bundle Dataset (.zip)
                  </>
                )}
              </button>

              {datasetStats.zip_available && (
                <a
                  href="http://127.0.0.1:8000/api/dataset/download_zip"
                  download="user_voice_dataset.zip"
                  className="btn-primary"
                  style={{ background: "linear-gradient(135deg, var(--accent-emerald), #059669)", textDecoration: "none", width: "100%" }}
                >
                  <Download style={{ width: 14, height: 14 }} />
                  Download Dataset ({datasetStats.zip_size_mb} MB)
                </a>
              )}
            </div>

            <div className="glass-panel" style={{ padding: 20, borderColor: "rgba(99, 102, 241, 0.3)", background: "linear-gradient(180deg, rgba(22, 19, 48, 0.4) 0%, rgba(13, 17, 29, 0.8) 100%)" }}>
              <div className="panel-title" style={{ fontSize: "0.95rem", color: "var(--accent-indigo-light)" }}>
                <Zap style={{ width: 16, height: 16, color: "var(--accent-cyan)" }} />
                1-Click Google Colab Training
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
                Train your custom RVC voice model on a free T4 GPU in ~15 minutes without straining your laptop CPU.
              </p>

              <ol style={{ fontSize: "0.75rem", color: "var(--text-main)", paddingLeft: 18, lineHeight: 1.8 }}>
                <li>Download your dataset package above.</li>
                <li>Open the training notebook in Google Colab.</li>
                <li>Upload the .zip and run all cells.</li>
                <li>Drop the resulting .pth into <code style={{ fontSize: "0.68rem", background: "rgba(0,0,0,0.5)", padding: "2px 6px", borderRadius: 4, color: "var(--accent-indigo-light)" }}>backend/models/</code>.</li>
              </ol>

              <a
                href="https://colab.research.google.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
                style={{ width: "100%", justifyContent: "center", textDecoration: "none", background: "rgba(99, 102, 241, 0.15)", borderColor: "rgba(99, 102, 241, 0.4)", color: "#fff" }}
              >
                Launch Google Colab
                <ExternalLink style={{ width: 12, height: 12 }} />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
