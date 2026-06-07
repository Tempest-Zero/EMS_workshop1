import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Phone,
  MapPin,
  Home,
  Plus,
  Trash2,
  FileText,
  CheckCircle2,
  XCircle,
  BellRing,
  Wallet,
  Lock,
  PhoneCall,
  Ban,
  Truck,
  CalendarClock,
  Receipt,
  RotateCcw,
  Handshake,
} from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import JobMediaGallery from "@features/media/components/JobMediaGallery";
import { Card, Button, SectionHeader, EmptyState, Field, inputClass } from "@shared/ui/primitives";
import StatusChip from "@shared/ui/StatusChip";
import Avatar from "@shared/ui/Avatar";
import { Modal, SlideOver } from "@shared/ui/Overlay";
import { formatPKR } from "@shared/lib/currency";
import {
  partsTotal,
  laborTotal,
  estimateTotal,
  hasEstimate,
  amountOwed,
  amountPaid,
  balance,
  billOriginal,
  billPayable,
  billDiscount,
  isNegotiated,
  hasBill,
  revenueEntries,
  ESTIMATE_LABEL,
} from "@shared/lib/job";
import { fmtDate, daysSince } from "@shared/lib/date";
import { techById } from "@features/technicians/data/technicians";

function kindDot(kind) {
  const map = {
    create: "bg-blue-500",
    assign: "bg-slate-400",
    note: "bg-slate-400",
    estimate: "bg-amber-500",
    approve: "bg-emerald-500",
    approved: "bg-emerald-500",
    declined: "bg-red-500",
    ready: "bg-emerald-500",
    payment: "bg-emerald-600",
    status: "bg-slate-500",
    followup: "bg-amber-500",
  };
  return map[kind] || "bg-slate-300";
}

