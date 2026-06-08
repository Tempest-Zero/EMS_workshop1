// Pakistani Rupee formatting — "Rs 4,500".
//
// The API speaks integer **paisa** end-to-end; the web displays whole rupees.
// Convert at the boundary: `mapJob` turns API paisa → rupees on the way in, and
// the AppContext mutators turn rupees → paisa on the way out. `formatPKR` itself
// stays a plain rupee formatter so the (still-local) estimate keeps rendering.
export function formatPKR(amount) {
  if (amount == null || Number.isNaN(amount)) return "Rs 0";
  const n = Math.round(Number(amount));
  return `Rs ${n.toLocaleString("en-PK")}`;
}

/** Display/UI rupees → integer paisa (API boundary, outbound). */
export function rupeesToPaisa(rupees) {
  const n = Number(rupees);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** API integer paisa → rupees for display (API boundary, inbound). `null`/
 * `undefined` passes through so "no bill yet" stays distinguishable from "Rs 0". */
export function paisaToRupees(paisa) {
  if (paisa == null) return null;
  const n = Number(paisa);
  return Number.isFinite(n) ? Math.round(n) / 100 : 0;
}
