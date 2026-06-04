import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, MapPinOff, ShieldAlert, Wifi } from "lucide-react";
import { Card, EmptyState, SectionHeader } from "@shared/ui/primitives";
import Avatar from "@shared/ui/Avatar";
import { PresenceBadge } from "@shared/ui/StatusChip";
import { fmtDate } from "@shared/lib/date";
import { techById } from "@features/technicians/data/technicians";
import { fetchTechDays } from "@features/attendance/data/attendanceApi";
import { currentMonth, fmtClock, fmtWorked } from "@features/attendance/lib/format";

function locationLabel(p) {
  if (p.lat == null) return p.wifi_ssid ? `WiFi: ${p.wifi_ssid}` : "Location unknown";
  const where =
    p.inside_geofence === true
      ? "Inside workshop"
      : p.inside_geofence === false
        ? `Outside (${Math.round(p.distance_m ?? 0)} m)`
        : "Location captured";
  return `${where} · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}

function Tag({ tone, icon: Icon, children }) {
  const tones = {
    ok: "bg-emerald-50 text-emerald-700",
    warn: "bg-amber-50 text-amber-700",
    danger: "bg-red-50 text-red-700",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${tones[tone]}`}
    >
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

function PunchRow({ p }) {
  return (
    <div className="flex gap-3 rounded-lg border border-slate-200 p-3">
      {p.selfie_url ? (
        <img
          src={p.selfie_url}
          alt="punch selfie"
          className="h-16 w-16 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-400">
          No photo
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-slate-800">
            {p.kind === "clock_in" ? "Clock In" : "Clock Out"}
          </span>
          <span className="text-sm text-slate-500">{fmtClock(p.server_time)}</span>
        </div>
        <div className="mt-1 text-xs text-slate-500">{locationLabel(p)}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {p.is_mock_location && (
            <Tag tone="danger" icon={ShieldAlert}>
              Mock GPS
            </Tag>
          )}
          {p.wifi_match === true && (
            <Tag tone="ok" icon={Wifi}>
              Workshop WiFi
            </Tag>
          )}
          {p.inside_geofence === false && (
            <Tag tone="warn" icon={MapPinOff}>
              Off-site
            </Tag>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AttendanceTechDetail() {
  const { techId } = useParams();
  const tech = techById(techId);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // setState only in async callbacks (react-hooks/set-state-in-effect rule).
  useEffect(() => {
    let active = true;
    const month = currentMonth();
    const start = `${month}-01`;
    const end = new Date().toISOString().slice(0, 10);
    fetchTechDays(techId, start, end)
      .then((d) => {
        if (!active) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [techId]);

  const days = (data?.days || []).filter((d) => d.punches.length > 0).reverse();

  return (
    <div className="space-y-4">
      <Link
        to="/attendance"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Attendance
      </Link>

      <Card className="p-5">
        <div className="flex items-center gap-3">
          <Avatar name={tech?.name || techId} color={tech?.avatar} size="md" />
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-slate-900">
              {tech?.name || techId}
            </h1>
            <p className="text-sm text-slate-500">{tech?.specialty || techId}</p>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="p-4">
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            Couldn’t load detail: {error}
          </div>
        </Card>
      ) : null}

      {loading && !data ? <Card className="p-5 text-sm text-slate-500">Loading…</Card> : null}

      {!loading && !error && days.length === 0 ? (
        <EmptyState
          title="No punches recorded this month"
          sub="Punches captured from the technician app will appear here with selfie, location, and flags."
        />
      ) : null}

      {days.map((day) => (
        <Card key={day.day} className="p-4 md:p-5">
          <SectionHeader
            title={fmtDate(day.day, true)}
            sub={`${fmtClock(day.first_in)} → ${fmtClock(day.last_out)} · ${fmtWorked(
              day.worked_minutes
            )}${day.late ? " · late" : ""}`}
            action={<PresenceBadge status={day.status} />}
          />
          <div className="mt-3 space-y-3">
            {day.punches.map((p) => (
              <PunchRow key={p.id} p={p} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
