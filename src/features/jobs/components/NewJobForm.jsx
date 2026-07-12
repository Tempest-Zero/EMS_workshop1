import { useState } from "react";
import { Home, Package, Truck } from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import { inputClass, Field } from "@shared/ui/primitives";
import { APPLIANCE_TYPES } from "@shared/config/constants";

const FORM_ID = "new-job-form";

export default function NewJobForm({ onSubmit }) {
  const { technicians } = useApp();
  // Field technicians only — the manager account isn't assignable. Default to
  // unassigned: the job lands on the work list for dual assignment.
  const assignable = technicians.filter((t) => t.role !== "manager");
  // No preselected type: the silent carry-in default sent real home visits
  // into the DB typeless, which hid the whole travel flow on the phone.
  const [jobType, setJobType] = useState("");
  const [typeMissing, setTypeMissing] = useState(false);
  const [applianceType, setApplianceType] = useState(APPLIANCE_TYPES[0]);
  const [assignedTechId, setAssignedTechId] = useState("");
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    brand: "",
    model: "",
    problem: "",
    address: "",
    preferredDate: "",
    timeWindow: "",
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // The shop travels for home visits AND pickups; only a carry-in has no leg.
  const isVisit = jobType === "home-visit" || jobType === "pickup-delivery";

  const submit = (e) => {
    e.preventDefault();
    if (!jobType) {
      setTypeMissing(true);
      return;
    }
    onSubmit({ ...form, jobType, applianceType, assignedTechId });
  };

  const toggle = (val, label, Icon) => (
    <button
      type="button"
      onClick={() => {
        setJobType(val);
        setTypeMissing(false);
      }}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-bold transition ${
        jobType === val
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <form id={FORM_ID} onSubmit={submit} className="space-y-4">
      <div className="flex gap-2">
        {toggle("carry-in", "Carry-in", Package)}
        {toggle("home-visit", "Home Visit", Home)}
        {toggle("pickup-delivery", "Pickup", Truck)}
      </div>
      {typeMissing && (
        <p className="text-xs font-semibold text-red-600">
          Pick how the appliance reaches the shop — carry-in, home visit, or pickup.
        </p>
      )}

      <Field label="Customer Name">
        <input
          className={inputClass}
          value={form.customerName}
          onChange={set("customerName")}
          placeholder="e.g. Abdul Rehman"
          required
        />
      </Field>
      <Field label="Phone">
        <input
          className={inputClass}
          value={form.customerPhone}
          onChange={set("customerPhone")}
          placeholder="03XX-XXXXXXX"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Appliance">
          <select
            className={inputClass}
            value={applianceType}
            onChange={(e) => setApplianceType(e.target.value)}
          >
            {APPLIANCE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Brand">
          <input
            className={inputClass}
            value={form.brand}
            onChange={set("brand")}
            placeholder="e.g. Haier"
          />
        </Field>
      </div>
      <Field label="Model (optional)">
        <input
          className={inputClass}
          value={form.model}
          onChange={set("model")}
          placeholder="e.g. HSU-12"
        />
      </Field>

      <Field label="Problem Description">
        <textarea
          className={inputClass}
          rows={3}
          value={form.problem}
          onChange={set("problem")}
          placeholder="What's wrong with the appliance?"
          required
        />
      </Field>

      {isVisit && (
        <div className="space-y-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
          <Field label="Address">
            <input
              className={inputClass}
              value={form.address}
              onChange={set("address")}
              placeholder="House / street / area"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preferred Date">
              <input
                type="date"
                className={inputClass}
                value={form.preferredDate}
                onChange={set("preferredDate")}
              />
            </Field>
            <Field label="Time Window">
              <input
                className={inputClass}
                value={form.timeWindow}
                onChange={set("timeWindow")}
                placeholder="e.g. 2–4 PM"
              />
            </Field>
          </div>
        </div>
      )}

      <Field label="Assign Technician">
        <select
          className={inputClass}
          value={assignedTechId}
          onChange={(e) => setAssignedTechId(e.target.value)}
        >
          <option value="">Unassigned — goes to the work list</option>
          {assignable.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {t.specialty}
            </option>
          ))}
        </select>
      </Field>
    </form>
  );
}

NewJobForm.FORM_ID = FORM_ID;
