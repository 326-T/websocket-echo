import { useRef, useState, useCallback } from "react";

export type EchoStatus = "idle" | "listening" | "speaking";

const TARGET_SAMPLE_RATE = 24000;

/** Float32 PCM → 16-bit signed PCM (little-endian) */
function float32ToPcm16(samples: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s * (s < 0 ? 0x8000 : 0x7fff), true);
  }
  return buf;
}

/** 16-bit signed PCM (little-endian) → Float32 */
function pcm16ToFloat32(buf: ArrayBuffer): Float32Array {
  const view = new DataView(buf);
  const out = new Float32Array(buf.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

/** リニア補間でリサンプリング */
function resample(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const newLen = Math.round(samples.length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
  }
  return out;
}

/** ArrayBuffer → Base64 */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Base64 → ArrayBuffer */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function useAudioEcho(wsUrl: string) {
  const [status, setStatus] = useState<EchoStatus>("idle");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const srRef = useRef(48000);
  const nextPlayTimeRef = useRef(0);

  const playPcm16 = useCallback((b64: string) => {
    let playCtx = playCtxRef.current;
    if (!playCtx || playCtx.state === "closed") {
      playCtx = new AudioContext();
      playCtxRef.current = playCtx;
      nextPlayTimeRef.current = 0;
    }

    const pcm16 = base64ToArrayBuffer(b64);
    const float32 = pcm16ToFloat32(pcm16);

    const audioBuffer = playCtx.createBuffer(1, float32.length, TARGET_SAMPLE_RATE);
    audioBuffer.copyToChannel(float32, 0);

    const src = playCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(playCtx.destination);

    // チャンクを隙間なくスケジューリング
    const now = playCtx.currentTime;
    const startAt = Math.max(now, nextPlayTimeRef.current);
    nextPlayTimeRef.current = startAt + audioBuffer.duration;

    setStatus("speaking");
    src.onended = () => {
      // 次の再生が予約されていなければ listening に戻す
      if (playCtx && playCtx.currentTime >= nextPlayTimeRef.current - 0.01) {
        setStatus("listening");
      }
    };
    src.start(startAt);
  }, []);

  const start = useCallback(async () => {
    // 再生用 AudioContext をユーザー操作コンテキストで作成
    const playCtx = new AudioContext();
    playCtxRef.current = playCtx;
    nextPlayTimeRef.current = 0;

    const captureCtx = new AudioContext();
    audioCtxRef.current = captureCtx;
    srRef.current = captureCtx.sampleRate;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "response.audio.delta") {
          playPcm16(msg.delta);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onopen = () => {
      const micSrc = captureCtx.createMediaStreamSource(stream);
      sourceRef.current = micSrc;

      const proc = captureCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = proc;

      proc.onaudioprocess = (e) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const raw = new Float32Array(e.inputBuffer.getChannelData(0));
        const resampled = resample(raw, srRef.current, TARGET_SAMPLE_RATE);
        const pcm16 = float32ToPcm16(resampled);
        const b64 = arrayBufferToBase64(pcm16);

        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));

        e.outputBuffer.getChannelData(0).fill(0);
      };

      micSrc.connect(proc);
      proc.connect(captureCtx.destination);
      setStatus("listening");
    };
  }, [wsUrl, playPcm16]);

  const stop = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    wsRef.current?.close();
    audioCtxRef.current?.close();

    // 再生中の音を待ってから閉じる
    const playCtx = playCtxRef.current;
    if (playCtx && playCtx.state !== "closed") {
      const remaining = nextPlayTimeRef.current - playCtx.currentTime;
      if (remaining > 0) {
        setTimeout(() => {
          playCtx.close();
        }, remaining * 1000 + 100);
      } else {
        playCtx.close();
      }
    }

    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    wsRef.current = null;
    audioCtxRef.current = null;
    playCtxRef.current = null;

    setStatus("idle");
  }, []);

  return { status, start, stop } as const;
}
