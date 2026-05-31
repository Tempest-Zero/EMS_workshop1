// Current week (Mon–Sat) containing TODAY (2026-05-30, Sat).
export const weekDays = [
  { label: "Mon", date: "2026-05-25" },
  { label: "Tue", date: "2026-05-26" },
  { label: "Wed", date: "2026-05-27" },
  { label: "Thu", date: "2026-05-28" },
  { label: "Fri", date: "2026-05-29" },
  { label: "Sat", date: "2026-05-30" },
];

// kind: bench (carry-in shop work) | visit (home visit, has a time window)
export const assignments = [
  { techId: "t1", date: "2026-05-25", jobId: "1042", kind: "bench" },
  { techId: "t1", date: "2026-05-26", jobId: "1042", kind: "bench" },
  { techId: "t1", date: "2026-05-30", jobId: "1046", kind: "visit", window: "11:00 AM – 1:00 PM" },
  { techId: "t1", date: "2026-05-30", jobId: "1051", kind: "bench" },

  { techId: "t2", date: "2026-05-28", jobId: "1041", kind: "bench" },
  { techId: "t2", date: "2026-05-29", jobId: "1047", kind: "bench" },
  { techId: "t2", date: "2026-05-30", jobId: "1050", kind: "bench" },
  { techId: "t2", date: "2026-05-30", jobId: "1045", kind: "bench" },

  { techId: "t3", date: "2026-05-27", jobId: "1044", kind: "bench" },

  { techId: "t4", date: "2026-05-26", jobId: "1040", kind: "bench" },
  { techId: "t4", date: "2026-05-28", jobId: "1043", kind: "visit", window: "3:00 PM – 4:00 PM" },
  { techId: "t4", date: "2026-05-29", jobId: "1048", kind: "bench" },

  { techId: "t5", date: "2026-05-30", jobId: "1049", kind: "visit", window: "2:00 PM – 4:00 PM" },
];

export function assignmentsFor(techId, date) {
  return assignments.filter((a) => a.techId === techId && a.date === date);
}

export function weekForTech(techId) {
  return weekDays.map((d) => ({
    ...d,
    items: assignments.filter((a) => a.techId === techId && a.date === d.date),
  }));
}
