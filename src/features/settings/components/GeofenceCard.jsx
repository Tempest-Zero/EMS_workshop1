/**
 * Manager geofence editor. Reads + writes the live attendance geofence
 * (`GET/PUT /api/attendance/geofences`) — the circle a punch's GPS is checked
 * against. The geofence only *flags* off-site punches; it never blocks them.
 */

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";

import { fetchGeofence, saveGeofence } from "@features/attendance/data/attendanceApi";
import { Button, Card, Field, SectionHeader, inputClass } from "@shared/ui/primitives";

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

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

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
            <Field label="Center Latitude">
              <input
                className={inputClass}
                type="number"
                step="any"
                placeholder="33.65564"
                value={form.center_lat}
                onChange={(e) => set("center_lat", e.target.value)}
              />
            </Field>
            <Field label="Center Longitude">
              <input
                className={inputClass}
                type="number"
                step="any"
                placeholder="72.8543"
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
