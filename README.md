# WebSocket Audio Echo

マイクで録音した音声を WebSocket 経由でサーバーに送り、そのまま返して再生する（おうむ返し）アプリ。

## プロトコル

```
Client → Server:  { "type": "input_audio_buffer.append", "audio": "<base64 PCM16 24kHz>" }
Server → Client:  { "type": "response.audio.delta", "delta": "<base64 PCM16 24kHz>" }
```

## 起動

### Backend

```bash
cd backend
uv run uvicorn main:app --reload
```

http://localhost:8000

### Frontend

```bash
cd frontend
npm start
```

http://localhost:3000

## 使い方

1. ブラウザで http://localhost:3000 を開く
2. **Start** → マイクを許可して話す
3. **Stop** → サーバーからエコーされた音声が再生される

※ ヘッドホン推奨（スピーカーだとハウリングする）
