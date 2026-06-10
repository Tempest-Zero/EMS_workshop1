// The real current date (local, YYYY-MM-DD). This was a hardcoded anchor while
// the app ran on seed data; with live data a frozen "today" silently killed the
// Dashboard aging alerts and the header date. Evaluated once per page load —
// fine for a console that is reopened daily. Tests pass an explicit `ref` to
// date helpers instead of relying on this value.
function localISODate() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}
export const TODAY = localISODate();

export const STATUSES = ["open", "waiting", "ready", "closed"];

export const APPLIANCE_TYPES = [
  "Split AC",
  "Window AC",
  "Washing Machine",
  "Refrigerator",
  "Microwave",
  "Oven",
  "Other",
];

export const WORKSHOP = {
  name: "FixFlow Workshop",
  location: "Karachi, Pakistan",
  workingDaysThisMonth: 26,
};
