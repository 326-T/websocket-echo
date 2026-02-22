import asyncio
import base64
import json
import logging
import struct

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# VAD parameters (dialog_master の server_vad 設定に準拠)
SAMPLE_RATE = 24000
SILENCE_DURATION_MS = 900
ENERGY_THRESHOLD = 0.01  # RMS energy below this = silence


def compute_rms(pcm16_bytes: bytes) -> float:
    """PCM16 little-endian の RMS エネルギーを計算"""
    n_samples = len(pcm16_bytes) // 2
    if n_samples == 0:
        return 0.0
    total = 0.0
    for i in range(n_samples):
        sample = struct.unpack_from("<h", pcm16_bytes, i * 2)[0]
        total += (sample / 32768.0) ** 2
    return (total / n_samples) ** 0.5


@app.websocket("/ws")
async def websocket_echo(websocket: WebSocket) -> None:
    await websocket.accept()
    logger.info("WebSocket connected")

    audio_buffer: bytearray = bytearray()
    silence_samples = 0
    silence_threshold_samples = int(SAMPLE_RATE * SILENCE_DURATION_MS / 1000)
    is_speaking = False

    try:
        while True:
            message = json.loads(await websocket.receive_text())
            msg_type = message.get("type", "")

            if msg_type == "input_audio_buffer.append":
                pcm_bytes = base64.b64decode(message["audio"])
                rms = compute_rms(pcm_bytes)
                n_samples = len(pcm_bytes) // 2

                if rms >= ENERGY_THRESHOLD:
                    # 音声あり
                    if not is_speaking:
                        is_speaking = True
                        logger.info("Speech started")
                        await websocket.send_json(
                            {"type": "input_audio_buffer.speech_started"}
                        )
                    audio_buffer.extend(pcm_bytes)
                    silence_samples = 0
                else:
                    # 無音
                    if is_speaking:
                        audio_buffer.extend(pcm_bytes)
                        silence_samples += n_samples

                        if silence_samples >= silence_threshold_samples:
                            # 発話終了 → エコー返却
                            logger.info(
                                "Speech stopped, echo %d bytes", len(audio_buffer)
                            )
                            await websocket.send_json(
                                {"type": "input_audio_buffer.speech_stopped"}
                            )
                            await websocket.send_json(
                                {
                                    "type": "response.audio.delta",
                                    "delta": base64.b64encode(
                                        bytes(audio_buffer)
                                    ).decode(),
                                }
                            )
                            audio_buffer.clear()
                            silence_samples = 0
                            is_speaking = False
            else:
                logger.warning("Unknown message type: %s", msg_type)
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
