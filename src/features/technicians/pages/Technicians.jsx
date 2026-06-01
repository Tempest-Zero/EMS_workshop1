import { Link } from "react-router-dom";
import { Phone, Briefcase, ChevronRight } from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import { Card } from "@shared/ui/primitives";
import Avatar from "@shared/ui/Avatar";
import { PresenceBadge } from "@shared/ui/StatusChip";

export default function Technicians() {
  const { technicians, attendanceToday, jobsForTech } = useApp();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {technicians.map((t) => {
        const status = attendanceToday[t.id]?.status || t.status;
        const active = jobsForTech(t.id).length;
        return (
          <Link key={t.id} to={`/technicians/${t.id}`} className="block">
            <Card className="p-4 transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start gap-3">
                <Avatar name={t.name} color={t.avatar} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-base font-bold text-slate-900">{t.name}</h3>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </div>
                  <div className="text-sm font-medium text-slate-500">{t.specialty}</div>
                  <div className="mt-2">
                    <PresenceBadge status={status} />
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
                  <Briefcase className="h-4 w-4 text-slate-400" />
                  {active} active {active === 1 ? "job" : "jobs"}
                </span>
                <a
                  href={`tel:${t.phone}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 font-semibold text-blue-600"
                >
                  <Phone className="h-3.5 w-3.5" />
                  Call
                </a>
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
