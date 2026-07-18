/**
 * The job's travel map (manager oversight, read-only): the customer pin, the
 * workshop fence, every GPS punch (with its 0037 verdict), and the recorded
 * breadcrumb trail — outbound solid, return dashed. Leaflet + OSM tiles, the
 * same bundled setup as the Settings geofence editor; the trail comes from
 * the manager-only `GET /travel-samples` (decimated server-side).
 *
 * Everything here is display: the billing distance is derived server-side and
 * shown in the Route & Fuel tiles above this map.
 */

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import { fetchGeofence } from "@features/attendance/data/attendanceApi";
import { fetchTravelSamples } from "../data/jobsApi";
import { punchLabel } from "../data/mapJob";

// Leaflet resolves its default marker icons relative to the CSS, which breaks
// under a bundler — point them at the bundled asset URLs instead.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const DEFAULT_CENTER = [24.8607, 67.0011]; // Karachi

// Trail styling per leg — outbound solid blue, return dashed green, the
// delivery legs dashed violet.
const LEG_STYLE = {
  outbound: { color: "#2563eb" },
  return: { color: "#059669", dashArray: "6 6" },
  delivery: { color: "#7c3aed", dashArray: "2 6" },
};

const PUNCH_COLORS = {
  depart_workshop: "#0f172a",
  arrive_customer: "#059669",
  depart_customer: "#b45309",
  arrive_workshop: "#2563eb",
  depart_workshop_delivery: "#7c3aed",
  arrive_customer_delivery: "#7c3aed",
};

function punchPopup(loc) {
  const bits = [`<strong>${punchLabel(loc.kind)}</strong>`];
  if (loc.capturedAt) bits.push(String(loc.capturedAt).slice(0, 16).replace("T", " "));
  if (loc.isMock) bits.push('<span style="color:#dc2626;font-weight:700">MOCK LOCATION</span>');
  if (loc.verified === false && loc.distanceM != null) {
    const away =
      loc.distanceM >= 1000
        ? `${(loc.distanceM / 1000).toFixed(1)} km`
        : `${Math.round(loc.distanceM)} m`;
    bits.push(`<span style="color:#dc2626;font-weight:700">OFF-PIN — ${away} away</span>`);
  }
  return bits.join("<br/>");
}

export default function TravelMapCard({ job }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  // null until both fetches settle — the map inits once, with everything.
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetchTravelSamples(job.id), fetchGeofence()]).then(([trail, fence]) => {
      if (cancelled) return;
      setData({
        trail: trail.status === "fulfilled" ? trail.value : null,
        fence: fence.status === "fulfilled" ? fence.value : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  useEffect(() => {
    if (!data || !mapRef.current || mapInstance.current) return undefined;

    const map = L.map(mapRef.current);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    const bounds = [];

    if (job.customerLat != null && job.customerLng != null) {
      L.marker([job.customerLat, job.customerLng])
        .addTo(map)
        .bindPopup(`<strong>Customer</strong><br/>${job.customer?.name || ""}`);
      bounds.push([job.customerLat, job.customerLng]);
    }

    if (data.fence?.center_lat != null && data.fence?.center_lng != null) {
      L.circle([data.fence.center_lat, data.fence.center_lng], {
        radius: data.fence.radius_m || 80,
        color: "#64748b",
        fillOpacity: 0.08,
      })
        .addTo(map)
        .bindPopup("<strong>Workshop</strong>");
      bounds.push([data.fence.center_lat, data.fence.center_lng]);
    }

    for (const loc of job.locations || []) {
      L.circleMarker([loc.lat, loc.lng], {
        radius: 6,
        color: PUNCH_COLORS[loc.kind] || "#0f172a",
        fillColor: PUNCH_COLORS[loc.kind] || "#0f172a",
        fillOpacity: 0.9,
      })
        .addTo(map)
        .bindPopup(punchPopup(loc));
      bounds.push([loc.lat, loc.lng]);
    }

    const byLeg = {};
    for (const s of data.trail?.samples || []) {
      (byLeg[s.leg] = byLeg[s.leg] || []).push([s.lat, s.lng]);
    }
    for (const [leg, points] of Object.entries(byLeg)) {
      if (points.length < 2) continue;
      const style = LEG_STYLE[leg] || LEG_STYLE.outbound;
      L.polyline(points, { weight: 3, opacity: 0.85, ...style }).addTo(map);
      bounds.push(...points);
    }

    if (bounds.length > 0) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    else map.setView(DEFAULT_CENTER, 12);

    mapInstance.current = map;
    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [data, job]);

  const trailCount = data?.trail?.returned ?? 0;

  return (
    <div className="mt-3 space-y-2">
      <div
        ref={mapRef}
        className="relative z-0 h-[320px] w-full rounded-xl border border-slate-200 bg-slate-50"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 rounded bg-blue-600" /> Outbound trail
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-5 rounded"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg,#059669 0 6px,transparent 6px 10px)",
            }}
          />
          Return trail
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-slate-500" />{" "}
          Workshop fence
        </span>
        <span className="ml-auto">
          {data === null
            ? "Loading trail…"
            : trailCount > 0
              ? `${trailCount} breadcrumb${trailCount === 1 ? "" : "s"} shown${
                  data.trail && data.trail.total > trailCount ? ` (of ${data.trail.total})` : ""
                }`
              : "No breadcrumbs recorded yet"}
        </span>
      </div>
    </div>
  );
}
