import { Bell, CreditCard, Users2, Link2 } from "lucide-react";
import { Card, SectionHeader, Field, inputClass, Button } from "@shared/ui/primitives";
import { WORKSHOP } from "@shared/config/constants";
import GeofenceCard from "@features/settings/components/GeofenceCard";
import ShiftsCard from "@features/settings/components/ShiftsCard";

const INTEGRATIONS = [
  {
    name: "Attendance Service",
    desc: "Biometric clock-in sync",
    icon: Users2,
    status: "Demo",
  },
  {
    name: "Payroll Service",
    desc: "Monthly salary & deductions",
    icon: CreditCard,
    status: "Demo",
  },
  { name: "SMS Gateway", desc: "Customer ready / pickup alerts", icon: Bell, status: "Demo" },
  {
    name: "Parts Supplier Catalog",
    desc: "Live part pricing & orders",
    icon: Link2,
    status: "Demo",
  },
];

export default function Settings() {
  return (
    <div className="max-w-3xl space-y-5">
      {/* Workshop profile */}
      <Card className="p-5">
        <SectionHeader title="Workshop Profile" sub="Shown across the app" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Workshop Name">
            <input className={inputClass} defaultValue={WORKSHOP.name} />
          </Field>
          <Field label="Location">
            <input className={inputClass} defaultValue={WORKSHOP.location} />
          </Field>
          <Field label="Default Labor Rate (Rs/hour)">
            <input className={inputClass} type="number" defaultValue={1200} />
          </Field>
          <Field label="Working Days / Month">
            <input
              className={inputClass}
              type="number"
              defaultValue={WORKSHOP.workingDaysThisMonth}
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" disabled>
            Save Changes
          </Button>
          <span className="text-xs text-slate-400">
            Demo — workshop profile editing isn’t wired up in this prototype.
          </span>
        </div>
      </Card>

      {/* Attendance config — live, manager-only (backed by the real API) */}
      <GeofenceCard />
      <ShiftsCard />

      {/* Integrations */}
      <Card className="p-5">
        <SectionHeader
          title="Integrations"
          sub="External services this prototype is wired to plug into"
        />
        <div className="mt-3 space-y-2">
          {INTEGRATIONS.map((it) => {
            const Icon = it.icon;
            return (
              <div
                key={it.name}
                className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-3"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-800">{it.name}</div>
                  <div className="text-xs text-slate-500">{it.desc}</div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
                  {it.status}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          These are demonstration placeholders — no live data is exchanged in this prototype.
        </p>
      </Card>
    </div>
  );
}
