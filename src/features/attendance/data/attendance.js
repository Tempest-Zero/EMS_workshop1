import { TODAY } from "@shared/config/constants";

// May 2026, generated up to TODAY (the 30th). Sundays (3,10,17,24) are holidays.
// status: present | absent | leave | half | field | holiday
const YEAR = 2026;
const DAYS_ELAPSED = 30;

function iso(d) {
  return `${YEAR}-05-${String(d).padStart(2, "0")}`;
}
function isSunday(d) {
  return new Date(`${iso(d)}T00:00:00`).getDay() === 0;
}

// Per-tech overrides; any working day not listed defaults to "present".
const exceptions = {
  t1: { 7: "leave", 14: "half" },
  t2: { 12: "leave", 21: "half" },
  t3: { 5: "leave", 6: "absent", 13: "absent", 20: "absent", 27: "absent", 30: "absent" },
  t4: { 19: "leave" },
  t5: { 8: "field", 15: "field", 22: "field", 29: "field", 30: "field" },
};

// Today's punch-in times must match the Attendance "Today" table.
const todayClockIn = { t1: "9:02 AM", t2: "8:45 AM", t4: "9:15 AM", t5: "8:30 AM" };

function clockInFor(d) {
  const opts = ["8:40 AM", "8:52 AM", "9:05 AM", "8:48 AM", "9:12 AM", "8:35 AM", "9:00 AM"];
  return opts[d % opts.length];
}
function clockOutFor(d) {
  const opts = ["5:40 PM", "6:05 PM", "5:50 PM", "6:15 PM", "5:35 PM", "6:00 PM"];
  return opts[d % opts.length];
}

function buildTech(id) {
  const ex = exceptions[id] || {};
  const rows = [];
  for (let d = 1; d <= DAYS_ELAPSED; d++) {
    if (isSunday(d)) {
      rows.push({ date: iso(d), status: "holiday", clockIn: null, clockOut: null });
      continue;
    }
    const status = ex[d] || "present";
    const isToday = d === 30;
    let clockIn = null;
    let clockOut = null;
    if (status === "present" || status === "field" || status === "half") {
      clockIn = isToday && todayClockIn[id] ? todayClockIn[id] : clockInFor(d);
      clockOut = isToday ? null : status === "half" ? "1:00 PM" : clockOutFor(d);
    }
    rows.push({ date: iso(d), status, clockIn, clockOut });
  }
  return rows;
}

export const attendance = {
  t1: buildTech("t1"),
  t2: buildTech("t2"),
  t3: buildTech("t3"),
  t4: buildTech("t4"),
  t5: buildTech("t5"),
};

export function monthSummary(techId) {
  const rows = attendance[techId] || [];
  const present = rows.filter((r) => ["present", "field", "half"].includes(r.status)).length;
  const working = rows.filter((r) => r.status !== "holiday").length;
  return { present, working };
}

export function todayRecord(techId) {
  return (attendance[techId] || []).find((r) => r.date === TODAY);
}
