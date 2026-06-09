/**
 * Manager shift editor. Reads + writes a technician's shift
 * (`GET/PUT /api/attendance/shifts/{tech_id}`) — the start/end times, working
 * days, and grace window that give "late" / "absent" their meaning on the board.
 * `working_days` is a 7-char Mon→Sun bitmask ("1111110" = Mon–Sat).
 */

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

import { useApp } from "@app/providers/AppContext";
import { fetchShift, saveShift } from "@features/attendance/data/attendanceApi";
import { Button, Card, Field, SectionHeader, inputClass } from "@shared/ui/primitives";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function daysFromMask(mask) {
  return DAY_LABELS.map((_, i) => (mask ?? "")[i] === "1");
}
function maskFromDays(days) {
  return days.map((on) => (on ? "1" : "0")).join("");
}
// Time inputs use "HH:MM"; the API returns "HH:MM:SS". Trim for display, and
// pad back to seconds on save so any time parser accepts it.
function toInputTime(t) {
  return typeof t === "string" ? t.slice(0, 5) : "";
}
function toApiTime(t) {
  return t && t.length === 5 ? `${t}:00` : t;
}

export default function ShiftsCard() {
  const { technicians } = useApp();
  // Seed roster is always present at mount, so the picker defaults to the first
  // tech via lazy init — no effect (and no synchronous setState in one) needed.
  const [techId, setTechId] = useState(() => technicians[0]?.id ?? "");
  const [form, setForm] = useState(null); // { start, end, days[], grace, timezone }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { tone, text }

  // Load the selected tech's shift whenever the selection changes. Loading +
  // form-reset are driven by the select handler (and the initial state), so the
  // effect itself never sets state synchronously.
  useEffect(() => {
    if (!techId) return undefined;
    let cancelled = false;
    fetchShift(techId)
      .then((s) => {
        if (cancelled) return;
        setForm({
          start: toInputTime(s.start_local),
          end: toInputTime(s.end_local),
          days: daysFromMask(s.working_days),
          grace: String(s.grace_minutes ?? 10),
          timezone: s.timezone ?? "Asia/Karachi",
        });
      })
      .catch(() => {
        if (!cancelled) setMsg({ tone: "err", text: "Couldn't load this shift." });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [techId]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggleDay = (i) =>
    setForm((f) => ({ ...f, days: f.days.map((on, idx) => (idx === i ? !on : on)) }));

  // setState in an event handler (not an effect) is the React-recommended place
  // to flip loading / clear the previous tech's form on a switch.
  const selectTech = (id) => {
    setTechId(id);
    setForm(null);
    setLoading(true);
    setMsg(null);
  };

  const save = async () => {
    if (!form) return;
    const grace = parseInt(form.grace, 10);
    if (!form.start || !form.end)
      return setMsg({ tone: "err", text: "Start and end times are required." });
    if (!Number.isInteger(grace) || grace < 0)
      return setMsg({ tone: "err", text: "Grace must be zero or more minutes." });
    if (!form.timezone.trim()) return setMsg({ tone: "err", text: "Timezone is required." });

    setSaving(true);
    setMsg(null);
    try {
      await saveShift(techId, {
        start_local: toApiTime(form.start),
        end_local: toApiTime(form.end),
        working_days: maskFromDays(form.days),
        grace_minutes: grace,
        timezone: form.timezone.trim(),
      });
      setMsg({ tone: "ok", text: "Shift saved." });
    } catch {
      setMsg({ tone: "err", text: "Couldn't save the shift — try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <SectionHeader
        title="Technician Shifts"
        sub="Working hours, days, and grace window — what makes a punch count as late or absent."
        action={
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-400 ring-1 ring-slate-200">
            <Clock className="h-5 w-5" />
          </span>
        }
      />

      <div className="mt-4">
        <Field label="Technician">
          <select
            className={inputClass}
            value={techId}
            onChange={(e) => selectTech(e.target.value)}
          >
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.id})
              </option>
            ))}
          </select>
        </Field>
      </div>

      {loading || !form ? (
        <p className="mt-4 text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Start (local)">
              <input
                className={inputClass}
                type="time"
                value={form.start}
                onChange={(e) => set("start", e.target.value)}
              />
            </Field>
            <Field label="End (local)">
              <input
                className={inputClass}
                type="time"
                value={form.end}
                onChange={(e) => set("end", e.target.value)}
              />
            </Field>
            <Field label="Grace (minutes)">
              <input
                className={inputClass}
                type="number"
                min="0"
                value={form.grace}
                onChange={(e) => set("grace", e.target.value)}
              />
            </Field>
            <Field label="Timezone">
              <input
                className={inputClass}
                value={form.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Working Days
            </span>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-bold transition ${
                    form.days[i]
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save Shift"}
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
