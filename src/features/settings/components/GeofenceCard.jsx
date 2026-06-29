/**
 * Manager geofence editor. Reads + writes the live attendance geofence
 * (`GET/PUT /api/attendance/geofences`) — the circle a punch's GPS is checked
 * against. The geofence only *flags* off-site punches; it never blocks them.
 *
 * The Leaflet map and the manual lat/lng inputs are two ways to set the same
 * `form.center_lat`/`center_lng`; a single sync effect pushes whichever changed
 * onto the marker + circle. Leaflet is bundled (npm), not loaded from a CDN.
 */

import { useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import { fetchGeofence, saveGeofence } from "@features/attendance/data/attendanceApi";
import { Button, Card, Field, SectionHeader, inputClass } from "@shared/ui/primitives";

// Leaflet resolves its default marker icons relative to the CSS, which breaks
// under a bundler — point them at the bundled asset URLs instead.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Karachi — a sensible map default before any geofence is set.
const DEFAULT_CENTER = [24.8607, 67.0011];

const BLANK = {
  name: "Workshop",
  center_lat: "",
  center_lng: "",
  radius_m: "80",
  is_active: true,
  wifi_bssids: "",
};

function fromGeofence(g) {
  return {
    name: g.name ?? "Workshop",
    center_lat: g.center_lat == null ? "" : String(g.center_lat),
    center_lng: g.center_lng == null ? "" : String(g.center_lng),
    radius_m: g.radius_m == null ? "80" : String(g.radius_m),
    is_active: g.is_active ?? true,
    wifi_bssids: g.wifi_bssids ?? "",
  };
}

export default function GeofenceCard() {
  const [form, setForm] = useState(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { tone: "ok" | "err", text }

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerRef = useRef(null);
  const circleRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetchGeofence()
      .then((g) => {
        if (!cancelled && g) setForm(fromGeofence(g));
      })
      .catch(() => {
        if (!cancelled) setMsg({ tone: "err", text: "Couldn't load the geofence." });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize the Leaflet map once, after the initial load. The marker/circle
  // stay in sync via the effects below, so this depends only on `loading`; the
  // cleanup tears the map down so a remount (HMR / StrictMode) re-inits cleanly.
  useEffect(() => {
    if (loading || !mapRef.current || mapInstance.current) return undefined;

    const lat = Number(form.center_lat) || DEFAULT_CENTER[0];
    const lng = Number(form.center_lng) || DEFAULT_CENTER[1];
    const radius = Number(form.radius_m) || 80;

    const map = L.map(mapRef.current).setView([lat, lng], 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    const circle = L.circle([lat, lng], { radius }).addTo(map);

    const apply = (ll) =>
      setForm((f) => ({ ...f, center_lat: ll.lat.toFixed(6), center_lng: ll.lng.toFixed(6) }));
    marker.on("dragend", (e) => apply(e.target.getLatLng()));
    map.on("click", (e) => {
      marker.setLatLng(e.latlng);
      apply(e.latlng);
    });

    mapInstance.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    return () => {
      map.remove();
      mapInstance.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Keep the circle radius in sync with the input.
  useEffect(() => {
    if (circleRef.current && form.radius_m) {
      circleRef.current.setRadius(Number(form.radius_m) || 80);
    }
  }, [form.radius_m]);

  // Keep the marker/circle/view in sync with the coordinates, whichever input
  // changed them (map click/drag, "Use My Location", or the manual fields).
  useEffect(() => {
    const lat = Number(form.center_lat);
    const lng = Number(form.center_lng);
    if (mapInstance.current && markerRef.current && circleRef.current && lat && lng) {
      markerRef.current.setLatLng([lat, lng]);
      circleRef.current.setLatLng([lat, lng]);
      mapInstance.current.setView([lat, lng]);
    }
  }, [form.center_lat, form.center_lng]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setMsg({ tone: "err", text: "Geolocation is not supported by your browser." });
      return;
    }
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setForm((f) => ({
          ...f,
          center_lat: pos.coords.latitude.toFixed(6),
          center_lng: pos.coords.longitude.toFixed(6),
        })),
      () => setMsg({ tone: "err", text: "Could not get your location." }),
      { enableHighAccuracy: true }
    );
  };

  const save = async () => {
    const lat = Number(form.center_lat);
    const lng = Number(form.center_lng);
    const radius = parseInt(form.radius_m, 10);
    if (!form.name.trim()) return setMsg({ tone: "err", text: "Name is required." });
    if (!Number.isFinite(lat) || lat < -90 || lat > 90)
      return setMsg({ tone: "err", text: "Latitude must be between −90 and 90." });
    if (!Number.isFinite(lng) || lng < -180 || lng > 180)
      return setMsg({ tone: "err", text: "Longitude must be between −180 and 180." });
    if (!Number.isInteger(radius) || radius <= 0)
      return setMsg({ tone: "err", text: "Radius must be a positive number of metres." });

    setSaving(true);
    setMsg(null);
    try {
      const saved = await saveGeofence({
        name: form.name.trim(),
        center_lat: lat,
        center_lng: lng,
        radius_m: radius,
        is_active: form.is_active,
        wifi_bssids: form.wifi_bssids.trim() || null,
      });
      setForm(fromGeofence(saved));
      setMsg({ tone: "ok", text: "Geofence saved." });
    } catch {
      setMsg({ tone: "err", text: "Couldn't save the geofence — try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <SectionHeader
        title="Workshop Geofence"
        sub="The circle attendance punches are checked against — flags off-site punches, never blocks them."
        action={
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-400 ring-1 ring-slate-200">
            <MapPin className="h-5 w-5" />
          </span>
        }
      />

      {loading ? (
        <p className="mt-4 text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label="Radius (metres)">
              <input
                className={inputClass}
                type="number"
                min="1"
                value={form.radius_m}
                onChange={(e) => set("radius_m", e.target.value)}
              />
            </Field>

            <div className="space-y-3 sm:col-span-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-bold text-slate-700">Location area</label>
                <Button size="sm" variant="secondary" onClick={useMyLocation}>
                  <LocateFixed className="h-4 w-4" /> Use My Location
                </Button>
              </div>
              <div
                ref={mapRef}
                className="relative z-0 h-[300px] w-full rounded-lg border border-slate-200 bg-slate-50"
              />
              <p className="text-xs text-slate-500">
                Click the map or drag the marker to set the centre — or type exact coordinates
                below.
              </p>
            </div>

            <Field label="Center Latitude">
              <input
                className={inputClass}
                type="number"
                step="any"
                placeholder="24.8607"
                value={form.center_lat}
                onChange={(e) => set("center_lat", e.target.value)}
              />
            </Field>
            <Field label="Center Longitude">
              <input
                className={inputClass}
                type="number"
                step="any"
                placeholder="67.0011"
                value={form.center_lng}
                onChange={(e) => set("center_lng", e.target.value)}
              />
            </Field>

            <Field
              label="Workshop Wi-Fi BSSIDs"
              hint="Comma-separated MAC addresses; a matching BSSID corroborates an on-site punch."
              className="sm:col-span-2"
            >
              <input
                className={inputClass}
                placeholder="aa:bb:cc:dd:ee:ff, 11:22:33:44:55:66"
                value={form.wifi_bssids}
                onChange={(e) => set("wifi_bssids", e.target.value)}
              />
            </Field>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={form.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
            />
            Active (punches are evaluated against this geofence)
          </label>

          <div className="mt-4 flex items-center gap-3">
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save Geofence"}
            </Button>
            {msg && (
              <span
                className={`text-sm font-semibold ${
                  msg.tone === "ok" ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {msg.text}
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
