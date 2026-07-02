import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  LogIn,
  LogOut,
  MapPinOff,
  Plus,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import { Button, Card, EmptyState, Field, SectionHeader, inputClass } from "@shared/ui/primitives";
import Avatar from "@shared/ui/Avatar";
import { PresenceBadge } from "@shared/ui/StatusChip";
import { fmtDate } from "@shared/lib/date";
import { useApp } from "@app/providers/AppContext";
import { useAuth } from "@app/providers/AuthContext";
import { createAdjustment } from "@features/attendance/data/attendanceApi";
import { useTechDetail } from "@features/attendance/hooks/useTechDetail";
import { fmtClock, fmtWorked } from "@features/attendance/lib/format";

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
            {p.source === "manual" ? (
              <span className="ml-1.5 text-[10px] font-bold text-slate-400">· manual</span>
            ) : null}
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

function crossingLabel(p) {
  const verb = p.kind === "arrive" ? "Reached the workshop" : "Left the workshop";
  if (p.inside_geofence === false) return `${verb} (read outside the fence)`;
  return verb;
}

/** The day's passive geofence crossings — the phone's whereabouts independent of
 * any punch. This is what lets a manager tell "forgot to clock in" from "wasn't
 * here": an `arrive` with no clock-in is presence, a blank day is absence. */
function PresenceTimeline({ presence }) {
  if (!presence || presence.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Geofence activity
      </div>
      <div className="mt-2 space-y-1.5">
        {presence.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            {p.kind === "arrive" ? (
              <LogIn className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            ) : (
              <LogOut className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            )}
            <span className="font-semibold text-slate-700">{fmtClock(p.server_time)}</span>
            <span>{crossingLabel(p)}</span>
            {p.is_mock_location ? (
              <Tag tone="danger" icon={ShieldAlert}>
                Mock GPS
              </Tag>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ArrivedNotClockedInBanner() {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-800">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        The phone reached the workshop but no clock-in was recorded — evidence the tech was on-site
        (a forgotten punch, not an absence).
      </span>
    </div>
  );
}

function OrderViolationBanner() {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-800">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        Clock-out before clock-in — check punches. Worked minutes were clamped to zero for this day.
      </span>
    </div>
  );
}

function CorrectionForm({ techId, onSaved, onCancel }) {
  const { user } = useAuth();
  const [kind, setKind] = useState("clock_in");
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!when || !reason.trim()) {
      setErr("Time and reason are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await createAdjustment({
        tech_id: techId,
        kind,
        server_time: new Date(when).toISOString(),
        reason: reason.trim(),
        manager_id: user?.tech_id || "manager",
      });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 md:p-5">
      <SectionHeader
        title="Add correction"
        sub="Appends an audited manual punch — the log itself is never edited"
      />
      <form onSubmit={submit} className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="clock_in">Clock In</option>
              <option value="clock_out">Clock Out</option>
            </select>
          </Field>
          <Field label="Time">
            <input
              type="datetime-local"
              className={inputClass}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Reason">
          <input
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. forgot to clock out"
          />
        </Field>
        <div className="text-sm text-slate-500">
          Correction by <span className="font-bold text-slate-700">{user?.name || "Manager"}</span>
        </div>
        {err ? <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</div> : null}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Save correction"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AdjustmentsCard({ adjustments }) {
  if (adjustments.length === 0) return null;
  return (
    <Card className="p-4 md:p-5">
      <SectionHeader title="Corrections" sub="Audited manual adjustments" />
      <div className="mt-3 space-y-2">
        {adjustments.map((a) => (
          <div key={a.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-800">
                {a.kind === "clock_in" ? "Clock In" : "Clock Out"} · {fmtClock(a.server_time)}
              </span>
              <span className="text-xs text-slate-400">{fmtDate(a.created_at, true)}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              “{a.reason}” · by {a.manager_id}
              {a.original_event_id ? " · references an earlier punch" : ""}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function AttendanceTechDetail() {
  const { techId } = useParams();
  const { technicians } = useApp();
  const tech = technicians.find((t) => t.id === techId);
  const { days, adjustments, loading, error, reload } = useTechDetail(techId);
  const [showForm, setShowForm] = useState(false);

  // Include days with EITHER a punch or a geofence crossing — a day with an
  // `arrive` but no punch (the "forgot to clock in" case) is exactly what the
  // manager needs to see, and would otherwise be hidden.
  const activeDays = (days || [])
    .filter((d) => d.punches.length > 0 || (d.presence?.length ?? 0) > 0)
    .reverse();

  return (
    <div className="space-y-4">
      <Link
        to="/attendance"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Attendance
      </Link>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={tech?.name || techId} color={tech?.avatar} size="md" />
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-slate-900">
                {tech?.name || techId}
              </h1>
              <p className="text-sm text-slate-500">{tech?.specialty || techId}</p>
            </div>
          </div>
          {!showForm ? (
            <Button variant="secondary" size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" /> Correction
            </Button>
          ) : null}
        </div>
      </Card>

      {showForm ? (
        <CorrectionForm
          techId={techId}
          onSaved={() => {
            setShowForm(false);
            reload();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      {error ? (
        <Card className="p-4">
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            Couldn’t load detail: {error}
          </div>
        </Card>
      ) : null}

      {loading && !days ? <Card className="p-5 text-sm text-slate-500">Loading…</Card> : null}

      <AdjustmentsCard adjustments={adjustments} />

      {!loading && !error && activeDays.length === 0 ? (
        <EmptyState
          title="No activity recorded this month"
          sub="Punches and geofence arrivals captured from the technician app will appear here with selfie, location, and flags."
        />
      ) : null}

      {activeDays.map((day) => (
        <Card key={day.day} className="p-4 md:p-5">
          <SectionHeader
            title={fmtDate(day.day, true)}
            sub={
              day.punches.length > 0
                ? `${fmtClock(day.first_in)} → ${fmtClock(day.last_out)} · ${fmtWorked(
                    day.worked_minutes
                  )}${day.late ? " · late" : ""}`
                : "No clock-in recorded"
            }
            action={<PresenceBadge status={day.status} />}
          />
          {day.arrived_not_clocked_in ? <ArrivedNotClockedInBanner /> : null}
          {day.flagged_order ? <OrderViolationBanner /> : null}
          {day.punches.length > 0 ? (
            <div className="mt-3 space-y-3">
              {day.punches.map((p) => (
                <PunchRow key={p.id} p={p} />
              ))}
            </div>
          ) : null}
          <PresenceTimeline presence={day.presence} />
        </Card>
      ))}
    </div>
  );
}
