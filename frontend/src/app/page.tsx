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
  ShieldCheck,
  MessageSquare,
  Users,
  Copy,
  Trash2,
  FileText,
  Globe,
  Maximize2,
  Minimize2,
  Share2,
  StopCircle,
  Search
} from "lucide-react";

export interface SpeakerNote {
  id: string;
  speaker: "you" | "partner";
  text: string;
  timestamp: string;
  timeMs: number;
}

export interface ActiveSubtitle {
  speaker: "you" | "partner";
  text: string;
  interimText?: string;
  isFinal: boolean;
  timestamp: number;
}

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

  // Live Subtitles & Speaker Notes states
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(true);
  const [subtitleCinemaMode, setSubtitleCinemaMode] = useState<boolean>(false);
  const [subtitleLanguage, setSubtitleLanguage] = useState<string>("en-US");
  const [manualSpeakerMode, setManualSpeakerMode] = useState<"auto" | "you" | "partner">("auto");
  const [activeSubtitle, setActiveSubtitle] = useState<ActiveSubtitle | null>(null);

  // Speaker Notes state
  const [speakerNotes, setSpeakerNotes] = useState<SpeakerNote[]>([]);
  const [notesFilter, setNotesFilter] = useState<"all" | "you" | "partner">("all");
  const [autoScrollNotes, setAutoScrollNotes] = useState<boolean>(true);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [notesSearch, setNotesSearch] = useState<string>("");

  // Partner / Meeting Audio Stream
  const [isPartnerCapturing, setIsPartnerCapturing] = useState<boolean>(false);
  const partnerMediaStreamRef = useRef<MediaStream | null>(null);
  const partnerAudioContextRef = useRef<AudioContext | null>(null);
  const partnerAudioProcessorRef = useRef<ScriptProcessorNode | null>(null);

  // Speech Recognition & Timers
  const recognitionRef = useRef<any>(null);
  const notesFeedEndRef = useRef<HTMLDivElement | null>(null);
  const subtitleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef<boolean>(isProcessing);
  const subtitlesEnabledRef = useRef<boolean>(subtitlesEnabled);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    subtitlesEnabledRef.current = subtitlesEnabled;
  }, [subtitlesEnabled]);

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
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    stopCapturePartnerAudio();
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

  // Helper to encode Float32Array PCM chunks into genuine 16-bit PCM WAV (RIFF/WAVE)
  const floatArrayToWavBlob = (channelData: Float32Array, sampleRate = 16000): Blob => {
    const numChannels = 1;
    const format = 1; // PCM
    const bitDepth = 16;
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

  // Add new finalized speaker note
  const addSpeakerNote = useCallback((speaker: "you" | "partner", text: string) => {
    if (!text || !text.trim()) return;
    const clean = text.trim();
    setSpeakerNotes((prev) => {
      // Prevent rapid duplicates (within 3s with identical text)
      if (prev.length > 0) {
        const last = prev[prev.length - 1];
        if (last.speaker === speaker && last.text.toLowerCase() === clean.toLowerCase() && Date.now() - last.timeMs < 3000) {
          return prev;
        }
      }
      const newNote: SpeakerNote = {
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        speaker,
        text: clean,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        timeMs: Date.now(),
      };
      return [...prev, newNote];
    });
  }, []);

  // Copy all speaker notes formatted with timestamps
  const copyAllNotes = () => {
    if (speakerNotes.length === 0) return;
    const formatted = speakerNotes
      .map((n) => `[${n.timestamp}] ${n.speaker === "you" ? "You" : "Partner"}: ${n.text}`)
      .join("\n");
    navigator.clipboard.writeText(formatted);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  // Export transcript as Markdown or Plain Text
  const exportNotes = (format: "md" | "txt" = "md") => {
    if (speakerNotes.length === 0) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString();
    const timeStr = now.toLocaleTimeString();

    let content = "";
    if (format === "md") {
      content = `# VoiceForge AI -- Meeting Transcript & Speaker Notes\n\n`;
      content += `**Date:** ${dateStr} ${timeStr}\n`;
      content += `**Total Notes:** ${speakerNotes.length} entries\n\n`;
      content += `---\n\n`;
      speakerNotes.forEach((n) => {
        const badge = n.speaker === "you" ? "🔵 **You**" : "🟢 **Partner**";
        content += `- \`[${n.timestamp}]\` ${badge}: ${n.text}\n\n`;
      });
    } else {
      content = `VoiceForge AI -- Meeting Transcript\nDate: ${dateStr} ${timeStr}\nTotal Notes: ${speakerNotes.length}\n\n`;
      speakerNotes.forEach((n) => {
        content += `[${n.timestamp}] ${n.speaker === "you" ? "You" : "Partner"}: ${n.text}\n`;
      });
    }

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting_notes_${now.toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Clear speaker notes
  const clearNotes = () => {
    if (speakerNotes.length === 0) return;
    if (confirm("Clear all speaker notes and transcript for this session?")) {
      setSpeakerNotes([]);
      setActiveSubtitle(null);
    }
  };

  // Filtered speaker notes for UI
  const filteredNotes = speakerNotes.filter((n) => {
    const matchesFilter = notesFilter === "all" || n.speaker === notesFilter;
    const matchesSearch =
      !notesSearch ||
      n.text.toLowerCase().includes(notesSearch.toLowerCase()) ||
      n.speaker.toLowerCase().includes(notesSearch.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const totalWords = speakerNotes.reduce(
    (acc, n) => acc + n.text.split(/\s+/).filter(Boolean).length,
    0
  );

  // Auto-scroll to latest note
  useEffect(() => {
    if (autoScrollNotes && notesFeedEndRef.current) {
      notesFeedEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [speakerNotes, autoScrollNotes]);

  // Subtitle auto-fade after 7s of silence unless speaking
  useEffect(() => {
    if (activeSubtitle && activeSubtitle.isFinal) {
      if (subtitleTimeoutRef.current) clearTimeout(subtitleTimeoutRef.current);
      subtitleTimeoutRef.current = setTimeout(() => {
        if (!telemetry.is_speaking) {
          setActiveSubtitle(null);
        }
      }, 7000);
    }
    return () => {
      if (subtitleTimeoutRef.current) clearTimeout(subtitleTimeoutRef.current);
    };
  }, [activeSubtitle, telemetry.is_speaking]);

  // Web Speech API STT for local microphone ("You") with resilient auto-recovery watchdog
  const isRestartingRef = useRef<boolean>(false);

  const scheduleRestart = useCallback((delayMs = 150) => {
    if (!isProcessingRef.current || !subtitlesEnabledRef.current || isRestartingRef.current) {
      return;
    }
    isRestartingRef.current = true;
    setTimeout(() => {
      isRestartingRef.current = false;
      if (isProcessingRef.current && subtitlesEnabledRef.current) {
        startSpeechRecognition();
      }
    }, delayMs);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startSpeechRecognition = useCallback(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn("Web Speech API not supported in this browser.");
      return;
    }

    // Safely abort previous instance if any
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = subtitleLanguage;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (event: any) => {
        let interim = "";
        let finalTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          const part = item[0].transcript;
          if (item.isFinal) {
            finalTranscript += part;
          } else {
            interim += part;
          }
        }

        const activeSpeaker = manualSpeakerMode === "auto" ? "you" : manualSpeakerMode;

        if (finalTranscript.trim()) {
          const clean = finalTranscript.trim();
          addSpeakerNote(activeSpeaker, clean);
          setActiveSubtitle({
            speaker: activeSpeaker,
            text: clean,
            interimText: "",
            isFinal: true,
            timestamp: Date.now(),
          });
        } else if (interim.trim()) {
          setActiveSubtitle({
            speaker: activeSpeaker,
            text: "",
            interimText: interim.trim(),
            isFinal: false,
            timestamp: Date.now(),
          });
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onerror = (e: any) => {
        if (e.error === "no-speech") return;
        console.warn("Speech recognition warning:", e.error);
        if (e.error === "aborted" || e.error === "network") {
          scheduleRestart(250);
        }
      };

      rec.onend = () => {
        // Crucial: Chrome closes the session after a few sentences.
        // We MUST spawn a fresh new SpeechRecognition instance instead of reusing the ended one!
        scheduleRestart(100);
      };

      rec.start();
      recognitionRef.current = rec;
      isRestartingRef.current = false;
    } catch (e) {
      console.warn("Could not start recognition:", e);
      scheduleRestart(500);
    }
  }, [subtitleLanguage, manualSpeakerMode, addSpeakerNote, scheduleRestart]);

  // Hook speech recognition lifecycle & auto-healing watchdog
  useEffect(() => {
    if (isProcessing && subtitlesEnabled) {
      startSpeechRecognition();
    } else {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
    }
  }, [isProcessing, subtitlesEnabled, subtitleLanguage, startSpeechRecognition]);

  // Active watchdog ensures recognition never stays dead
  useEffect(() => {
    const watchdog = setInterval(() => {
      if (isProcessingRef.current && subtitlesEnabledRef.current && !recognitionRef.current && !isRestartingRef.current) {
        startSpeechRecognition();
      }
    }, 3000);
    return () => clearInterval(watchdog);
  }, [startSpeechRecognition]);

  // Capture Meeting / Partner Audio Stream (DisplayMedia Audio)
  const startCapturePartnerAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints,
      });

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        alert("No audio track detected! Please make sure to check 'Share tab audio' or 'Share system audio' in the browser prompt.");
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      partnerMediaStreamRef.current = stream;
      setIsPartnerCapturing(true);

      const pCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      partnerAudioContextRef.current = pCtx;
      const pSource = pCtx.createMediaStreamSource(stream);
      const pProcessor = pCtx.createScriptProcessor(2048, 1, 1);
      partnerAudioProcessorRef.current = pProcessor;

      let partnerBuffer: Float32Array[] = [];
      let isPartnerSpeakingNow = false;
      let silenceChunks = 0;

      pProcessor.onaudioprocess = async (e) => {
        const data = e.inputBuffer.getChannelData(0);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          sumSq += data[i] * data[i];
        }
        const rms = Math.sqrt(sumSq / data.length);
        const isVoice = rms > 0.015;

        if (isVoice) {
          isPartnerSpeakingNow = true;
          silenceChunks = 0;
          partnerBuffer.push(new Float32Array(data));
          setActiveSubtitle((prev) => {
            if (!prev || prev.speaker !== "partner" || prev.isFinal) {
              return {
                speaker: "partner",
                text: "",
                interimText: "Listening to partner...",
                isFinal: false,
                timestamp: Date.now(),
              };
            }
            return prev;
          });
        } else if (isPartnerSpeakingNow) {
          partnerBuffer.push(new Float32Array(data));
          silenceChunks++;
          if (silenceChunks >= 5 || partnerBuffer.length > 40) {
            isPartnerSpeakingNow = false;
            silenceChunks = 0;
            const totalLen = partnerBuffer.reduce((a, c) => a + c.length, 0);
            if (totalLen > 7000) {
              const merged = new Float32Array(totalLen);
              let off = 0;
              for (const c of partnerBuffer) {
                merged.set(c, off);
                off += c.length;
              }
              const wavBlob = floatArrayToWavBlob(merged, pCtx.sampleRate || 16000);
              partnerBuffer = [];

              try {
                const fd = new FormData();
                fd.append("file", wavBlob, "partner.wav");
                fd.append("language", subtitleLanguage);
                fd.append("speaker", "partner");
                const res = await fetch("http://127.0.0.1:8000/api/stt/transcribe", {
                  method: "POST",
                  body: fd,
                });
                if (res.ok) {
                  const resData = await res.json();
                  if (resData.text && resData.text.trim()) {
                    const clean = resData.text.trim();
                    addSpeakerNote("partner", clean);
                    setActiveSubtitle({
                      speaker: "partner",
                      text: clean,
                      interimText: "",
                      isFinal: true,
                      timestamp: Date.now(),
                    });
                  }
                }
              } catch (err) {
                console.warn("Failed partner transcription:", err);
              }
            } else {
              partnerBuffer = [];
            }
          }
        }
      };

      const pSilent = pCtx.createGain();
      pSilent.gain.value = 0;
      pSource.connect(pProcessor);
      pProcessor.connect(pSilent);
      pSilent.connect(pCtx.destination);

      stream.getVideoTracks().forEach((t) => {
        t.onended = () => stopCapturePartnerAudio();
      });
      audioTracks[0].onended = () => stopCapturePartnerAudio();
    } catch (err) {
      console.warn("Meeting audio share cancelled or error:", err);
      setIsPartnerCapturing(false);
    }
  };

  const stopCapturePartnerAudio = useCallback(() => {
    if (partnerAudioProcessorRef.current) {
      partnerAudioProcessorRef.current.disconnect();
      partnerAudioProcessorRef.current = null;
    }
    if (partnerMediaStreamRef.current) {
      partnerMediaStreamRef.current.getTracks().forEach((t) => t.stop());
      partnerMediaStreamRef.current = null;
    }
    if (partnerAudioContextRef.current) {
      partnerAudioContextRef.current.close();
      partnerAudioContextRef.current = null;
    }
    setIsPartnerCapturing(false);
  }, []);

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

              {/* LIVE ON-SCREEN SUBTITLES */}
              {subtitlesEnabled && (
                <div className={`subtitle-container ${subtitleCinemaMode ? "cinema" : ""}`}>
                  <div className="subtitle-header">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <MessageSquare style={{ width: 14, height: 14, color: "var(--accent-indigo-light)" }} />
                      <strong style={{ color: "#fff", fontSize: "0.78rem" }}>Live Subtitles & Closed Captions</strong>
                      {activeSubtitle ? (
                        <span
                          className={`subtitle-speaker-badge ${activeSubtitle.speaker}`}
                          style={{ marginLeft: 4 }}
                        >
                          {activeSubtitle.speaker === "you" ? (
                            <>
                              <Mic style={{ width: 11, height: 11 }} /> You
                            </>
                          ) : (
                            <>
                              <Users style={{ width: 11, height: 11 }} /> Partner
                            </>
                          )}
                        </span>
                      ) : null}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {/* Language Selector */}
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Globe style={{ width: 12, height: 12, color: "var(--text-subtle)" }} />
                        <select
                          value={subtitleLanguage}
                          onChange={(e) => setSubtitleLanguage(e.target.value)}
                          style={{
                            background: "rgba(0,0,0,0.5)",
                            border: "1px solid var(--border-color)",
                            borderRadius: 4,
                            color: "var(--text-main)",
                            fontSize: "0.68rem",
                            padding: "2px 6px",
                            cursor: "pointer",
                          }}
                        >
                          <option value="en-US">English (US)</option>
                          <option value="en-GB">English (UK)</option>
                          <option value="ur-PK">Urdu</option>
                          <option value="hi-IN">Hindi</option>
                          <option value="es-ES">Spanish</option>
                          <option value="fr-FR">French</option>
                          <option value="de-DE">German</option>
                          <option value="ar-SA">Arabic</option>
                          <option value="zh-CN">Chinese</option>
                        </select>
                      </div>

                      {/* Cinema mode toggle */}
                      <button
                        onClick={() => setSubtitleCinemaMode(!subtitleCinemaMode)}
                        className="btn-secondary"
                        style={{ padding: "3px 6px", fontSize: "0.68rem" }}
                        title={subtitleCinemaMode ? "Normal Subtitle Size" : "Cinema Large Size"}
                      >
                        {subtitleCinemaMode ? (
                          <Minimize2 style={{ width: 12, height: 12 }} />
                        ) : (
                          <Maximize2 style={{ width: 12, height: 12 }} />
                        )}
                      </button>

                      <button
                        onClick={() => setSubtitlesEnabled(!subtitlesEnabled)}
                        className="btn-secondary"
                        style={{ padding: "3px 8px", fontSize: "0.68rem" }}
                      >
                        Hide
                      </button>
                    </div>
                  </div>

                  <div className="subtitle-body">
                    {activeSubtitle ? (
                      <div className="subtitle-content">
                        <div className={`subtitle-text ${subtitleCinemaMode ? "large" : ""}`}>
                          {activeSubtitle.text ? (
                            <span>{activeSubtitle.text} </span>
                          ) : null}
                          {activeSubtitle.interimText ? (
                            <span className="subtitle-interim">{activeSubtitle.interimText}</span>
                          ) : null}
                        </div>
                      </div>
                    ) : telemetry.is_speaking ? (
                      <div className="subtitle-content">
                        <div className="subtitle-speaker-badge you">
                          <Mic style={{ width: 11, height: 11 }} /> You (Speaking)
                        </div>
                        <div className={`subtitle-text ${subtitleCinemaMode ? "large" : ""}`} style={{ color: "#cbd5e1", fontStyle: "italic", display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--accent-emerald)", boxShadow: "0 0 8px var(--accent-emerald)", animation: "pulse 1s infinite" }} />
                          Voice detected... transcribing speech live
                        </div>
                      </div>
                    ) : (
                      <div className="subtitle-idle">
                        <Activity style={{ width: 14, height: 14, color: "var(--accent-indigo-light)", animation: "pulse 2s infinite" }} />
                        <span>Awaiting speech... Speak into microphone or share meeting audio to see live subtitles.</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* SPEAKER NOTES & MEETING TRANSCRIPT CARD */}
            <div className="glass-panel notes-panel" style={{ padding: 20 }}>
              <div className="notes-header-bar">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "var(--radius-sm)",
                      background: "linear-gradient(135deg, var(--accent-indigo), var(--accent-violet))",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <FileText style={{ width: 16, height: 16, color: "#fff" }} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#fff" }}>
                        Live Speaker Notes & Transcript
                      </span>
                      <span className="badge-tag" style={{ fontSize: "0.68rem" }}>
                        {speakerNotes.length} notes &bull; {totalWords} words
                      </span>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-subtle)", marginTop: 2 }}>
                      Spoken words from you and the other person automatically recorded with timestamps.
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    onClick={copyAllNotes}
                    disabled={speakerNotes.length === 0}
                    className="btn-secondary"
                    style={{ padding: "5px 10px", fontSize: "0.72rem" }}
                    title="Copy all notes formatted to clipboard"
                  >
                    {copiedAll ? (
                      <>
                        <Check style={{ width: 12, height: 12, color: "var(--accent-emerald)" }} />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy style={{ width: 12, height: 12 }} />
                        Copy All
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => exportNotes("md")}
                    disabled={speakerNotes.length === 0}
                    className="btn-secondary"
                    style={{ padding: "5px 10px", fontSize: "0.72rem" }}
                    title="Export Markdown file (.md)"
                  >
                    <Download style={{ width: 12, height: 12 }} />
                    Export (.md)
                  </button>

                  <button
                    onClick={clearNotes}
                    disabled={speakerNotes.length === 0}
                    className="btn-secondary"
                    style={{ padding: "5px 8px", fontSize: "0.72rem" }}
                    title="Clear transcript"
                  >
                    <Trash2 style={{ width: 12, height: 12, color: "var(--accent-rose)" }} />
                  </button>
                </div>
              </div>

              {/* Filter and Search Bar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div className="notes-filter-pills">
                  <button
                    onClick={() => setNotesFilter("all")}
                    className={`filter-pill ${notesFilter === "all" ? "active" : ""}`}
                  >
                    All Speakers ({speakerNotes.length})
                  </button>
                  <button
                    onClick={() => setNotesFilter("you")}
                    className={`filter-pill ${notesFilter === "you" ? "active" : ""}`}
                  >
                    You ({speakerNotes.filter((n) => n.speaker === "you").length})
                  </button>
                  <button
                    onClick={() => setNotesFilter("partner")}
                    className={`filter-pill ${notesFilter === "partner" ? "active" : ""}`}
                  >
                    Partner ({speakerNotes.filter((n) => n.speaker === "partner").length})
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
                  <Search style={{ width: 12, height: 12, color: "var(--text-subtle)", position: "absolute", left: 8 }} />
                  <input
                    type="text"
                    placeholder="Search notes..."
                    value={notesSearch}
                    onChange={(e) => setNotesSearch(e.target.value)}
                    style={{
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      padding: "4px 8px 4px 26px",
                      fontSize: "0.72rem",
                      color: "var(--text-main)",
                      width: 140,
                    }}
                  />
                  {notesSearch && (
                    <button
                      onClick={() => setNotesSearch("")}
                      style={{ background: "transparent", border: "none", color: "var(--text-subtle)", cursor: "pointer", fontSize: "0.7rem" }}
                    >
                      &times;
                    </button>
                  )}
                </div>
              </div>

              {/* Notes Feed */}
              <div className="notes-feed-container">
                {filteredNotes.length === 0 ? (
                  <div className="notes-empty">
                    <FileText style={{ width: 28, height: 28, color: "var(--text-subtle)", opacity: 0.5 }} />
                    <div style={{ fontWeight: 600, color: "var(--text-muted)", fontSize: "0.85rem" }}>
                      {notesSearch ? "No matching speaker notes found" : "No Speaker Notes Recorded Yet"}
                    </div>
                    <div style={{ fontSize: "0.72rem", maxWidth: 380, lineHeight: 1.5 }}>
                      Click <strong>&quot;Engage Engine&quot;</strong> to transcribe your voice, or click <strong>&quot;Share Meeting Audio&quot;</strong> to capture and log the other person&apos;s speech live!
                    </div>
                  </div>
                ) : (
                  <>
                    {filteredNotes.map((note) => (
                      <div key={note.id} className={`note-item ${note.speaker}`}>
                        <div className={`note-avatar-wrapper ${note.speaker}`}>
                          {note.speaker === "you" ? (
                            <Mic style={{ width: 14, height: 14 }} />
                          ) : (
                            <Users style={{ width: 14, height: 14 }} />
                          )}
                        </div>

                        <div className="note-content-body">
                          <div className="note-meta">
                            <span className={`note-speaker-name ${note.speaker}`}>
                              {note.speaker === "you" ? "You (Microphone)" : "Partner (Meeting Audio)"}
                            </span>
                            <span className="note-timestamp">{note.timestamp}</span>
                          </div>
                          <div className="note-text-body">{note.text}</div>
                        </div>

                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(note.text);
                          }}
                          className="btn-secondary"
                          style={{ alignSelf: "flex-start", padding: "4px 6px", opacity: 0.6 }}
                          title="Copy this note"
                        >
                          <Copy style={{ width: 10, height: 10 }} />
                        </button>
                      </div>
                    ))}

                    {/* Live in-progress preview if active */}
                    {activeSubtitle && activeSubtitle.interimText && (
                      <div className={`note-item ${activeSubtitle.speaker}`} style={{ opacity: 0.75, borderStyle: "dashed" }}>
                        <div className={`note-avatar-wrapper ${activeSubtitle.speaker}`}>
                          <Activity style={{ width: 14, height: 14, animation: "pulse 1s infinite" }} />
                        </div>
                        <div className="note-content-body">
                          <div className="note-meta">
                            <span className={`note-speaker-name ${activeSubtitle.speaker}`}>
                              {activeSubtitle.speaker === "you" ? "You (Speaking now...)" : "Partner (Speaking now...)"}
                            </span>
                            <span className="note-timestamp" style={{ fontStyle: "italic" }}>live</span>
                          </div>
                          <div className="note-text-body" style={{ fontStyle: "italic", color: "#94a3b8" }}>
                            {activeSubtitle.interimText}
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={notesFeedEndRef} />
                  </>
                )}
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

              {/* Meeting / Partner Audio (The Next Person) */}
              <div className="partner-connect-box" style={{ marginTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
                    <Users style={{ width: 14, height: 14, color: "var(--accent-emerald)" }} />
                    Partner Audio (The Next Person)
                  </span>

                  {isPartnerCapturing && (
                    <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#6ee7b7", background: "rgba(16,185,129,0.2)", padding: "2px 8px", borderRadius: 9999, border: "1px solid rgba(16,185,129,0.4)" }}>
                      ● Meeting Audio Connected
                    </span>
                  )}
                </div>

                <div style={{ fontSize: "0.7rem", color: "var(--text-subtle)", lineHeight: 1.4 }}>
                  Capture incoming audio from Zoom, Microsoft Teams, Google Meet, or browser tabs for instant partner subtitles and speaker notes.
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  {isPartnerCapturing ? (
                    <button
                      onClick={stopCapturePartnerAudio}
                      className="btn-primary btn-danger"
                      style={{ width: "100%", justifyContent: "center", padding: "8px 12px", fontSize: "0.75rem" }}
                    >
                      <StopCircle style={{ width: 14, height: 14 }} />
                      Disconnect Partner Audio
                    </button>
                  ) : (
                    <button
                      onClick={startCapturePartnerAudio}
                      className="btn-primary"
                      style={{ width: "100%", justifyContent: "center", padding: "8px 12px", fontSize: "0.75rem", background: "linear-gradient(135deg, var(--accent-emerald), #059669)" }}
                    >
                      <Share2 style={{ width: 14, height: 14 }} />
                      Share Meeting / Tab Audio
                    </button>
                  )}
                </div>

                {/* Speaker Attribution Test Switcher */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 6, fontSize: "0.7rem" }}>
                  <span style={{ color: "var(--text-subtle)" }}>Speaker Attribution:</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => setManualSpeakerMode("auto")}
                      style={{
                        padding: "2px 8px",
                        fontSize: "0.68rem",
                        borderRadius: 4,
                        border: "1px solid",
                        background: manualSpeakerMode === "auto" ? "var(--accent-indigo)" : "transparent",
                        borderColor: manualSpeakerMode === "auto" ? "var(--accent-indigo)" : "var(--border-color)",
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      Auto
                    </button>
                    <button
                      onClick={() => setManualSpeakerMode("you")}
                      style={{
                        padding: "2px 8px",
                        fontSize: "0.68rem",
                        borderRadius: 4,
                        border: "1px solid",
                        background: manualSpeakerMode === "you" ? "rgba(99,102,241,0.3)" : "transparent",
                        borderColor: manualSpeakerMode === "you" ? "var(--accent-indigo)" : "var(--border-color)",
                        color: "#818cf8",
                        cursor: "pointer",
                      }}
                    >
                      You
                    </button>
                    <button
                      onClick={() => setManualSpeakerMode("partner")}
                      style={{
                        padding: "2px 8px",
                        fontSize: "0.68rem",
                        borderRadius: 4,
                        border: "1px solid",
                        background: manualSpeakerMode === "partner" ? "rgba(16,185,129,0.3)" : "transparent",
                        borderColor: manualSpeakerMode === "partner" ? "var(--accent-emerald)" : "var(--border-color)",
                        color: "#6ee7b7",
                        cursor: "pointer",
                      }}
                    >
                      Partner
                    </button>
                  </div>
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
