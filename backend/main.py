from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def websocket_echo(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket connected")
    try:
        while True:
            data = await websocket.receive_bytes()
            print(f"Echo {len(data)} bytes")
            await websocket.send_bytes(data)
    except WebSocketDisconnect:
        print("WebSocket disconnected")
