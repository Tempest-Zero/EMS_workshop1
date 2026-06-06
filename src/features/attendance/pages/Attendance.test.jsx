import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@app/providers/AppContext", () => ({
  useApp: () => ({
    technicians: [
      { id: "t1", name: "Imran Ahmed", specialty: "AC Specialist", avatar: "bg-indigo-500" },
      { id: "t2", name: "Kashif Raza", specialty: "General Repair", avatar: "bg-emerald-600" },
    ],
  }),
}));

vi.mock("@features/attendance/hooks/useAttendanceData", () => ({
  useAttendanceData: () => ({
    loading: false,
    error: null,
    board: {
      rows: [
        {
          tech_id: "t1",
          status: "present",
          late: true,
          first_in: "2026-06-04T09:20:00",
          last_out: "2026-06-04T18:00:00",
          worked_minutes: 520,
          wifi_match: true,
          flagged_mock: false,
          flagged_outside: false,
          flagged_drift: false,
        },
        {
          tech_id: "t2",
          status: "field",
          late: false,
          first_in: "2026-06-04T09:00:00",
          last_out: null,
          worked_minutes: null,
          wifi_match: false,
          flagged_mock: false,
          flagged_outside: true,
          flagged_drift: false,
        },
      ],
    },
    grid: {
      month: "2026-06",
      rows: [
        {
          tech_id: "t1",
          present: 3,
          working: 4,
          cells: [{ day: "2026-06-01", status: "present", late: false }],
        },
        {
          tech_id: "t2",
          present: 2,
          working: 4,
          cells: [{ day: "2026-06-01", status: "field", late: false }],
        },
      ],
    },
  }),
}));

import Attendance from "./Attendance";

describe("<Attendance />", () => {
  it("renders the board and grid from the API", () => {
    render(
      <MemoryRouter>
        <Attendance />
      </MemoryRouter>
    );
    // Names appear in both the board table and the grid row.
    expect(screen.getAllByText("Imran Ahmed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kashif Raza").length).toBeGreaterThan(0);
    expect(screen.getByText("LATE")).toBeInTheDocument();
    expect(screen.getByText("3/4 present")).toBeInTheDocument();
    expect(screen.getByText("Jun 2026")).toBeInTheDocument();
  });
});
