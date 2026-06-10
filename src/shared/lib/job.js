// ── Bill: original (auto-generated) vs negotiated (agreed on-site) ──────────
// The bill exists only once the technician's completion form generates it on
// the server — there is no client-side estimate fallback.
export function billOriginal(job) {
  return job.bill?.original ?? 0;
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
  // Append-only ledger: voided entries (corrections) don't count.
  return revenueEntries(job)
    .filter((e) => !e.voided)
    .reduce((s, e) => s + Number(e.amount || 0), 0);
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

// ── Assignment (Module 2 dual assignment) ──────────────────────────────────
export function isUnassigned(job) {
  return !job.assignedTechId;
}
