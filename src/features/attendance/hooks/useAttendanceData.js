/**
 * Loads the manager board + monthly grid from the API for a roster + month.
 * The board auto-refreshes every 60 seconds to justify the "Live" badge.
 * The grid is fetched only when the month changes (historical data).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchBoard, fetchGrid } from "@features/attendance/data/attendanceApi";

const BOARD_REFRESH_MS = 60_000;

export function useAttendanceData(techIds, month) {
  const [board, setBoard] = useState(null);
  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Mirror the latest techIds into a ref from an effect (never during render —
  // react-hooks/refs) so the interval callback reads the current roster without
  // having to resubscribe each time the roster identity changes.
  const techIdsRef = useRef(techIds);
  useEffect(() => {
    techIdsRef.current = techIds;
  }, [techIds]);

  const refreshBoard = useCallback(() => {
    fetchBoard(techIdsRef.current)
      .then((b) => setBoard(b))
      .catch(() => {}); // silent — a stale board beats an error flash
  }, []);

  // Initial load: board + grid together. setState lives only in the async
  // callbacks (not the synchronous effect body), which is what the
  // react-hooks/set-state-in-effect rule allows.
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

  // Auto-refresh the board every 60 seconds (the grid is historical, no need).
  useEffect(() => {
    const id = setInterval(refreshBoard, BOARD_REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshBoard]);

  return { board, grid, loading, error, refreshBoard };
}
