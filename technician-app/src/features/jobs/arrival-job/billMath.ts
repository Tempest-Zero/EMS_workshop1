/**
 * Pure money rules for the bill sheet (F15) — extracted from
 * ArrivalJobBillScreen so the two rules that guard a real payment are
 * unit-testable. Everything here is integer paisa; the ONLY rupee value is
 * the string `defaultPayRs` returns for the payment input (the UI edge).
 */

/** The suggested payment for an outstanding balance: whole rupees, or empty
 * when nothing is owed (zero or overpaid). */
export function defaultPayRs(balancePaisa: number): string {
  return balancePaisa > 0 ? String(Math.round(balancePaisa / 100)) : "";
}

/** Whether the negotiated input holds an amount the server doesn't. `> 0`
 * gates out the empty/zero input; the comparison falls back to the original
 * bill when nothing has been negotiated yet. */
export function isNegotiateDirty(
  negotiatedPaisa: number,
  billNegotiatedPaisa: number | null,
  originalPaisa: number,
): boolean {
  return negotiatedPaisa > 0 && negotiatedPaisa !== (billNegotiatedPaisa ?? originalPaisa);
}
