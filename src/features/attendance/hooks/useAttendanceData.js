/** Loads the manager board + monthly grid from the API for a roster + month. */

import { useEffect, useState } from "react";

import { fetchBoard, fetchGrid } from "@features/attendance/data/attendanceApi";

export function useAttendanceData(techIds, month) {
  const [board, setBoard] = useState(null);
  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // setState lives only in the async callbacks (not the synchronous effect body),
  // which is what the react-hooks/set-state-in-effect rule allows.
  useEffect(() => {
    let active = true;
    Promise.all([fetchBoard(techIds), fetchGrid(month, techIds)])
      .then(([b, g]) => {
        if (!active) return;
        setBoard(b);
        setGrid(g);
        setError(null);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [techIds, month]);

  return { board, grid, loading, error };
}
