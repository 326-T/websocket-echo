import { useRef, useState, useCallback } from "react";

export type EchoStatus = "ready" | "recording" | "sending" | "playing";

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length;
  const dataBytes = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, "data");
  v.setUint32(40, dataBytes, true);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s * (s < 0 ? 0x8000 : 0x7fff), true);
  }

  return buf;
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

    const chunks = pcmRef.current;
    const len = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Float32Array(len);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }

    const wav = encodeWav(merged, srRef.current);
    const playCtx = new AudioContext();

    setStatus("sending");

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => ws.send(wav);
    ws.onmessage = async (ev) => {
      ws.close();
      try {
        const audioBuffer = await playCtx.decodeAudioData(ev.data.slice(0));
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
