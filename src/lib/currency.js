// Pakistani Rupee formatting — "Rs 4,500".
export function formatPKR(amount) {
  if (amount == null || Number.isNaN(amount)) return "Rs 0";
  const n = Math.round(Number(amount));
  return `Rs ${n.toLocaleString("en-PK")}`;
}
