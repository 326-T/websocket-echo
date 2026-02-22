import React from "react";
import "./App.css";
import { useAudioEcho } from "./useAudioEcho";

function App() {
  const { status, start, stop } = useAudioEcho("ws://localhost:8000/ws");

  return (
    <div className="App">
      <header className="App-header">
        <h1>WebSocket Audio Echo</h1>
        <p>
          {status === "listening"
            ? "Listening..."
            : status === "speaking"
              ? "Speaking..."
              : "Ready"}
        </p>
        {status === "idle" ? (
          <button className="btn" onClick={start}>
            Start
          </button>
        ) : (
          <button className="btn btn-stop" onClick={stop}>
            Stop
          </button>
        )}
        <p className="hint">
          Start → 喋ると無音検知後に自動でおうむ返しされます
        </p>
      </header>
    </div>
  );
}

export default App;
