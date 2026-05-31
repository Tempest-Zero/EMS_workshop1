import { useMemo, useState } from "react";
import { Search, Wrench, ChevronDown, PackagePlus, CircleDollarSign } from "lucide-react";
import { useApp } from "../context/AppContext";
import { Card, Button, EmptyState, Field, inputClass } from "./primitives";
import { Modal } from "./Overlay";
import IntegrationBadge from "./IntegrationBadge";
import StatusChip from "./StatusChip";
import { faultCodes } from "../data/faultCodes";
import { commonFixes } from "../data/commonFixes";
import { formatPKR } from "../lib/currency";

function lowPrice(range) {
  const nums = (range.match(/[\d,]+/g) || []).map((n) => Number(n.replace(/,/g, "")));
  return nums.length ? nums[0] : 0;
}

export default function TroubleshootGuide({ compact = false }) {
  const { jobs, addEstimateLineItem, addToast } = useApp();
  const [q, setQ] = useState("");
  const [openFix, setOpenFix] = useState(null);
  const [addTarget, setAddTarget] = useState(null); // { name, unitPrice }

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return faultCodes;
    return faultCodes.filter((f) =>
      [f.code, f.appliance, f.meaning, f.recommendedPart, ...f.causes]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [q]);

  const assignable = jobs.filter((j) => j.status === "open" || j.status === "waiting");

  return (
    <div className={compact ? "space-y-4 p-4 pb-8" : "space-y-5"}>
      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search code, symptom, appliance…"
          className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      </div>

      {!compact && (
        <div className="flex justify-end">
          <IntegrationBadge>Linked to Parts Supplier catalog</IntegrationBadge>
        </div>
      )}

      {/* Fault code results */}
      <div className={compact ? "space-y-3" : "grid gap-4 md:grid-cols-2"}>
        {results.map((f) => (
          <Card key={f.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  {f.code !== "—" && (
                    <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-extrabold text-white">{f.code}</span>
                  )}
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{f.appliance}</span>
                </div>
                <h3 className="mt-1.5 text-sm font-bold text-slate-800">{f.meaning}</h3>
              </div>
            </div>

            <ul className="mt-2 space-y-1">
              {f.causes.map((c, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-slate-600">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                  {c}
                </li>
              ))}
            </ul>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Recommended part</div>
                <div className="text-sm font-semibold text-slate-700">{f.recommendedPart}</div>
                <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                  <CircleDollarSign className="h-3.5 w-3.5" />
                  {f.costRange}
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setAddTarget({ name: f.recommendedPart, unitPrice: lowPrice(f.costRange) })}>
                <PackagePlus className="h-4 w-4" /> Add to Job
              </Button>
            </div>
          </Card>
        ))}
        {results.length === 0 && (
          <EmptyState icon={Wrench} title="No matches" sub="Try a different code or symptom." />
        )}
      </div>

      {/* Common fixes accordion */}
      <div>
        <h2 className="mb-2 mt-2 text-base font-bold tracking-tight text-slate-800">Common Fixes</h2>
        <div className="space-y-2">
          {commonFixes.map((group) => {
            const open = openFix === group.appliance;
            return (
              <Card key={group.appliance} className="overflow-hidden p-0">
                <button
                  onClick={() => setOpenFix(open ? null : group.appliance)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-sm font-bold text-slate-800">{group.appliance}</span>
                  <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <div className="space-y-2 border-t border-slate-100 px-4 py-3">
                    {group.symptoms.map((s, i) => (
                      <div key={i} className="rounded-lg bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-slate-800">{s.symptom}</span>
                          <span className="text-xs font-semibold text-emerald-600">{s.costRange}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{s.cause}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {s.partsToCheck.map((p, j) => (
                            <span key={j} className="rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Add part to job modal */}
      <AddPartModal
        target={addTarget}
        jobs={assignable}
        onClose={() => setAddTarget(null)}
        onConfirm={(jobId, part) => {
          addEstimateLineItem(jobId, part);
          setAddTarget(null);
          addToast(`Added ${part.name} to job`, "ready");
        }}
      />
    </div>
  );
}

function AddPartModal({ target, jobs, onClose, onConfirm }) {
  const [jobId, setJobId] = useState("");
  const [price, setPrice] = useState("");
  if (!target) return null;
  const unit = price === "" ? target.unitPrice : Number(price);

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title="Add Part to Job"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!jobId || !unit}
            onClick={() => onConfirm(jobId, { name: target.name, qty: 1, unitPrice: unit })}
          >
            Add {formatPKR(unit || 0)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Part</div>
          <div className="text-sm font-bold text-slate-800">{target.name}</div>
        </div>
        <Field label="Unit Price (Rs)">
          <input type="number" className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} placeholder={String(target.unitPrice)} />
        </Field>
        <Field label="Select Job">
          {jobs.length ? (
            <div className="max-h-60 space-y-1.5 overflow-y-auto">
              {jobs.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => setJobId(j.id)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${
                    jobId === j.id ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-sm font-extrabold text-slate-900">#{j.token}</span>
                  <StatusChip status={j.status} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
                    {j.customer.name} · {j.appliance.type}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No open or waiting jobs available.</p>
          )}
        </Field>
      </div>
    </Modal>
  );
}
