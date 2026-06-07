/**
 * Integer paisa ↔ display. Money is ALWAYS integer paisa end-to-end; the only
 * float is at the input boundary when a technician types rupees.
 */

export function formatPaisa(paisa: number | null | undefined): string {
  const p = paisa ?? 0;
  return `Rs ${Math.round(p / 100).toLocaleString("en-PK")}`;
}

/** Technician types rupees → integer paisa. */
export function rupeesToPaisa(rupees: string | number): number {
  const n = typeof rupees === "string" ? parseFloat(rupees) : rupees;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
