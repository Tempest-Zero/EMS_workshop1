/**
 * Before/After media gallery for a job, read live from the media API. Photos
 * render as thumbnails (click to open full size); videos render as inline
 * players. Capture happens in the technician app — this is the manager-side
 * view of it.
 */

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchJobMedia } from "../data/mediaApi";

function Tile({ item }) {
  const url = item.playback_url;
  const base = "h-24 w-24 shrink-0 rounded-lg border border-slate-200 object-cover";

  if (!url) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 bg-slate-50 text-[10px] font-semibold text-slate-400 ${base}`}
      >
        Uploading…
      </div>
    );
  }
  if (item.type === "video") {
    return <video src={url} controls preload="metadata" className={`bg-black ${base}`} />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" title="Open full size">
      <img src={url} alt={`${item.phase} ${item.type}`} className={base} />
    </a>
  );
}

function Group({ title, items }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {items.length === 0 ? (
          <span className="text-xs italic text-slate-400">No {title.toLowerCase()} media yet</span>
        ) : (
          items.map((m) => <Tile key={m.id} item={m} />)
        )}
      </div>
    </div>
  );
}

export default function JobMediaGallery({ jobKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);
  // Bumping this re-runs the fetch effect (manual refresh).
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!jobKey) return undefined;
    let cancelled = false;
    fetchJobMedia(jobKey)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobKey, nonce]);

  const refresh = () => {
    setBusy(true);
    setNonce((n) => n + 1);
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
          Photos &amp; Video
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-400">
        Captured from the technician app · job <span className="font-mono">{jobKey}</span>
      </p>

      {error ? (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          Couldn’t load media: {error}
        </div>
      ) : null}

      {data ? (
        <div className="mt-3 space-y-3">
          <Group title="Before" items={data.before} />
          <Group title="After" items={data.after} />
          {data.closing?.length > 0 ? <Group title="Closing" items={data.closing} /> : null}
        </div>
      ) : busy ? (
        <div className="mt-2 text-sm text-slate-400">Loading…</div>
      ) : null}
    </div>
  );
}
