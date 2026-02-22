import { useRef, useState, useCallback } from "react";

export type EchoStatus = "ready" | "recording" | "sending" | "playing";

const TARGET_SAMPLE_RATE = 24000;

/** Float32 PCM を 16-bit signed PCM (little-endian) の ArrayBuffer に変換 */
function float32ToPcm16(samples: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s * (s < 0 ? 0x8000 : 0x7fff), true);
  }
  return buf;
}

/** 16-bit signed PCM (little-endian) の ArrayBuffer を Float32 に変換 */
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

/** ArrayBuffer → Base64 文字列 */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Base64 文字列 → ArrayBuffer */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function useAudioEcho(wsUrl: string) {
  const [status, setStatus] = useState<EchoStatus>("ready");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcmRef = useRef<Float32Array[]>([]);
  const srRef = useRef(48000);

  const start = useCallback(async () => {
    pcmRef.current = [];

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    srRef.current = ctx.sampleRate;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const src = ctx.createMediaStreamSource(stream);
    sourceRef.current = src;

    const proc = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = proc;

    proc.onaudioprocess = (e) => {
      pcmRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      e.outputBuffer.getChannelData(0).fill(0);
    };

    src.connect(proc);
    proc.connect(ctx.destination);
    setStatus("recording");
  }, []);

  const stop = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();

    // マージ
    const chunks = pcmRef.current;
    const len = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Float32Array(len);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }

    // 24kHz にリサンプル → PCM16 → Base64
    const resampled = resample(merged, srRef.current, TARGET_SAMPLE_RATE);
    const pcm16 = float32ToPcm16(resampled);
    const b64 = arrayBufferToBase64(pcm16);

    // 再生用 AudioContext をユーザー操作コンテキストで作成
    const playCtx = new AudioContext();

    setStatus("sending");

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: b64,
        }),
      );
    };

    ws.onmessage = (ev) => {
      ws.close();
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type !== "response.audio.delta") return;

        // Base64 → PCM16 → Float32
        const echoPcm16 = base64ToArrayBuffer(msg.delta);
        const echoFloat32 = pcm16ToFloat32(echoPcm16);

        // AudioBuffer を作って再生
        const audioBuffer = playCtx.createBuffer(
          1,
          echoFloat32.length,
          TARGET_SAMPLE_RATE,
        );
        audioBuffer.copyToChannel(echoFloat32, 0);

        const src = playCtx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(playCtx.destination);
        setStatus("playing");
        src.onended = () => {
          playCtx.close();
          setStatus("ready");
        };
        src.start();
      } catch (e) {
        console.error("Playback failed:", e);
        playCtx.close();
        setStatus("ready");
      }
    };
  }, [wsUrl]);

  return { status, start, stop } as const;
}
