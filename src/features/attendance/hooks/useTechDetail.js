/**
 * Loads a technician's daily detail (punches) + the audited corrections for the
 * current month. `reload` bumps a key so the effect re-fetches after a manager
 * posts a correction (the setState is event-driven, which the
 * react-hooks/set-state-in-effect rule allows).
 */

import { useCallback, useEffect, useState } from "react";

import { fetchAdjustments, fetchTechDays } from "@features/attendance/data/attendanceApi";
import { currentMonth } from "@features/attendance/lib/format";

export function useTechDetail(techId) {
  const [days, setDays] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const month = currentMonth();
    const start = `${month}-01`;
    const end = new Date().toISOString().slice(0, 10);
    Promise.all([fetchTechDays(techId, start, end), fetchAdjustments(techId)])
      .then(([d, a]) => {
        if (!active) return;
        setDays(d.days || []);
        setAdjustments(a);
        setError(null);
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [techId, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);
  return { days, adjustments, loading, error, reload };
}
