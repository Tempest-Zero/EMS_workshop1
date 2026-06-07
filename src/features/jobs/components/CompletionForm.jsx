/**
 * Work-completion form (Module 3 post-job). Captures materials used, time
 * on-site, travel/fuel, and remarks (text + a voice note). On save it
 * auto-generates the original bill (Module 4). Mirrors the EstimateEditor
 * SlideOver pattern.
 */

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, inputClass } from "@shared/ui/primitives";
import { SlideOver } from "@shared/ui/Overlay";
import { formatPKR } from "@shared/lib/currency";
import { materialsTotal, completionLabor, completionTotal } from "@shared/lib/job";
import AudioRecorder from "./AudioRecorder";

export default function CompletionForm({ open, onClose, onSave, job, rate }) {
  const c = job.completion;
  const [materials, setMaterials] = useState(() =>
    c?.materials?.length
      ? c.materials.map((m) => ({ ...m }))
      : [{ name: "", qty: 1, unitPrice: "" }]
  );
  const [timeSpentMins, setTime] = useState(c?.timeSpentMins ?? "");
  const [fuelAmount, setFuel] = useState(c?.fuelAmount ?? "");
  const [remarksText, setRemarks] = useState(c?.remarksText ?? "");
  const [audio, setAudio] = useState(c?.audio ?? null);

  const setMat = (i, key, val) =>
    setMaterials((ms) => ms.map((m, idx) => (idx === i ? { ...m, [key]: val } : m)));
  const addRow = () => setMaterials((ms) => [...ms, { name: "", qty: 1, unitPrice: "" }]);
  const removeRow = (i) => setMaterials((ms) => ms.filter((_, idx) => idx !== i));

  const cleanMaterials = materials
    .filter((m) => m.name.trim() && Number(m.unitPrice) > 0)
    .map((m) => ({ name: m.name.trim(), qty: Number(m.qty) || 1, unitPrice: Number(m.unitPrice) }));

  const preview = {
    materials: cleanMaterials,
    timeSpentMins: Number(timeSpentMins) || 0,
    fuelAmount: Number(fuelAmount) || 0,
  };
  const total = completionTotal(preview, rate);

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Complete Job"
      subtitle="Log the work done — generates the bill"
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm">
            <span className="text-slate-400">Bill </span>
            <span className="font-extrabold text-slate-900">{formatPKR(total)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                onSave({
                  materials: cleanMaterials,
                  timeSpentMins: Number(timeSpentMins) || 0,
                  fuelAmount: Number(fuelAmount) || 0,
                  remarksText: remarksText.trim(),
                  audio,
                })
              }
            >
              Submit Completion
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Materials used */}
        <div className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Materials Used
          </div>
          {materials.map((m, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3">
              <input
                className={`${inputClass} mb-2`}
                value={m.name}
                onChange={(e) => setMat(i, "name", e.target.value)}
                placeholder="Material / part (e.g. Compressor relay)"
              />
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  Qty
                  <input
                    type="number"
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    value={m.qty}
                    min={1}
                    onChange={(e) => setMat(i, "qty", e.target.value)}
                  />
                </label>
                <label className="flex flex-1 items-center gap-1.5 text-xs text-slate-500">
                  Unit Rs
                  <input
                    type="number"
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    value={m.unitPrice}
                    onChange={(e) => setMat(i, "unitPrice", e.target.value)}
                    placeholder="0"
                  />
                </label>
                {materials.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    aria-label="Remove material"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={addRow}>
            <Plus className="h-4 w-4" /> Add Material
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Time on-site (minutes)" hint={`Labour @ ${formatPKR(rate)}/hr`}>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={timeSpentMins}
              onChange={(e) => setTime(e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label="Travel / fuel (Rs)">
            <input
              type="number"
              min={0}
              className={inputClass}
              value={fuelAmount}
              onChange={(e) => setFuel(e.target.value)}
              placeholder="0"
            />
          </Field>
        </div>

        <Field label="Remarks (text)">
          <textarea
            className={inputClass}
            rows={3}
            value={remarksText}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="What was done / parts replaced / advice given"
          />
        </Field>

        <Field label="Remarks (voice note)">
          <AudioRecorder value={audio} onChange={setAudio} />
        </Field>

        {/* Bill preview */}
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <div className="flex justify-between text-slate-500">
            <span>Materials</span>
            <span className="font-semibold text-slate-700">
              {formatPKR(materialsTotal(preview))}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-slate-500">
            <span>Labour</span>
            <span className="font-semibold text-slate-700">
              {formatPKR(completionLabor(preview, rate))}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-slate-500">
            <span>Travel / fuel</span>
            <span className="font-semibold text-slate-700">{formatPKR(preview.fuelAmount)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base">
            <span className="font-extrabold text-slate-900">Bill total</span>
            <span className="font-extrabold text-slate-900">{formatPKR(total)}</span>
          </div>
        </div>
      </div>
    </SlideOver>
  );
}
