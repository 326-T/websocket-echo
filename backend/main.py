import base64
import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def websocket_echo(websocket: WebSocket) -> None:
    await websocket.accept()
    logger.info("WebSocket connected")
    try:
        while True:
            message = json.loads(await websocket.receive_text())
            msg_type = message.get("type", "")

            if msg_type == "input_audio_buffer.append":
                audio_b64 = message["audio"]
                logger.info(
                    "Echo audio chunk, size=%d bytes",
                    len(base64.b64decode(audio_b64)),
                )
                await websocket.send_json(
                    {
                        "type": "response.audio.delta",
                        "delta": audio_b64,
                    }
                )
            else:
                logger.warning("Unknown message type: %s", msg_type)
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
