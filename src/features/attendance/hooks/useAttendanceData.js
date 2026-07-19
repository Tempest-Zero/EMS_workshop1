/**
 * Loads the manager board + monthly grid for a roster + month. The board is
 * the AppContext copy — one source shared with the Dashboard/Technicians
 * screens — refreshed here every 60 seconds to justify the "Live" badge (and
 * skipped on mount when the login-time copy is under 30s old, so opening the
 * page doesn't pay for the same board twice). The grid is fetched only when
 * the month changes (historical data).
 */

import { useEffect, useState } from "react";

import { useApp } from "@app/providers/AppContext";
import { fetchGrid } from "@features/attendance/data/attendanceApi";

const BOARD_REFRESH_MS = 60_000;
const BOARD_MAX_AGE_MS = 30_000;

export function useAttendanceData(techIds, month) {
  const { board, refreshBoard } = useApp();
  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initial load: freshen the shared board (no-op when recent) + fetch the
  // grid. setState lives only in the async callbacks (not the synchronous
  // effect body), which is what the react-hooks/set-state-in-effect rule allows.
  useEffect(() => {
    let active = true;
    Promise.all([refreshBoard({ maxAgeMs: BOARD_MAX_AGE_MS }), fetchGrid(month, techIds)])
      .then(([, g]) => {
        if (!active) return;
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
  }, [techIds, month, refreshBoard]);

  // Auto-refresh the board every 60 seconds (the grid is historical, no need).
  // Poll failures are silent — a stale board beats an error flash.
  useEffect(() => {
    const id = setInterval(() => {
      refreshBoard().catch(() => {});
    }, BOARD_REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshBoard]);

  return { board, grid, loading, error, refreshBoard };
}