export default function JobDetail({ tech = false }) {
  const { id } = useParams();
  const nav = useNavigate();
  const app = useApp();
  const { loadJobDetail } = app;
  const job = app.getJob(id);
  const [modal, setModal] = useState(null);
  const [correctTarget, setCorrectTarget] = useState(null);

  // Pull the full detail (the only response carrying the timeline) on open.
  useEffect(() => {
    loadJobDetail(id).catch(() => {});
  }, [id, loadJobDetail]);

  if (!job) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Job not found" sub="This job may have been removed." />
        <div className="mt-4 text-center">
          <Button onClick={() => nav(tech ? "/tech/jobs" : "/jobs")}>Back to jobs</Button>
        </div>
      </div>
    );
  }

  const technician = techById(job.assignedTechId);
  const isVisit = job.jobType === "home-visit";
  const est = job.estimate;
  const owed = amountOwed(job);
  const paid = amountPaid(job);
  const bal = balance(job);
  const original = billOriginal(job);
  const payable = billPayable(job);
  const discount = billDiscount(job);
  const negotiated = isNegotiated(job);
  const entries = revenueEntries(job);
  const closed = job.status === "closed";
  const back = tech ? "/tech/jobs" : "/jobs";

  return (
    <div className={tech ? "p-4 space-y-4 pb-24" : "space-y-5"}>
      {/* Back + header */}
      <div>
        <button
          onClick={() => nav(back)}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          {tech ? "My Jobs" : "All Jobs"}
        </button>

        <Card className="p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
                  #{job.token}
                </h1>
                <StatusChip status={job.status} size="lg" />
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-500">
                {job.appliance.type} · {job.appliance.brand}
                {job.appliance.model ? ` · ${job.appliance.model}` : ""}
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
              {isVisit ? <Home className="h-3.5 w-3.5" /> : null}
              {isVisit ? "Home Visit" : "Carry-in"}
            </span>
          </div>

          {/* Customer + tech */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
                Customer
              </div>
              <div className="mt-1 text-sm font-bold text-slate-800">{job.customer.name}</div>
              {job.customer.phone && (
                <a
                  href={`tel:${job.customer.phone}`}
                  className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {job.customer.phone}
                </a>
              )}
              {job.customer.address && (
                <div className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {job.customer.address}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
                Assigned To
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Avatar name={technician?.name || "?"} color={technician?.avatar} size="sm" />
                <div>
                  <div className="text-sm font-bold text-slate-800">{technician?.name}</div>
                  <div className="text-xs text-slate-500">{technician?.specialty}</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-400">
                Opened {fmtDate(job.createdAt, true)}
              </div>
            </div>
          </div>

          {/* Conditional banners */}
          {job.status === "waiting" && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm">
              <span className="font-bold text-amber-700">
                Waiting {daysSince(job.waitingSince)} days
              </span>
              <span className="text-amber-700"> — {job.waitingReason}</span>
            </div>
          )}
          {isVisit && (job.preferredDate || job.timeWindow) && !closed && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-semibold text-blue-700">
              <CalendarClock className="h-4 w-4" />
              Visit {job.preferredDate ? fmtDate(job.preferredDate) : ""}{" "}
              {job.timeWindow ? `· ${job.timeWindow}` : ""}
            </div>
          )}
        </Card>
      </div>

      {/* Problem + diagnosis */}
      <Card className="p-4 md:p-5">
        <SectionHeader
          title="Problem & Diagnosis"
          action={
            !closed && (
              <Button size="sm" onClick={() => setModal("note")}>
                <Plus className="h-4 w-4" /> Add Note
              </Button>
            )
          }
        />
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
          {job.problem}
        </p>

        {job.notes?.length > 0 && (
          <ul className="mt-3 space-y-2">
            {job.notes.map((n, i) => (
              <li key={i} className="rounded-lg border border-slate-100 px-3 py-2">
                <div className="text-sm text-slate-700">{n.text}</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {n.by} · {n.label}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Before/After capture — live from the technician app */}
        <JobMediaGallery jobKey={String(job.token)} />
      </Card>

      {/* Estimate */}
      <Card className="p-4 md:p-5">
        <SectionHeader
          title="Estimate"
          sub={ESTIMATE_LABEL[est?.status] || "Not yet estimated"}
          action={
            !closed && (
              <Button
                size="sm"
                variant={hasEstimate(job) ? "secondary" : "primary"}
                onClick={() => setModal("estimate")}
              >
                {hasEstimate(job) ? "Edit Estimate" : "Set Estimate"}
              </Button>
            )
          }
        />

        {hasEstimate(job) ? (
          <div className="mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                  <th className="pb-2">Part</th>
                  <th className="pb-2 text-center">Qty</th>
                  <th className="pb-2 text-right">Unit</th>
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {est.parts.map((p, i) => (
                  <tr key={i}>
                    <td className="py-2 font-medium text-slate-700">{p.name}</td>
                    <td className="py-2 text-center text-slate-500">{p.qty}</td>
                    <td className="py-2 text-right text-slate-500">{formatPKR(p.unitPrice)}</td>
                    <td className="py-2 text-right font-semibold text-slate-800">
                      {formatPKR(p.qty * p.unitPrice)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2 font-medium text-slate-700">
                    Labor{" "}
                    <span className="text-xs text-slate-400">
                      ({est.laborHours}h × {formatPKR(est.laborRate)})
                    </span>
                  </td>
                  <td />
                  <td />
                  <td className="py-2 text-right font-semibold text-slate-800">
                    {formatPKR(laborTotal(est))}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200">
                  <td className="pt-2 text-sm font-extrabold text-slate-900" colSpan={3}>
                    Grand Total
                  </td>
                  <td className="pt-2 text-right text-lg font-extrabold text-slate-900">
                    {formatPKR(estimateTotal(est))}
                  </td>
                </tr>
              </tfoot>
            </table>

            {est.status === "estimated" && !closed && (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => app.setEstimateStatus(job.id, "approved")}
                >
                  <CheckCircle2 className="h-4 w-4" /> Mark Approved
                </Button>
                <Button
                  size="sm"
                  variant="outlineDanger"
                  onClick={() => app.setEstimateStatus(job.id, "declined")}
                >
                  <XCircle className="h-4 w-4" /> Decline
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            No estimate yet. Set one to itemize parts and labor.
          </p>
        )}
      </Card>

      {/* Bill — original (auto) vs negotiated (agreed on-site) */}
      <Card className="p-4 md:p-5">
        <SectionHeader
          title="Bill"
          sub={negotiated ? "Negotiated on-site" : "Auto-generated"}
          action={
            !closed &&
            hasBill(job) && (
              <Button size="sm" variant="secondary" onClick={() => setModal("negotiate")}>
                <Handshake className="h-4 w-4" /> {negotiated ? "Edit Negotiated" : "Negotiate"}
              </Button>
            )
          }
        />
        {hasBill(job) ? (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                  <Receipt className="h-3.5 w-3.5" /> Original Bill
                </div>
                <div className="mt-1 text-xl font-extrabold text-slate-900">
                  {formatPKR(original)}
                </div>
                <div className="text-[11px] text-slate-400">Auto-generated by the system</div>
              </div>
              <div
                className={`rounded-xl border p-3 ${
                  negotiated
                    ? "border-amber-200 bg-amber-50"
                    : "border-dashed border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-500">
                  <Handshake className="h-3.5 w-3.5" /> Negotiated Bill
                </div>
                {negotiated ? (
                  <>
                    <div className="mt-1 text-xl font-extrabold text-amber-700">
                      {formatPKR(payable)}
                    </div>
                    <div className="text-[11px] text-amber-600">
                      {discount > 0
                        ? `Rs ${discount.toLocaleString("en-PK")} concession`
                        : "Agreed with customer"}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-sm font-semibold text-slate-400">Not negotiated</div>
                )}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Both amounts are stored separately for accounting and revenue reporting.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            No bill yet — it’s generated from the estimate / completion form.
          </p>
        )}
      </Card>

      {/* Cash & Revenue — append-only ledger with corrections */}
      <Card className="p-4 md:p-5">
        <SectionHeader
          title="Cash & Revenue"
          action={
            !closed &&
            hasBill(job) && (
              <Button size="sm" variant="success" onClick={() => setModal("payment")}>
                <Wallet className="h-4 w-4" /> Log Payment
              </Button>
            )
          }
        />
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Owed</div>
            <div className="mt-1 text-lg font-extrabold text-slate-900">{formatPKR(owed)}</div>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center">
            <div className="text-xs font-bold uppercase tracking-wide text-emerald-500">
              Received
            </div>
            <div className="mt-1 text-lg font-extrabold text-emerald-700">{formatPKR(paid)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Balance</div>
            <div className="mt-1 text-lg font-extrabold text-slate-900">{formatPKR(bal)}</div>
          </div>
        </div>

        {entries.length > 0 && (
          <ul className="mt-3 space-y-2">
            {entries.map((e) => (
              <li
                key={e.id}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                  e.voided ? "border-slate-100 bg-slate-50 text-slate-400" : "border-slate-200"
                }`}
              >
                <div className="min-w-0">
                  <div className={`font-semibold ${e.voided ? "line-through" : "text-slate-800"}`}>
                    {formatPKR(e.amount)}{" "}
                    <span className="text-xs font-normal capitalize text-slate-400">
                      · {e.method}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {e.label}
                    {e.voided ? ` · voided — ${e.voidReason}` : ""}
                  </div>
                </div>
                {!closed && !e.voided && (
                  <button
                    onClick={() => {
                      setCorrectTarget(e);
                      setModal("correct");
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Correct
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          Append-only ledger — corrections void an entry, never edit it.
        </p>
      </Card>

      {/* Timeline */}
      <Card className="p-4 md:p-5">
        <SectionHeader title="Timeline" />
        <ol className="mt-3 space-y-3">
          {[...(job.timeline || [])].reverse().map((e, i) => (
            <li key={i} className="flex gap-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${kindDot(e.kind)}`} />
              <div>
                <div className="text-sm font-medium text-slate-700">{e.text}</div>
                <div className="text-xs text-slate-400">{e.label}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {/* Action bar */}
      {!closed && (
        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-xl md:border md:shadow-lg">
          <div className="flex flex-wrap gap-2">
            {job.estimate?.status === "approved" && job.status !== "ready" && (
              <Button variant="success" onClick={() => app.markReady(job.id)}>
                <BellRing className="h-4 w-4" /> Mark Ready & SMS
              </Button>
            )}
            {job.status === "ready" && (
              <Button variant="primary" onClick={() => app.closeJob(job.id)}>
                <Lock className="h-4 w-4" /> Close Job
              </Button>
            )}
            <Button variant="secondary" onClick={() => setModal("note")}>
              <Plus className="h-4 w-4" /> Note
            </Button>
            <Button variant="secondary" onClick={() => setModal("followup")}>
              <PhoneCall className="h-4 w-4" /> Follow Up
            </Button>
            {isVisit && (
              <>
                <Button variant="secondary" onClick={() => app.haulToShop(job.id)}>
                  <Truck className="h-4 w-4" /> Haul to Shop
                </Button>
                <Button variant="secondary" onClick={() => setModal("reschedule")}>
                  <CalendarClock className="h-4 w-4" /> Reschedule
                </Button>
              </>
            )}
            <Button variant="outlineDanger" onClick={() => setModal("abandon")} className="ml-auto">
              <Ban className="h-4 w-4" /> Abandon
            </Button>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      <NoteModal
        open={modal === "note"}
        onClose={() => setModal(null)}
        onSave={(text) => {
          app.addNote(job.id, text);
          setModal(null);
        }}
      />
      <EstimateEditor
        open={modal === "estimate"}
        onClose={() => setModal(null)}
        job={job}
        rate={app.RATE}
        onSave={(payload) => {
          app.setEstimate(job.id, payload);
          setModal(null);
        }}
      />
      <PaymentModal
        open={modal === "payment"}
        onClose={() => setModal(null)}
        balance={bal}
        onSave={(payload) => {
          app.logPayment(job.id, payload);
          setModal(null);
        }}
      />
      <NegotiateModal
        open={modal === "negotiate"}
        onClose={() => setModal(null)}
        original={original}
        current={negotiated ? payable : original}
        onSave={(payload) => {
          app.setNegotiatedBill(job.id, payload);
          setModal(null);
        }}
      />
      <CorrectModal
        open={modal === "correct"}
        entry={correctTarget}
        onClose={() => {
          setModal(null);
          setCorrectTarget(null);
        }}
        onSave={(reason) => {
          if (correctTarget) app.voidRevenueEntry(job.id, correctTarget.id, reason);
          setModal(null);
          setCorrectTarget(null);
        }}
      />
      <TextModal
        open={modal === "followup"}
        onClose={() => setModal(null)}
        title="Log Follow-up"
        label="What happened?"
        placeholder="e.g. Called customer, will collect tomorrow"
        confirmLabel="Save Follow-up"
        onSave={(text) => {
          app.followUp(job.id, text);
          setModal(null);
        }}
      />
      <TextModal
        open={modal === "abandon"}
        onClose={() => setModal(null)}
        title="Abandon Job"
        label="Reason"
        placeholder="e.g. Customer declined repair, irreparable"
        confirmLabel="Abandon Job"
        danger
        onSave={(text) => {
          app.abandonJob(job.id, text);
          setModal(null);
        }}
      />
      <RescheduleModal
        open={modal === "reschedule"}
        onClose={() => setModal(null)}
        job={job}
        onSave={(payload) => {
          app.reschedule(job.id, payload);
          setModal(null);
        }}
      />
    </div>
  );
}

/* ──────────────────────────── Sub-components ──────────────────────────── */

function NoteModal({ open, onClose, onSave }) {
  const [text, setText] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Note"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={() => {
              onSave(text.trim());
              setText("");
            }}
          >
            Save Note
          </Button>
        </>
      }
    >
      <Field label="Diagnosis / Note">
        <textarea
          className={inputClass}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What did you find?"
          autoFocus
        />
      </Field>
    </Modal>
  );
}

function TextModal({ open, onClose, onSave, title, label, placeholder, confirmLabel, danger }) {
  const [text, setText] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={!text.trim()}
            onClick={() => {
              onSave(text.trim());
              setText("");
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={label}>
        <textarea
          className={inputClass}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          autoFocus
        />
      </Field>
    </Modal>
  );
}

function PaymentModal({ open, onClose, onSave, balance }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const val = amount === "" ? balance : Number(amount);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log Payment"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="success"
            disabled={!val || val <= 0}
            onClick={() => {
              onSave({ amount: val, method });
              setAmount("");
            }}
          >
            Record {formatPKR(val || 0)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Amount" hint={`Balance due: ${formatPKR(balance)}`}>
          <input
            type="number"
            className={inputClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(balance)}
            autoFocus
          />
        </Field>
        <Field label="Method">
          <div className="flex gap-2">
            {["cash", "card"].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold capitalize transition ${
                  method === m
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-600"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function NegotiateModal({ open, onClose, onSave, original, current }) {
  const [amount, setAmount] = useState(String(current ?? ""));
  const [note, setNote] = useState("");
  const val = amount === "" ? 0 : Number(amount);
  const concession = Math.max(0, original - val);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Negotiated Amount"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!val || val <= 0}
            onClick={() => onSave({ amount: val, note: note.trim() })}
          >
            Save Negotiated Bill
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-400">Original (auto) </span>
          <span className="font-bold text-slate-800">{formatPKR(original)}</span>
        </div>
        <Field label="Agreed amount" hint="Final figure accepted by the customer on-site">
          <input
            type="number"
            className={inputClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(original)}
            autoFocus
          />
        </Field>
        {concession > 0 ? (
          <div className="text-xs font-semibold text-amber-600">
            Rs {concession.toLocaleString("en-PK")} concession vs the original bill
          </div>
        ) : null}
        <Field label="Note (optional)">
          <input
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. waived call-out fee"
          />
        </Field>
      </div>
    </Modal>
  );
}

function CorrectModal({ open, onClose, onSave, entry }) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Correct Revenue Entry"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!reason.trim()} onClick={() => onSave(reason.trim())}>
            Void Entry
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {entry ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
            Voiding <span className="font-bold text-slate-800">{formatPKR(entry.amount)}</span>{" "}
            <span className="capitalize text-slate-400">· {entry.method}</span>
          </div>
        ) : null}
        <p className="text-xs text-slate-500">
          The entry is kept (struck through) for the audit trail. Re-log the correct amount with
          “Log Payment” afterward.
        </p>
        <Field label="Reason">
          <input
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. wrong amount, duplicate entry"
            autoFocus
          />
        </Field>
      </div>
    </Modal>
  );
}

function RescheduleModal({ open, onClose, onSave, job }) {
  const [preferredDate, setDate] = useState(job.preferredDate || "");
  const [timeWindow, setWindow] = useState(job.timeWindow || "");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reschedule Visit"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave({ preferredDate, timeWindow })}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Preferred Date">
          <input
            type="date"
            className={inputClass}
            value={preferredDate}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Time Window">
          <input
            className={inputClass}
            value={timeWindow}
            onChange={(e) => setWindow(e.target.value)}
            placeholder="e.g. 2–4 PM"
          />
        </Field>
      </div>
    </Modal>
  );
}

function EstimateEditor({ open, onClose, onSave, job, rate }) {
  const [parts, setParts] = useState(() =>
    job.estimate?.parts?.length
      ? job.estimate.parts.map((p) => ({ ...p }))
      : [{ name: "", qty: 1, unitPrice: "" }]
  );
  const [laborHours, setLaborHours] = useState(job.estimate?.laborHours || 1);

  const setPart = (i, key, value) =>
    setParts((ps) => ps.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)));
  const addRow = () => setParts((ps) => [...ps, { name: "", qty: 1, unitPrice: "" }]);
  const removeRow = (i) => setParts((ps) => ps.filter((_, idx) => idx !== i));

  const cleanParts = parts
    .filter((p) => p.name.trim() && Number(p.unitPrice) > 0)
    .map((p) => ({ name: p.name.trim(), qty: Number(p.qty) || 1, unitPrice: Number(p.unitPrice) }));
  const preview = { parts: cleanParts, laborHours: Number(laborHours) || 0, laborRate: rate };
  const total = estimateTotal(preview);

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Set Estimate"
      subtitle="Itemize parts and labor"
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm">
            <span className="text-slate-400">Total </span>
            <span className="font-extrabold text-slate-900">{formatPKR(total)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!cleanParts.length} onClick={() => onSave(preview)}>
              Save Estimate
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Parts</div>
        {parts.map((p, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-3">
            <input
              className={`${inputClass} mb-2`}
              value={p.name}
              onChange={(e) => setPart(i, "name", e.target.value)}
              placeholder="Part name (e.g. Run capacitor 35μF)"
            />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                Qty
                <input
                  type="number"
                  className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  value={p.qty}
                  min={1}
                  onChange={(e) => setPart(i, "qty", e.target.value)}
                />
              </label>
              <label className="flex flex-1 items-center gap-1.5 text-xs text-slate-500">
                Unit Rs
                <input
                  type="number"
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  value={p.unitPrice}
                  onChange={(e) => setPart(i, "unitPrice", e.target.value)}
                  placeholder="0"
                />
              </label>
              {parts.length > 1 && (
                <button
                  onClick={() => removeRow(i)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                  aria-label="Remove part"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={addRow}>
          <Plus className="h-4 w-4" /> Add Part
        </Button>

        <div className="pt-2">
          <Field label="Labor Hours" hint={`Rate ${formatPKR(rate)}/hour`}>
            <input
              type="number"
              step="0.5"
              min={0}
              className={inputClass}
              value={laborHours}
              onChange={(e) => setLaborHours(e.target.value)}
            />
          </Field>
        </div>

        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <div className="flex justify-between text-slate-500">
            <span>Parts</span>
            <span className="font-semibold text-slate-700">{formatPKR(partsTotal(preview))}</span>
          </div>
          <div className="mt-1 flex justify-between text-slate-500">
            <span>Labor</span>
            <span className="font-semibold text-slate-700">{formatPKR(laborTotal(preview))}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base">
            <span className="font-extrabold text-slate-900">Total</span>
            <span className="font-extrabold text-slate-900">{formatPKR(total)}</span>
          </div>
        </div>
      </div>
    </SlideOver>
  );
}
