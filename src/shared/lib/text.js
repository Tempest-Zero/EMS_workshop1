// Small, dependency-free text helpers shared across features.

// "Imran Ahmed" -> "IA"
export function initials(name) {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
