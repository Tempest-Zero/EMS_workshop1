export function partsTotal(estimate) {
  if (!estimate || !estimate.parts) return 0;
  return estimate.parts.reduce((s, p) => s + p.qty * p.unitPrice, 0);
}

export function laborTotal(estimate) {
  if (!estimate) return 0;
  return (estimate.laborHours || 0) * (estimate.laborRate || 0);
}

export function estimateTotal(estimate) {
  return partsTotal(estimate) + laborTotal(estimate);
}

export function hasEstimate(job) {
  return job.estimate && job.estimate.status && job.estimate.status !== "none";
}

// ── Bill: original (auto-generated) vs negotiated (agreed on-site) ──────────
function estimateAmount(job) {
  return hasEstimate(job) ? estimateTotal(job.estimate) : 0;
}

// The auto-generated "original" bill. Falls back to the estimate total until a
// work-completion form sets an explicit amount.
export function billOriginal(job) {
  return job.bill?.original != null ? job.bill.original : estimateAmount(job);
}

// The amount actually payable: the technician's negotiated figure if one was
// logged, otherwise the original.
export function billPayable(job) {
  return job.bill?.negotiated != null ? job.bill.negotiated : billOriginal(job);
}

// Concession given during on-site negotiation (never negative).
export function billDiscount(job) {
  return Math.max(0, billOriginal(job) - billPayable(job));
}

export function isNegotiated(job) {
  return job.bill?.negotiated != null;
}

export function hasBill(job) {
  return billOriginal(job) > 0;
}

// ── Cash / revenue ledger ──────────────────────────────────────────────────
export function revenueEntries(job) {
  return Array.isArray(job.revenue) ? job.revenue : [];
}

export function amountOwed(job) {
  return billPayable(job);
}

export function amountPaid(job) {
  const entries = revenueEntries(job);
  if (entries.length) {
    // Append-only ledger: voided entries (corrections) don't count.
    return entries.filter((e) => !e.voided).reduce((s, e) => s + Number(e.amount || 0), 0);
  }
  return job.payment?.paid || 0; // backward-compat with the older single-field shape
}

export function balance(job) {
  return amountOwed(job) - amountPaid(job);
}

// ── Work completion → auto-generated bill ──────────────────────────────────
const DEFAULT_RATE = 1200;

export function materialsTotal(completion) {
  if (!completion || !completion.materials) return 0;
  return completion.materials.reduce(
    (s, m) => s + (Number(m.qty) || 0) * (Number(m.unitPrice) || 0),
    0
  );
}

export function completionLabor(completion, rate = DEFAULT_RATE) {
  if (!completion) return 0;
  return Math.round(((Number(completion.timeSpentMins) || 0) / 60) * rate);
}

// The bill the completion form generates: materials + labour (from time) + fuel.
export function completionTotal(completion, rate = DEFAULT_RATE) {
  if (!completion) return 0;
  return (
    materialsTotal(completion) +
    completionLabor(completion, rate) +
    (Number(completion.fuelAmount) || 0)
  );
}

export function hasCompletion(job) {
  return Boolean(job.completion && job.completion.submittedAt);
}

export const ESTIMATE_LABEL = {
  none: "Not yet estimated",
  estimated: "Estimated — Awaiting Approval",
  approved: "Approved",
  declined: "Declined",
};
