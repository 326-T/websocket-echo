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
          {status === "recording"
            ? "Recording..."
            : status === "sending"
              ? "Sending..."
              : status === "playing"
                ? "Playing back..."
                : "Ready"}
        </p>
        {status === "ready" && (
          <button className="btn" onClick={start}>
            Start
          </button>
        )}
        {status === "recording" && (
          <button className="btn btn-stop" onClick={stop}>
            Stop
          </button>
        )}
        <p className="hint">
          Start → speak → Stop で、おうむ返しが再生されます
        </p>
      </header>
    </div>
  );
}

export default App;
