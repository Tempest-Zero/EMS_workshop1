import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@app/providers/AppContext", () => ({
  useApp: () => ({
    technicians: [
      { id: "t1", name: "Imran Ahmed", specialty: "AC Specialist", avatar: "bg-indigo-500" },
    ],
  }),
}));

vi.mock("@features/attendance/data/attendanceApi", () => ({
  fetchVariance: vi.fn(() =>
    Promise.resolve({
      shop_id: "default",
      from_date: "2026-06-03",
      to_date: "2026-06-03",
      rows: [
        {
          tech_id: "t1",
          date: "2026-06-03",
          status: "present",
          first_arrive: "2026-06-03T08:50:00",
          first_clock_in: "2026-06-03T09:35:00",
          delta_in_minutes: 45, // beyond ±10 → amber
          last_depart: "2026-06-03T18:10:00",
          last_clock_out: "2026-06-03T18:00:00",
          delta_out_minutes: 10, // within ±10 → neutral
          clocked_minutes: 505,
          inside_minutes: null,
          outside_minutes: null,
          no_data_minutes: null,
          coverage_pct: null,
          away_intervals: [],
          flagged_arrived_not_clocked_in: false,
          flagged_order: false,
          flagged_away: false,
        },
      ],
    })
  ),
}));

import AttendanceVariance from "./AttendanceVariance";

describe("<AttendanceVariance />", () => {
  it("renders variance rows with the arrival/departure deltas from the API", async () => {
    render(
      <MemoryRouter>
        <AttendanceVariance />
      </MemoryRouter>
    );
    // Row loads async (useEffect → fetchVariance).
    expect(await screen.findByText("Imran Ahmed")).toBeInTheDocument();
    expect(screen.getByText("+45m")).toBeInTheDocument(); // arrival delta
    expect(screen.getByText("+10m")).toBeInTheDocument(); // departure delta
  });
});
