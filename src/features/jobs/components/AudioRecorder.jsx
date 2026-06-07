/**
 * Voice-note recorder for the work-completion form (Module 3 "Remarks — audio").
 * Uses the browser MediaRecorder API; the clip is kept as an in-memory object
 * URL for playback. Uploading the audio to storage is a post-demo step — the
 * value shape ({ url, durationMs }) is what a real upload would replace.
 */

import { useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";

function fmtDur(ms) {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function AudioRecorder({ value, onChange }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedRef = useRef(0);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        const durationMs = Date.now() - startedRef.current;
        stream.getTracks().forEach((t) => t.stop());
        onChange({ url, durationMs });
      };
      startedRef.current = Date.now();
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("Microphone unavailable or permission denied.");
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  return (
    <div className="space-y-2">
      {error ? <div className="text-xs font-semibold text-red-600">{error}</div> : null}

      {value?.url ? (
        <div className="flex items-center gap-2">
          <audio controls src={value.url} className="h-9 w-full" />
          <span className="shrink-0 text-xs font-semibold text-slate-400">
            {fmtDur(value.durationMs)}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
            aria-label="Delete voice note"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ) : recording ? (
        <button
          type="button"
          onClick={stop}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white"
        >
          <Square className="h-4 w-4" /> Stop recording…
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-600 hover:border-slate-400"
        >
          <Mic className="h-4 w-4" /> Record voice note
        </button>
      )}
    </div>
  );
}
