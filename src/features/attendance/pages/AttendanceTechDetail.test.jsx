import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@app/providers/AppContext", () => ({
  useApp: () => ({
    technicians: [
      { id: "t1", name: "Imran Ahmed", specialty: "AC Specialist", avatar: "bg-indigo-500" },
    ],
  }),
}));

vi.mock("@features/attendance/hooks/useTechDetail", () => ({
  useTechDetail: () => ({
    days: [
      // The crux: phone reached the workshop but the tech never clocked in.
      {
        day: "2026-06-10",
        status: "absent",
        late: false,
        first_in: null,
        last_out: null,
        worked_minutes: null,
        punches: [],
        presence: [
          {
            id: "p1",
            kind: "arrive",
            server_time: "2026-06-10T09:03:00",
            inside_geofence: true,
            is_mock_location: false,
          },
        ],
        arrived_not_clocked_in: true,
      },
    ],
    adjustments: [],
    loading: false,
    error: null,
    reload: () => {},
  }),
}));

import AttendanceTechDetail from "./AttendanceTechDetail";

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/attendance/t1"]}>
      <Routes>
        <Route path="/attendance/:techId" element={<AttendanceTechDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("<AttendanceTechDetail />", () => {
  it("surfaces a geofence arrival with no clock-in (the 'forgot vs absent' signal)", () => {
    renderDetail();
    expect(screen.getByText(/no clock-in was recorded/i)).toBeInTheDocument();
    expect(screen.getByText("Geofence activity")).toBeInTheDocument();
    // Exact match → only the timeline span, not the banner sentence that also
    // contains the phrase.
    expect(screen.getByText("Reached the workshop")).toBeInTheDocument();
  });
});
