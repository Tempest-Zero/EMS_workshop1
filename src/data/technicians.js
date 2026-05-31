// 5 workshop technicians. `status` is today's presence: present | absent | field.
export const technicians = [
  {
    id: "t1",
    name: "Imran Ahmed",
    specialty: "AC Specialist",
    status: "present",
    phone: "0312-2345678",
    joinedDate: "2021-03-15",
    avatar: "bg-indigo-500",
    perf: { completed: 16, avgDays: 1.6 },
    pay: [
      { month: "May 2026", base: 52000, daysWorked: 24, deductions: 0, advances: 5000, net: 47000 },
      { month: "Apr 2026", base: 52000, daysWorked: 25, deductions: 1000, advances: 0, net: 51000 },
      { month: "Mar 2026", base: 52000, daysWorked: 26, deductions: 0, advances: 3000, net: 49000 },
    ],
  },
  {
    id: "t2",
    name: "Kashif Raza",
    specialty: "General Repair",
    status: "present",
    phone: "0321-3456789",
    joinedDate: "2022-07-01",
    avatar: "bg-emerald-600",
    perf: { completed: 19, avgDays: 1.2 },
    pay: [
      { month: "May 2026", base: 45000, daysWorked: 23, deductions: 0, advances: 0, net: 45000 },
      { month: "Apr 2026", base: 45000, daysWorked: 24, deductions: 500, advances: 4000, net: 40500 },
      { month: "Mar 2026", base: 45000, daysWorked: 26, deductions: 0, advances: 2000, net: 43000 },
    ],
  },
  {
    id: "t3",
    name: "Tariq Mehmood",
    specialty: "Washing Machine",
    status: "absent",
    phone: "0333-4567890",
    joinedDate: "2023-01-20",
    avatar: "bg-amber-500",
    perf: { completed: 11, avgDays: 1.9 },
    pay: [
      { month: "May 2026", base: 42000, daysWorked: 20, deductions: 2000, advances: 0, net: 40000 },
      { month: "Apr 2026", base: 42000, daysWorked: 22, deductions: 1500, advances: 3000, net: 37500 },
      { month: "Mar 2026", base: 42000, daysWorked: 24, deductions: 0, advances: 0, net: 42000 },
    ],
  },
  {
    id: "t4",
    name: "Asif Ali",
    specialty: "Refrigeration",
    status: "present",
    phone: "0300-5678901",
    joinedDate: "2020-11-10",
    avatar: "bg-rose-500",
    perf: { completed: 14, avgDays: 2.1 },
    pay: [
      { month: "May 2026", base: 48000, daysWorked: 25, deductions: 0, advances: 2000, net: 46000 },
      { month: "Apr 2026", base: 48000, daysWorked: 26, deductions: 0, advances: 0, net: 48000 },
      { month: "Mar 2026", base: 48000, daysWorked: 24, deductions: 1000, advances: 5000, net: 42000 },
    ],
  },
  {
    id: "t5",
    name: "Bilal Khan",
    specialty: "General Repair",
    status: "field",
    phone: "0345-6789012",
    joinedDate: "2023-09-05",
    avatar: "bg-sky-600",
    perf: { completed: 13, avgDays: 1.5 },
    pay: [
      { month: "May 2026", base: 40000, daysWorked: 24, deductions: 0, advances: 3000, net: 37000 },
      { month: "Apr 2026", base: 40000, daysWorked: 23, deductions: 1000, advances: 0, net: 39000 },
      { month: "Mar 2026", base: 40000, daysWorked: 25, deductions: 0, advances: 1500, net: 38500 },
    ],
  },
];

export function initials(name) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function techById(id) {
  return technicians.find((t) => t.id === id);
}
