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

export function amountOwed(job) {
  return hasEstimate(job) ? estimateTotal(job.estimate) : 0;
}

export function amountPaid(job) {
  return job.payment?.paid || 0;
}

export function balance(job) {
  return amountOwed(job) - amountPaid(job);
}

export const ESTIMATE_LABEL = {
  none: "Not yet estimated",
  estimated: "Estimated — Awaiting Approval",
  approved: "Approved",
  declined: "Declined",
};
