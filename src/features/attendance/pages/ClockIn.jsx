import { useEffect, useState } from "react";
import { Clock, LogIn, LogOut, CheckCircle2 } from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import { Card, SectionHeader } from "@shared/ui/primitives";
import IntegrationBadge from "@shared/ui/IntegrationBadge";
import MonthDots from "@features/attendance/components/MonthDots";
import { monthSummary } from "@features/attendance/data/attendance";
import { elapsedSince } from "@shared/lib/date";

export default function ClockIn() {
  const { currentTechId, attendanceToday, clockIn, clockOut, addToast } = useApp();
  const rec = attendanceToday[currentTechId];
  const summary = monthSummary(currentTechId);
  const isIn = rec?.clockedIn;

  const [, force] = useState(0);
  useEffect(() => {
    if (!isIn) return undefined;
    const t = setInterval(() => force((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, [isIn]);

  return (
    <div className="p-4 pb-8 space-y-4">
      <h1 className="text-lg font-extrabold tracking-tight text-slate-900">Clock In</h1>

      {/* Big status / action */}
      <Card className={`p-6 text-center ${isIn ? "bg-emerald-50 ring-1 ring-emerald-200" : ""}`}>
        <div
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${isIn ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"}`}
        >
          <Clock className="h-8 w-8" />
        </div>
        {isIn ? (
          <>
            <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> On duty
            </div>
            <div className="mt-1 text-sm text-slate-500">
              Clocked in at <span className="font-bold text-slate-700">{rec.clockIn}</span>
            </div>
            <div className="mt-0.5 text-xs font-semibold text-slate-400">
              {elapsedSince(rec.clockIn)} elapsed
            </div>
            <button
              onClick={() => {
                clockOut(currentTechId);
                addToast("Clocked out", "default");
              }}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-4 text-base font-bold text-white active:scale-[0.99]"
            >
              <LogOut className="h-5 w-5" /> Clock Out
            </button>
          </>
        ) : (
          <>
            <div className="mt-3 text-sm font-semibold text-slate-500">
              {rec?.clockOut ? `Clocked out at ${rec.clockOut}` : "You are not clocked in"}
            </div>
            <button
              onClick={() => {
                clockIn(currentTechId);
                addToast("Clocked in — have a good shift", "ready");
              }}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-4 text-base font-bold text-white active:scale-[0.99]"
            >
              <LogIn className="h-5 w-5" /> Clock In Now
            </button>
          </>
        )}
        <div className="mt-4 flex justify-center">
          <IntegrationBadge>Synced with Attendance Service</IntegrationBadge>
        </div>
      </Card>

      {/* Month calendar */}
      <Card className="p-4">
        <SectionHeader
          title="This Month"
          sub={`${summary.present} of ${summary.working} days present`}
        />
        <div className="mt-3">
          <MonthDots techId={currentTechId} showNums />
        </div>
      </Card>
    </div>
  );
}
