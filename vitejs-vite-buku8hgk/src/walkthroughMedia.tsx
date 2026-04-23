import { useState, useEffect, useRef, type CSSProperties } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIFinding, WalkthroughFlag, PendingWalkthroughJob, VideoBurstMeta } from "./walkthroughTypes";

export const WALKTHROUGH_PENDING_KEY = "fliplogic_walkthrough_pending";
export const WALKTHROUGH_TRIGGER_KEY = "fliplogic_walkthrough_trigger_phrase";

export function loadPendingJobs(): PendingWalkthroughJob[] {
  try {
    const raw = localStorage.getItem(WALKTHROUGH_PENDING_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export function savePendingJobs(jobs: PendingWalkthroughJob[]) {
  localStorage.setItem(WALKTHROUGH_PENDING_KEY, JSON.stringify(jobs));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function pickAudioMime(): string {
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  return "audio/webm";
}

function pickVideoMime(): string {
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")) return "video/webm;codecs=vp8,opus";
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")) return "video/webm;codecs=vp9,opus";
  return "video/webm";
}

function formatRecTime(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type RecMode = "audio" | "video" | "audiovideo";
type RecPhase = "idle" | "recording" | "paused" | "stopped";

function uid() {
  return crypto.randomUUID();
}

/** Minimal deal shape for AI trial / subscription gating (mirrors App Deal) */
export type AIGateDeal = { id: string; aiAnalysisUsed?: boolean };

export function WalkthroughMediaRecorder({
  mode,
  address,
  buildYear,
  isMobile,
  supabase,
  triggerPhrase,
  onFindings,
  onAnalyzing,
  dealId,
  userId,
  currentDeal,
  canUseAI,
  triggerAIUse,
  onNeedPaywall,
}: {
  mode: RecMode;
  address: string;
  buildYear: number;
  isMobile: boolean;
  supabase: SupabaseClient;
  triggerPhrase: string;
  onFindings: (f: AIFinding[]) => void;
  onAnalyzing: (b: boolean) => void;
  dealId: string;
  userId: string;
  currentDeal: AIGateDeal;
  canUseAI: (deal: AIGateDeal) => boolean;
  triggerAIUse: (id: string) => Promise<void>;
  onNeedPaywall: (reason: string) => void;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [phase, setPhase] = useState<RecPhase>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [flags, setFlags] = useState<WalkthroughFlag[]>([]);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [storedLocal, setStoredLocal] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator !== "undefined" && navigator.onLine);
  const [mediaError, setMediaError] = useState("");
  const [analyzeError, setAnalyzeError] = useState("");
  const [transcriptPieces, setTranscriptPieces] = useState<string[]>([]);
  const [burstList, setBurstList] = useState<VideoBurstMeta[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("");
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const tickRef = useRef<number | null>(null);
  const sessionStartRef = useRef(0);
  const pausedAccumMsRef = useRef(0);
  const pauseStartedRef = useRef<number | null>(null);
  const speechRef = useRef<{ stop: () => void; start: () => void } | null>(null);
  const lastVoiceFlagRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const framesRef = useRef<string[]>([]);
  const stoppedBlobRef = useRef<Blob | null>(null);
  const avBurstsRef = useRef<VideoBurstMeta[]>([]);
  const avAudioChunksRef = useRef<Blob[]>([]);
  const avAudioRecorderRef = useRef<MediaRecorder | null>(null);
  const burstRecorderRef = useRef<MediaRecorder | null>(null);
  const burstChunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const phraseNorm = triggerPhrase.trim().toLowerCase() || "flag this";

  useEffect(() => {
    const up = () => setOnline(navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", up); };
  }, []);

  const releaseWake = async () => {
    try { await wakeRef.current?.release(); } catch { /* ignore */ }
    wakeRef.current = null;
  };

  const stopTicks = () => {
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
  };

  const stopSpeech = () => {
    try { speechRef.current?.stop(); } catch { /* ignore */ }
    speechRef.current = null;
  };

  const stopFrameCapture = () => {
    if (frameTimerRef.current) { window.clearInterval(frameTimerRef.current); frameTimerRef.current = null; }
  };

  const currentElapsedSec = () => {
    if (sessionStartRef.current === 0) return 0;
    let extra = 0;
    if (pauseStartedRef.current != null) extra = Date.now() - pauseStartedRef.current;
    return (Date.now() - sessionStartRef.current - pausedAccumMsRef.current - extra) / 1000;
  };

  const pushFlag = (source: "manual" | "voice") => {
    const t = Math.max(0, phase === "stopped" ? elapsedSec : currentElapsedSec());
    setFlags((prev) => [...prev, { atSec: Math.round(t * 10) / 10, source }]);
  };

  const matchVoiceTrigger = (text: string) => {
    const t = text.toLowerCase();
    if (!phraseNorm) return false;
    return t.includes(phraseNorm);
  };

  const startSpeechListen = () => {
    const SR = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (ev: Event) => {
      const r = ev as unknown as { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> };
      let chunk = "";
      for (let i = r.resultIndex; i < r.results.length; i++) chunk += r.results[i][0].transcript;
      if (chunk) setTranscriptPieces((p) => [...p.slice(-40), chunk]);
      if (chunk && matchVoiceTrigger(chunk)) {
        const now = Date.now();
        if (now - lastVoiceFlagRef.current > 2500) {
          lastVoiceFlagRef.current = now;
          pushFlag("voice");
        }
      }
    };
    rec.onerror = () => { /* non-fatal */ };
    try { rec.start(); } catch { /* ignore */ }
    speechRef.current = { stop: () => { try { rec.stop(); } catch { /* ignore */ } }, start: () => { } };
  };

  const requestWake = async () => {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (wl?.request) wakeRef.current = await wl.request("screen");
    } catch { /* ignore */ }
  };

  const startTimer = () => {
    stopTicks();
    tickRef.current = window.setInterval(() => {
      setElapsedSec(currentElapsedSec());
    }, 250);
  };

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    videoStreamRef.current?.getTracks().forEach((t) => t.stop());
    videoStreamRef.current = null;
  };

  const captureFrameFromVideo = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || v.readyState < 2) return;
    const w = Math.min(640, v.videoWidth || 640);
    const h = Math.min(480, v.videoHeight || 480);
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    const b64 = c.toDataURL("image/jpeg", 0.72).split(",")[1];
    if (b64) framesRef.current.push(b64);
  };

  const startRecording = async () => {
    setMediaError(""); setAnalyzeError(""); setStoredLocal(false); setPlaybackUrl(null); stoppedBlobRef.current = null;
    setFlags([]); setElapsedSec(0); setTranscriptPieces([]);
    chunksRef.current = []; framesRef.current = []; avBurstsRef.current = []; avAudioChunksRef.current = []; setBurstList([]);
    sessionStartRef.current = Date.now();
    pausedAccumMsRef.current = 0;
    pauseStartedRef.current = null;
    lastVoiceFlagRef.current = 0;

    try {
      if (mode === "audio") {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mime = pickAudioMime();
        mimeRef.current = mime;
        const mr = new MediaRecorder(stream, { mimeType: mime });
        mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
        mr.onstop = () => { /* blob assembled in stopRecording */ };
        mr.start(250);
        recorderRef.current = mr;
      } else if (mode === "video") {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: true,
        });
        streamRef.current = stream;
        videoStreamRef.current = stream;
        const mime = pickVideoMime();
        mimeRef.current = mime;
        const mr = new MediaRecorder(stream, { mimeType: mime });
        mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
        mr.start(250);
        recorderRef.current = mr;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => { /* ignore */ });
        }
        frameTimerRef.current = window.setInterval(captureFrameFromVideo, 3000);
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: true,
        });
        streamRef.current = stream;
        videoStreamRef.current = stream;
        const aTracks = stream.getAudioTracks();
        const audioOnly = new MediaStream(aTracks);
        const amime = pickAudioMime();
        mimeRef.current = amime;
        const amr = new MediaRecorder(audioOnly, { mimeType: amime });
        amr.ondataavailable = (e) => { if (e.data.size) avAudioChunksRef.current.push(e.data); };
        amr.start(250);
        avAudioRecorderRef.current = amr;
        recorderRef.current = amr;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => { /* ignore */ });
        }
      }

      await requestWake();
      startSpeechListen();
      setPhase("recording");
      startTimer();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not access camera/microphone.";
      setMediaError(msg);
      cleanupStream();
      await releaseWake();
    }
  };

  const pauseRecording = () => {
    const mr = recorderRef.current;
    if (!mr || phase !== "recording") return;
    try {
      if (typeof (mr as MediaRecorder & { pause?: () => void }).pause === "function") (mr as MediaRecorder & { pause: () => void }).pause();
      if (mode === "audiovideo" && avAudioRecorderRef.current && avAudioRecorderRef.current !== mr) {
        const am = avAudioRecorderRef.current;
        if (typeof (am as MediaRecorder & { pause?: () => void }).pause === "function") (am as MediaRecorder & { pause: () => void }).pause();
      }
    } catch { /* ignore */ }
    pauseStartedRef.current = Date.now();
    stopTicks();
    if (mode === "video") stopFrameCapture();
    setElapsedSec(currentElapsedSec());
    setPhase("paused");
  };

  const resumeRecording = () => {
    const mr = recorderRef.current;
    if (!mr || phase !== "paused") return;
    if (pauseStartedRef.current != null) {
      pausedAccumMsRef.current += Date.now() - pauseStartedRef.current;
      pauseStartedRef.current = null;
    }
    try {
      if (typeof (mr as MediaRecorder & { resume?: () => void }).resume === "function") (mr as MediaRecorder & { resume: () => void }).resume();
      if (mode === "audiovideo" && avAudioRecorderRef.current) {
        const am = avAudioRecorderRef.current;
        if (typeof (am as MediaRecorder & { resume?: () => void }).resume === "function") (am as MediaRecorder & { resume: () => void }).resume();
      }
    } catch { /* ignore */ }
    setPhase("recording");
    startTimer();
    if (mode === "video" && !frameTimerRef.current) {
      frameTimerRef.current = window.setInterval(captureFrameFromVideo, 3000);
    }
  };

  const stopRecording = () => {
    const mr = recorderRef.current;
    const finish = (blob: Blob) => {
      stoppedBlobRef.current = blob;
      setPlaybackUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      stopTicks();
      stopSpeech();
      stopFrameCapture();
      void releaseWake();
      cleanupStream();
      if (videoRef.current) videoRef.current.srcObject = null;
      setPhase("stopped");
      setElapsedSec(Math.max(0, currentElapsedSec()));
      if (!navigator.onLine) {
        setStoredLocal(true);
        void queueOffline(blob);
      }
    };

    if (mode === "audiovideo" && avAudioRecorderRef.current) {
      const am = avAudioRecorderRef.current;
      am.onstop = () => {
        const audioBlob = new Blob(avAudioChunksRef.current, { type: mimeRef.current || pickAudioMime() });
        finish(audioBlob);
      };
      try { am.stop(); } catch { finish(new Blob(avAudioChunksRef.current, { type: mimeRef.current })); }
      avAudioRecorderRef.current = null;
      recorderRef.current = null;
      return;
    }

    if (!mr) {
      stopTicks(); stopSpeech(); stopFrameCapture(); void releaseWake(); cleanupStream();
      setPhase("idle");
      return;
    }
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || (mode === "video" ? pickVideoMime() : pickAudioMime()) });
      finish(blob);
    };
    try { mr.stop(); } catch { finish(new Blob(chunksRef.current, { type: mimeRef.current })); }
    recorderRef.current = null;
  };

  const queueOffline = async (blob: Blob) => {
    const b64 = await blobToBase64(blob);
    const flagTimestamps = flags.map((f) => f.atSec);
    const transcript = transcriptPieces.join(" ");
    const job: PendingWalkthroughJob = {
      id: uid(),
      mode,
      createdAt: new Date().toISOString(),
      label: `${mode} · ${new Date().toLocaleString()}`,
      payload: {
        propertyAddress: address,
        buildYear,
        mode,
        mimeType: mimeRef.current,
        audioBase64: mode === "audio" || mode === "audiovideo" ? b64 : undefined,
        videoBase64: mode === "video" ? b64 : undefined,
        framesBase64: mode === "video" ? [...framesRef.current] : undefined,
        flagTimestamps,
        transcript,
        videoBursts: mode === "audiovideo" ? [...avBurstsRef.current] : undefined,
      },
    };
    const next = [...loadPendingJobs(), job];
    savePendingJobs(next);
  };

  const runAnalyze = async (body: Record<string, unknown>) => {
    setAnalyzeError("");
    setAnalyzing(true);
    onAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-walkthrough", { body });
      if (error) {
        const detail = (error as unknown as { context?: { json?: () => Promise<unknown> } }).context?.json
          ? JSON.stringify(await (error as unknown as { context: { json: () => Promise<unknown> } }).context.json())
          : error.message || String(error);
        throw new Error(detail);
      }
      const findings = (data as { findings?: AIFinding[]; error?: string })?.findings;
      const serverError = (data as { error?: string })?.error;
      if (serverError) throw new Error(serverError);
      if (!findings || !Array.isArray(findings)) throw new Error("Invalid response: " + JSON.stringify(data));
      onFindings(findings);
      try {
        await supabase.from("walkthrough_findings").insert({
          deal_id: dealId,
          user_id: userId,
          mode: mode,
          findings: findings,
          transcript: transcriptPieces.join(" ").trim(),
          created_at: new Date().toISOString(),
        });
      } catch (saveErr) {
        console.error("Could not save findings:", saveErr);
      }
      try {
        await triggerAIUse(dealId);
      } catch (tuErr) {
        console.error("triggerAIUse after walkthrough:", tuErr);
      }
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
      onAnalyzing(false);
    }
  };

  const analyzeFromStopped = async () => {
    if (!navigator.onLine) {
      setAnalyzeError("You are offline. Recording is queued — connect and use Sync from the list below.");
      return;
    }
    if (!canUseAI(currentDeal)) {
      onNeedPaywall("AI Walkthrough requires Investor plan or a free trial analysis");
      return;
    }
    try {
      const blob = stoppedBlobRef.current;
      if (mode === "audio") {
        if (!blob) throw new Error("No recording to analyze");
        const audioBase64 = await blobToBase64(blob);
        console.log("TRANSCRIPT DEBUG:", transcriptPieces.length, "pieces:", transcriptPieces.join(" ").trim().slice(0, 200));
        await runAnalyze({
          mode: "audio",
          propertyAddress: address,
          buildYear,
          mimeType: blob.type || pickAudioMime(),
          audioBase64,
          flagTimestamps: flags.map((f) => f.atSec),
          transcript: transcriptPieces.join(" ").trim(),
        });
        return;
      }
      if (mode === "video") {
        if (!blob) throw new Error("No recording");
        const videoBase64 = await blobToBase64(blob);
        console.log("TRANSCRIPT DEBUG:", transcriptPieces.length, "pieces:", transcriptPieces.join(" ").trim().slice(0, 200));
        await runAnalyze({
          mode: "video",
          propertyAddress: address,
          buildYear,
          framesBase64: framesRef.current,
          videoBase64,
          mimeType: blob.type || pickVideoMime(),
          flagTimestamps: flags.map((f) => f.atSec),
          transcript: transcriptPieces.join(" ").trim(),
        });
        return;
      }
      if (!blob) throw new Error("No audio track");
      const audioBase64 = await blobToBase64(blob);
      console.log("TRANSCRIPT DEBUG:", transcriptPieces.length, "pieces:", transcriptPieces.join(" ").trim().slice(0, 200));
      await runAnalyze({
        mode: "audiovideo",
        propertyAddress: address,
        buildYear,
        audioBase64,
        mimeType: blob.type || pickAudioMime(),
        videoBursts: [...avBurstsRef.current],
        flagTimestamps: flags.map((f) => f.atSec),
        transcript: transcriptPieces.join(" ").trim(),
      });
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed");
    }
  };

  const captureBurst = async () => {
    if (mode !== "audiovideo" || phase !== "recording") return;
    const vs = videoStreamRef.current || streamRef.current;
    if (!vs) return;
    const vtrack = vs.getVideoTracks()[0];
    const atrack = vs.getAudioTracks()[0];
    const burstStream = new MediaStream([vtrack, atrack].filter(Boolean) as MediaStreamTrack[]);
    const mime = pickVideoMime();
    burstChunksRef.current = [];
    const br = new MediaRecorder(burstStream, { mimeType: mime });
    burstRecorderRef.current = br;
    br.ondataavailable = (e) => { if (e.data.size) burstChunksRef.current.push(e.data); };
    br.start(200);
    window.setTimeout(() => {
      br.onstop = () => {
        void blobToBase64(new Blob(burstChunksRef.current, { type: mime })).then((b64) => {
          const meta: VideoBurstMeta = {
            atSec: Math.round(currentElapsedSec() * 10) / 10,
            base64: b64,
            mimeType: mime,
          };
          avBurstsRef.current = [...avBurstsRef.current, meta];
          setBurstList([...avBurstsRef.current]);
        });
        burstRecorderRef.current = null;
      };
      try { br.stop(); } catch { /* ignore */ }
    }, 5000);
  };

  useEffect(() => () => {
    stopTicks(); stopSpeech(); stopFrameCapture(); void releaseWake();
    cleanupStream();
    setPlaybackUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const btn: CSSProperties = {
    minHeight: 60,
    borderRadius: 10,
    border: "none",
    fontWeight: 700,
    fontFamily: "'Syne', sans-serif",
    cursor: "pointer",
    fontSize: isMobile ? 15 : 14,
    padding: "0 16px",
  };

  const recordingDot = phase === "recording" ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#f87171", fontSize: 13, fontWeight: 700 }}>
      <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ef4444", animation: "wtPulse 1.2s ease-in-out infinite" }} />
      REC
    </span>
  ) : phase === "paused" ? (
    <span style={{ color: "#fbbf24", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#fbbf24" }} />
      PAUSED
    </span>
  ) : (
    <span style={{ color: "#64748b", fontSize: 12 }}>Ready</span>
  );

  return (
    <div>
      <style>{`@keyframes wtPulse { 0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.5;transform:scale(0.92)} }
@keyframes wtAnalyzeHintPulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
.wt-analyze-hint { animation: wtAnalyzeHintPulse 1.8s ease-in-out infinite; }`}</style>
      {!online && (
        <div style={{ background: "#2d2000", border: "1px solid #d97706", borderRadius: 8, padding: 12, marginBottom: 12, color: "#fbbf24", fontSize: 13 }}>
          Offline — new recordings will be stored locally until you reconnect.
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14 }}>
        {recordingDot}
        <span style={{ fontFamily: "monospace", fontSize: 22, color: "#f1f5f9" }}>{formatRecTime(Math.max(0, elapsedSec))}</span>
      </div>

      {(mode === "video" || mode === "audiovideo") && (
        <div style={{ marginBottom: 14, borderRadius: 10, overflow: "hidden", border: "1px solid #1e293b", background: "#000", maxHeight: 360 }}>
          <video ref={videoRef} playsInline muted autoPlay style={{ width: "100%", display: "block", maxHeight: 340, objectFit: "cover" }} />
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {phase === "idle" && (
          <button type="button" onClick={() => void startRecording()} style={{ ...btn, width: "100%", background: "linear-gradient(135deg, #dc2626, #991b1b)", color: "#fff" }}>
            ● Record
          </button>
        )}
        {phase === "recording" && (
          <>
            <button type="button" onClick={() => pauseRecording()} style={{ ...btn, width: "100%", background: "#422006", color: "#fde68a" }}>⏸ Pause</button>
            <button type="button" onClick={() => pushFlag("manual")} style={{ ...btn, width: "100%", background: "#1e3a5f", color: "#93c5fd" }}>🚩 Flag This</button>
            {mode === "audiovideo" && (
              <button type="button" onClick={() => void captureBurst()} style={{ ...btn, width: "100%", background: "linear-gradient(135deg, #7c3aed, #5b21b6)", color: "#fff" }}>
                🎥 Capture Video (5s)
              </button>
            )}
            <button type="button" onClick={() => stopRecording()} style={{ ...btn, width: "100%", background: "#334155", color: "#e2e8f0" }}>■ Stop</button>
          </>
        )}
        {phase === "paused" && (
          <>
            <button type="button" onClick={() => resumeRecording()} style={{ ...btn, width: "100%", background: "#14532d", color: "#bbf7d0" }}>▶ Resume</button>
            <button type="button" onClick={() => pushFlag("manual")} style={{ ...btn, width: "100%", background: "#1e3a5f", color: "#93c5fd" }}>🚩 Flag This</button>
            <button type="button" onClick={() => stopRecording()} style={{ ...btn, width: "100%", background: "#334155", color: "#e2e8f0" }}>■ Stop</button>
          </>
        )}
      </div>

      {storedLocal && phase === "stopped" && (
        <div style={{ background: "#0c1a2e", border: "1px solid #3b82f6", borderRadius: 8, padding: 12, marginBottom: 12, color: "#93c5fd", fontSize: 13 }}>
          Stored locally — waiting for connection. Use Sync below when online.
        </div>
      )}

      {phase === "stopped" && playbackUrl && mode !== "audiovideo" && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, textTransform: "uppercase" }}>Playback</div>
          {mode === "audio" ? (
            <audio controls src={playbackUrl} style={{ width: "100%", minHeight: 48 }} />
          ) : (
            <video controls src={playbackUrl} style={{ width: "100%", maxHeight: 280, borderRadius: 8 }} />
          )}
        </div>
      )}
      {phase === "stopped" && mode === "audiovideo" && playbackUrl && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, textTransform: "uppercase" }}>Audio timeline</div>
          <audio controls src={playbackUrl} style={{ width: "100%", minHeight: 48 }} />
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 10, marginBottom: 6 }}>Video bursts ({burstList.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {burstList.map((b, i) => (
              <video key={i} controls src={`data:${b.mimeType};base64,${b.base64}`} style={{ width: "100%", maxHeight: 200, borderRadius: 8 }} />
            ))}
          </div>
        </div>
      )}

      {flags.length > 0 && phase === "stopped" && (
        <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase" }}>Flagged timestamps</div>
          {flags.map((f, i) => (
            <div key={i} style={{ fontSize: 13, color: "#e2e8f0", marginBottom: 4 }}>
              {formatRecTime(f.atSec)} · {f.source === "voice" ? "🎤 voice" : "👆 manual"}
            </div>
          ))}
        </div>
      )}

      {phase === "stopped" && (stoppedBlobRef.current || mode === "audiovideo") && (
        <>
          <button
            type="button"
            disabled={!navigator.onLine || analyzing}
            onClick={() => void analyzeFromStopped()}
            style={{ ...btn, width: "100%", marginBottom: analyzing ? 0 : 12, background: navigator.onLine && !analyzing ? "linear-gradient(135deg, #7c3aed, #6d28d9)" : "#1e293b", color: "#fff", opacity: navigator.onLine && !analyzing ? 1 : 0.5, cursor: analyzing ? "wait" : "pointer" }}
          >
            {analyzing ? "🔍 Analyzing... this may take 20-30 seconds" : "Analyze walkthrough"}
          </button>
          {analyzing && (
            <div className="wt-analyze-hint" style={{ textAlign: "center", marginTop: 10, marginBottom: 12, fontSize: 13, color: "#94a3b8" }} role="status">
              Transcribing audio → Generating scope items...
            </div>
          )}
        </>
      )}

      {mediaError && <div style={{ color: "#f87171", marginBottom: 10, fontSize: 13 }}>{mediaError}</div>}
      {analyzeError && <div style={{ color: "#f87171", marginBottom: 10, fontSize: 13 }}>{analyzeError}</div>}
    </div>
  );
}
