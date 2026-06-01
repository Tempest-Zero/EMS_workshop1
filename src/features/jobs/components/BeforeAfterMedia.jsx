import { Video, Camera, Trash2, Check, AlertTriangle } from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import { Card, SectionHeader } from "@shared/ui/primitives";
import { jobMedia, hasVideo, missingReadyMedia } from "@features/jobs/lib/media";

const PHASES = [
  { key: "before", label: "Before", hint: "Show the fault — appliance running / the problem" },
  { key: "after", label: "After", hint: "Show it working correctly after the repair" },
];

function makeItem(file) {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      Math.random().toString(36).slice(2) + Date.now().toString(36),
    type: file.type.startsWith("video") ? "video" : "photo",
    url: URL.createObjectURL(file),
    name: file.name,
    ts: new Date().toISOString(),
  };
}

function PhaseColumn({ job, phase, label, hint, canCapture }) {
  const { addJobMedia, removeJobMedia } = useApp();
  const items = jobMedia(job, phase);
  const videoOk = hasVideo(job, phase);

  const onPick = (e) => {
    Array.from(e.target.files || []).forEach((f) => addJobMedia(job.id, phase, makeItem(f)));
    e.target.value = ""; // let the same file be picked again
  };

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-800">{label}</div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
            videoOk ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {videoOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {videoOk ? "Video added" : "Video needed"}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-slate-400">{hint}</div>

      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((m) => (
          <div
            key={m.id}
            className="group relative h-24 w-24 overflow-hidden rounded-lg border border-slate-200 bg-slate-900"
          >
            {m.type === "video" ? (
              <video src={m.url} controls className="h-full w-full object-cover" />
            ) : (
              <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
            )}
            <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-bold uppercase text-white">
              {m.type}
            </span>
            {canCapture && (
              <button
                type="button"
                onClick={() => removeJobMedia(job.id, phase, m.id)}
                className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                aria-label="Remove media"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <div className="flex h-24 w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
            No {label.toLowerCase()} media yet
          </div>
        )}
      </div>

      {canCapture && (
        <div className="mt-2 flex gap-2">
          <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
            <Video className="h-4 w-4" /> Record video
            <input
              type="file"
              accept="video/*"
              capture="environment"
              className="hidden"
              onChange={onPick}
            />
          </label>
          <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            <Camera className="h-4 w-4" /> Photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onPick}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export default function BeforeAfterMedia({ job, canCapture = false }) {
  const missing = missingReadyMedia(job);
  return (
    <Card className="p-4 md:p-5">
      <SectionHeader
        title="Before / After Proof"
        sub="A before & after video is required to mark the job Ready"
      />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {PHASES.map((p) => (
          <PhaseColumn
            key={p.key}
            job={job}
            phase={p.key}
            label={p.label}
            hint={p.hint}
            canCapture={canCapture}
          />
        ))}
      </div>
      {canCapture && (
        <div
          className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
            missing.length ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {missing.length ? (
            <>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              SOP: capture {missing.join(" and ")} to mark this job Ready.
            </>
          ) : (
            <>
              <Check className="h-4 w-4 shrink-0" />
              SOP complete — before &amp; after video captured.
            </>
          )}
        </div>
      )}
    </Card>
  );
}
